// Free 3D buildings from OpenStreetMap (OpenFreeMap vector tiles, no key).
//
// Modes:
//   "plain"    - 3D over 2D: extruded buildings in neutral colours on top of the
//                satellite map.
//   "textured" - 2D over 3D: the satellite photo of each tile is projected
//                straight down onto the buildings. Roofs get the real roof;
//                walls get either the roof-edge pixels stretched down
//                ("projected") or the building's roof colour ("roof").
/* global Cesium */
import { decodeTile } from "./mvt.js";
import { sampleFreeTerrain } from "../terrain.js";

const TILEJSON_URL = "https://tiles.openfreemap.org/planet";
const ESRI = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";
const Z = 14;                 // OpenMapTiles buildings live at z14
const LOAD_BELOW_M = 5000;    // load buildings when the camera is this close to the ground
const DROP_ABOVE_M = 15000;   // unload everything above this
const DEFAULT_HEIGHT = 6;     // metres, when OSM has no height or levels
const SINK = 2;               // push ground-standing buildings into slopes so they don't float

const CREDIT_HTML =
  'Buildings: <a href="https://openfreemap.org" target="_blank" rel="noopener">OpenFreeMap</a> © <a href="https://www.openmaptiles.org/" target="_blank" rel="noopener">OpenMapTiles</a> © <a href="https://www.openstreetmap.org/copyright" target="_blank" rel="noopener">OpenStreetMap contributors</a>';

const ROOF_SHADER = `
czm_material czm_getMaterial(czm_materialInput materialInput) {
  czm_material m = czm_getDefaultMaterial(materialInput);
  m.diffuse = texture(image, clamp(materialInput.st, 0.0, 1.0)).rgb * shade;
  return m;
}`;

function tileToLonLat(x, y, z) {
  const n = 1 << z;
  const lon = (x / n) * 360 - 180;
  const lat = Cesium.Math.toDegrees(Math.atan(Math.sinh(Math.PI * (1 - (2 * y) / n))));
  return [lon, lat];
}
function lonLatToTile(lon, lat, z) {
  const n = 1 << z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = Cesium.Math.toRadians(lat);
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  return [Math.max(0, Math.min(n - 1, x)), Math.max(0, Math.min(n - 1, y))];
}

async function maybeGunzip(buf) {
  const u8 = new Uint8Array(buf);
  if (u8[0] === 0x1f && u8[1] === 0x8b && typeof DecompressionStream !== "undefined") {
    const ds = new Response(new Blob([u8]).stream().pipeThrough(new DecompressionStream("gzip")));
    return new Uint8Array(await ds.arrayBuffer());
  }
  return u8;
}

function loadImage(url) {
  return new Promise((resolve) => {
    const img = new Image();
    img.crossOrigin = "anonymous";
    img.onload = () => resolve(img);
    img.onerror = () => resolve(null);
    img.src = url;
  });
}

function pointInRing(lon, lat, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i], yi = ring[i + 1], xj = ring[j], yj = ring[j + 1];
    if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

export class BuildingLayer {
  constructor(viewer, { onStatus } = {}) {
    this.viewer = viewer;
    this.onStatus = onStatus || (() => {});
    this.mode = "off";
    this.walls = "projected";
    this.highDetail = false;
    this.available = true;     // false in Google mode (its tiles already have buildings)
    this.tiles = new Map();    // "x/y" -> tile entry
    this.template = null;
    this.focusFn = null;       // drone mode: () => Cartographic of the drone
    this.generation = 0;
    this.listeners = new Set(); // called when building data near the drone changes
    this.credit = new Cesium.Credit(CREDIT_HTML, false);
    this._creditShown = false;
    this._loading = 0;
    this._timer = setInterval(() => this._update(), 900);
    viewer.camera.moveEnd.addEventListener(() => this._update());
  }

  // ---- public controls ----
  setMode(mode) {
    if (mode === this.mode) return;
    const wasOff = this.mode === "off";
    this.mode = mode;
    if (mode === "off") this._clear();
    else if (!wasOff) this._rebuildAll();
    this._update();
  }
  setWalls(walls) { if (walls !== this.walls) { this.walls = walls; this._rebuildAll(); } }
  setHighDetail(on) {
    if (on === this.highDetail) return;
    this.highDetail = on;
    for (const t of this.tiles.values()) t.mosaic = null;
    this._rebuildAll();
  }
  setAvailable(on) { this.available = on; if (!on) this._clear(); this._update(); }
  setFocus(fn) { this.focusFn = fn; this._update(); }
  onDataChanged(fn) { this.listeners.add(fn); return () => this.listeners.delete(fn); }
  get active() { return this.available && this.mode !== "off"; }
  // Terrain changed: heights under the buildings changed, so start over.
  reload() { this._clear(); this._update(); }

  // Highest roof containing lon/lat (degrees), or undefined.
  roofHeightAt(lon, lat) {
    if (!this.active) return undefined;
    const [tx, ty] = lonLatToTile(lon, lat, Z);
    const t = this.tiles.get(`${tx}/${ty}`);
    if (!t || !t.buildings) return undefined;
    let best;
    for (const b of t.buildings) {
      if (lon < b.bbox[0] || lon > b.bbox[2] || lat < b.bbox[1] || lat > b.bbox[3]) continue;
      if (pointInRing(lon, lat, b.lonlat[0]) && (best === undefined || b.top > best)) best = b.top;
    }
    return best;
  }

  // Collision triangles (local ENU metres) for buildings within `radius` of x,y.
  trianglesNear(frame, x, y, radius) {
    if (!this.active) return null;
    const c = frame.toCarto(x, y, 0);
    const lon0 = Cesium.Math.toDegrees(c.longitude), lat0 = Cesium.Math.toDegrees(c.latitude);
    const mPerDegLat = 111320, mPerDegLon = 111320 * Math.cos(c.latitude);
    const pos = [], idx = [];
    const scratch = new Cesium.Cartesian3();
    for (const t of this.tiles.values()) {
      if (!t.buildings) continue;
      for (const b of t.buildings) {
        const dx = (b.cLon - lon0) * mPerDegLon, dy = (b.cLat - lat0) * mPerDegLat;
        if (Math.hypot(dx, dy) > radius + b.radiusM) continue;
        const base = pos.length / 3;
        const ringStarts = [];
        // vertices: all ring points at top, then all at bottom
        const pts = [];
        for (const ring of b.lonlat) { ringStarts.push(pts.length / 2); for (let i = 0; i < ring.length; i++) pts.push(ring[i]); }
        const nv = pts.length / 2;
        for (const h of [b.top, b.bottom]) {
          for (let i = 0; i < nv; i++) {
            const p = frame.toLocalPoint(Cesium.Cartesian3.fromDegrees(pts[i * 2], pts[i * 2 + 1], h, undefined, scratch));
            pos.push(p[0], p[1], p[2]);
          }
        }
        for (const k of b.roofIdx) idx.push(base + k);
        b.lonlat.forEach((ring, r) => {
          const s = ringStarts[r], n = ring.length / 2;
          for (let i = 0; i < n; i++) {
            const a = s + i, bb = s + ((i + 1) % n);
            idx.push(base + a, base + bb, base + nv + bb, base + a, base + nv + bb, base + nv + a);
          }
        });
      }
    }
    if (!idx.length) return null;
    return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
  }

  // ---- loading ----
  _focus() {
    const v = this.viewer, scene = v.scene;
    if (this.focusFn) {
      const c = this.focusFn();
      if (c) return { carto: c, agl: 0 };
    }
    const canvas = scene.canvas;
    const ray = v.camera.getPickRay(new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight / 2));
    const hit = ray && scene.globe.pick(ray, scene);
    const camCarto = v.camera.positionCartographic;
    const ground = scene.globe.getHeight(camCarto) || 0;
    const agl = camCarto.height - ground;
    const carto = hit ? Cesium.Cartographic.fromCartesian(hit) : camCarto;
    // When looking at the horizon the screen centre can be very far; use the camera then.
    if (hit && Cesium.Cartesian3.distance(hit, v.camera.positionWC) > 6000) return { carto: camCarto, agl };
    return { carto, agl };
  }

  _update() {
    if (!this.active) { this._showCredit(false); return; }
    const { carto, agl } = this._focus();
    if (agl > DROP_ABOVE_M) { this._clear(); return; }
    if (agl > LOAD_BELOW_M && !this.focusFn) return;
    this._showCredit(true);
    const [cx, cy] = lonLatToTile(Cesium.Math.toDegrees(carto.longitude), Cesium.Math.toDegrees(carto.latitude), Z);
    // load the 3x3 block around the focus, nearest first
    const want = [];
    for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) want.push([cx + dx, cy + dy, Math.abs(dx) + Math.abs(dy)]);
    want.sort((a, b) => a[2] - b[2]);
    for (const [x, y] of want) {
      const key = `${x}/${y}`;
      if (!this.tiles.has(key) && this._loading < 2) this._loadTile(x, y);
    }
    // drop tiles that are far away
    for (const [key, t] of this.tiles) {
      if (Math.max(Math.abs(t.x - cx), Math.abs(t.y - cy)) > 2) this._dropTile(key);
    }
  }

  async _getTemplate() {
    if (this.template) return this.template;
    const r = await fetch(TILEJSON_URL);
    if (!r.ok) throw new Error(`OpenFreeMap TileJSON: HTTP ${r.status}`);
    const j = await r.json();
    this.template = j.tiles[0];
    return this.template;
  }

  async _loadTile(x, y) {
    const key = `${x}/${y}`;
    const gen = this.generation;
    const t = { x, y, buildings: null, prims: [], mosaic: null, failed: false };
    this.tiles.set(key, t);
    this._loading++;
    this._status();
    try {
      const url = (await this._getTemplate()).replace("{z}", Z).replace("{x}", x).replace("{y}", y);
      const r = await fetch(url);
      if (!r.ok) throw new Error(`tile ${key}: HTTP ${r.status}`);
      const tile = decodeTile(await maybeGunzip(await r.arrayBuffer()), ["building"]);
      const layer = tile.building;
      const buildings = layer ? this._toBuildings(layer, x, y) : [];
      await this._applyBaseHeights(buildings);
      if (gen !== this.generation || this.tiles.get(key) !== t) return;
      t.buildings = buildings;
      await this._buildTile(t);
      for (const fn of this.listeners) fn();
    } catch (e) {
      console.warn("buildings:", e);
      t.failed = true;
    } finally {
      this._loading--;
      this._status();
    }
  }

  _toBuildings(layer, tx, ty) {
    const ext = layer.extent;
    const out = [];
    for (const f of layer.features) {
      const p = f.properties;
      if (p.hide_3d) continue;
      const h = Number(p.render_height ?? p.height) || DEFAULT_HEIGHT;
      const minH = Number(p.render_min_height ?? p.min_height) || 0;
      if (h <= minH) continue;
      for (const poly of f.polygons) {
        const uv = [], lonlat = [];
        let minLon = 180, minLat = 90, maxLon = -180, maxLat = -90;
        for (const ring of poly) {
          // drop the duplicated closing vertex if present
          let n = ring.length;
          if (n >= 4 && ring[0] === ring[n - 2] && ring[1] === ring[n - 1]) n -= 2;
          const ruv = new Float32Array(n), rll = new Float64Array(n);
          for (let i = 0; i < n; i += 2) {
            const u = ring[i] / ext, v = ring[i + 1] / ext;
            const [lon, lat] = tileToLonLat(tx + u, ty + v, Z);
            ruv[i] = u; ruv[i + 1] = v;
            rll[i] = lon; rll[i + 1] = lat;
            if (lon < minLon) minLon = lon; if (lon > maxLon) maxLon = lon;
            if (lat < minLat) minLat = lat; if (lat > maxLat) maxLat = lat;
          }
          if (n >= 6) { uv.push(ruv); lonlat.push(rll); }
        }
        if (!lonlat.length) continue;
        // roof triangulation (planar approximation is fine at building scale)
        const cosLat = Math.cos(Cesium.Math.toRadians((minLat + maxLat) / 2));
        const flat = [], holes = [];
        lonlat.forEach((ring, r) => {
          if (r > 0) holes.push(flat.length);
          for (let i = 0; i < ring.length; i += 2) flat.push(new Cesium.Cartesian2(ring[i] * cosLat * 1e5, ring[i + 1] * 1e5));
        });
        let roofIdx;
        try { roofIdx = Cesium.PolygonPipeline.triangulate(flat, holes.length ? holes : undefined); } catch (_) { continue; }
        if (!roofIdx || !roofIdx.length) continue;
        const cLon = (minLon + maxLon) / 2, cLat = (minLat + maxLat) / 2;
        const radiusM = Math.hypot((maxLon - minLon) * 111320 * cosLat, (maxLat - minLat) * 111320) / 2;
        out.push({ uv, lonlat, roofIdx, h, minH, cLon, cLat, radiusM, bbox: [minLon, minLat, maxLon, maxLat],
          cu: 0, cv: 0, base: 0, top: 0, bottom: 0 });
        // centroid in tile UV for roof-colour walls
        const b = out[out.length - 1];
        let su = 0, sv = 0;
        for (let i = 0; i < uv[0].length; i += 2) { su += uv[0][i]; sv += uv[0][i + 1]; }
        b.cu = su / (uv[0].length / 2);
        b.cv = sv / (uv[0].length / 2);
      }
    }
    return out;
  }

  async _applyBaseHeights(buildings) {
    const provider = this.viewer.scene.terrainProvider;
    let bases = null;
    if (buildings.length && provider instanceof Cesium.CustomHeightmapTerrainProvider) {
      try {
        bases = await sampleFreeTerrain(provider, buildings.map((b) => Cesium.Cartographic.fromDegrees(b.cLon, b.cLat)));
      } catch (_) { bases = null; }
    }
    buildings.forEach((b, i) => {
      b.base = bases && bases[i] !== undefined ? bases[i] : 0;
      b.top = b.base + b.h;
      b.bottom = b.base + b.minH - (b.minH === 0 ? SINK : 0);
    });
  }

  async _mosaic(t) {
    if (t.mosaic) return t.mosaic;
    const zoom = this.highDetail ? 17 : 16;
    const n = 1 << (zoom - Z);
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = n * 256;
    const ctx = canvas.getContext("2d");
    ctx.fillStyle = "#8a8a84";
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    const jobs = [];
    for (let j = 0; j < n; j++)
      for (let i = 0; i < n; i++) {
        const url = ESRI.replace("{z}", zoom).replace("{x}", t.x * n + i).replace("{y}", t.y * n + j);
        jobs.push(loadImage(url).then((img) => { if (img) ctx.drawImage(img, i * 256, j * 256, 256, 256); }));
      }
    await Promise.all(jobs);
    t.mosaic = canvas;
    return canvas;
  }

  _geometry(buildings, part) {
    // part: "roof" | "wall"
    const pos = [], nrm = [], st = [], idx = [];
    const ell = Cesium.Ellipsoid.WGS84;
    const P = new Cesium.Cartesian3(), Q = new Cesium.Cartesian3(), E = new Cesium.Cartesian3(), N = new Cesium.Cartesian3();
    const up = new Cesium.Cartesian3();
    const textured = this.mode === "textured";
    const roofWalls = this.walls === "roof";
    for (const b of buildings) {
      ell.geodeticSurfaceNormalCartographic(Cesium.Cartographic.fromDegrees(b.cLon, b.cLat), up);
      if (part === "roof") {
        const base = pos.length / 3;
        b.lonlat.forEach((ring, r) => {
          const uv = b.uv[r];
          for (let i = 0; i < ring.length; i += 2) {
            Cesium.Cartesian3.fromDegrees(ring[i], ring[i + 1], b.top, ell, P);
            pos.push(P.x, P.y, P.z);
            nrm.push(up.x, up.y, up.z);
            st.push(uv[i], 1 - uv[i + 1]);
          }
        });
        for (const k of b.roofIdx) idx.push(base + k);
        continue;
      }
      b.lonlat.forEach((ring, r) => {
        const uv = b.uv[r];
        const n = ring.length / 2;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          Cesium.Cartesian3.fromDegrees(ring[i * 2], ring[i * 2 + 1], b.top, ell, P);
          Cesium.Cartesian3.fromDegrees(ring[j * 2], ring[j * 2 + 1], b.top, ell, Q);
          Cesium.Cartesian3.subtract(Q, P, E);
          Cesium.Cartesian3.cross(E, up, N);
          if (Cesium.Cartesian3.magnitudeSquared(N) < 1e-12) continue;
          Cesium.Cartesian3.normalize(N, N);
          const base = pos.length / 3;
          const corners = [[i, b.top], [j, b.top], [j, b.bottom], [i, b.bottom]];
          for (const [k, h] of corners) {
            Cesium.Cartesian3.fromDegrees(ring[k * 2], ring[k * 2 + 1], h, ell, P);
            pos.push(P.x, P.y, P.z);
            nrm.push(N.x, N.y, N.z);
            if (textured && roofWalls) st.push(b.cu, 1 - b.cv);
            else st.push(uv[k * 2], 1 - uv[k * 2 + 1]);
          }
          idx.push(base, base + 1, base + 2, base, base + 2, base + 3);
        }
      });
    }
    if (!idx.length) return null;
    const positions = new Float64Array(pos);
    return new Cesium.Geometry({
      attributes: {
        position: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.DOUBLE, componentsPerAttribute: 3, values: positions }),
        normal: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 3, values: new Float32Array(nrm) }),
        st: new Cesium.GeometryAttribute({ componentDatatype: Cesium.ComponentDatatype.FLOAT, componentsPerAttribute: 2, values: new Float32Array(st) }),
      },
      indices: positions.length / 3 > 65535 ? new Uint32Array(idx) : new Uint16Array(idx),
      primitiveType: Cesium.PrimitiveType.TRIANGLES,
      boundingSphere: Cesium.BoundingSphere.fromVertices(positions),
    });
  }

  _material(part, image) {
    if (this.mode === "textured") {
      return new Cesium.Material({
        fabric: { uniforms: { image, shade: part === "roof" ? 1.0 : (this.walls === "roof" ? 0.72 : 0.9) }, source: ROOF_SHADER },
        translucent: false,
      });
    }
    return Cesium.Material.fromType("Color", {
      color: Cesium.Color.fromCssColorString(part === "roof" ? "#e4e1da" : "#c9c4ba"),
    });
  }

  async _buildTile(t) {
    this._removePrims(t);
    if (!this.active || !t.buildings || !t.buildings.length) return;
    const gen = this.generation;
    const image = this.mode === "textured" ? await this._mosaic(t) : null;
    if (gen !== this.generation || !this.tiles.has(`${t.x}/${t.y}`)) return;
    this._removePrims(t);
    for (const part of ["roof", "wall"]) {
      const geometry = this._geometry(t.buildings, part);
      if (!geometry) continue;
      const prim = new Cesium.Primitive({
        geometryInstances: new Cesium.GeometryInstance({ geometry }),
        appearance: new Cesium.MaterialAppearance({
          material: this._material(part, image),
          materialSupport: Cesium.MaterialAppearance.MaterialSupport.TEXTURED,
          faceForward: true,
          flat: false,
          closed: false,
          translucent: false,
        }),
        asynchronous: false,
        allowPicking: false,
        releaseGeometryInstances: true,
      });
      this.viewer.scene.primitives.add(prim);
      t.prims.push(prim);
    }
  }

  _rebuildAll() {
    if (!this.active) return;
    for (const t of this.tiles.values()) this._buildTile(t);
  }

  _removePrims(t) {
    for (const p of t.prims) this.viewer.scene.primitives.remove(p);
    t.prims = [];
  }
  _dropTile(key) {
    const t = this.tiles.get(key);
    if (t) this._removePrims(t);
    this.tiles.delete(key);
    for (const fn of this.listeners) fn();
  }
  _clear() {
    this.generation++;
    for (const key of [...this.tiles.keys()]) this._dropTile(key);
    this._showCredit(false);
    this._status();
  }
  _showCredit(on) {
    if (on === this._creditShown) return;
    const cd = this.viewer.creditDisplay;
    if (on) cd.addStaticCredit(this.credit); else cd.removeStaticCredit(this.credit);
    this._creditShown = on;
  }
  _status() {
    let count = 0;
    for (const t of this.tiles.values()) if (t.buildings) count += t.buildings.length;
    this.onStatus({ loading: this._loading, buildings: count, tiles: this.tiles.size });
  }
}
