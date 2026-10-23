// Collision around the drone: samples the visible surface (Google 3D tiles,
// including buildings and trees, or the free terrain) on a grid and hands it
// to the drone engine as a triangle mesh in local ENU metres.
//
// Modes (Settings → Drone controls → Collision):
//   "full"   ground + buildings
//   "ground" terrain only: fly through buildings
//   "off"    nothing but a small launch pad where the drone spawns
/* global Cesium */
import { sampleFreeTerrain } from "../terrain.js";

// Work that touches many points runs in slices of at most BUDGET_MS per frame,
// so a collision refresh can never freeze the picture.
const BUDGET_MS = 3;
const REFRESH_MAX_AGE_MS = 8000; // re-sample now and then: sharper tiles stream in
// Cells whose corners differ by more than this are cliffs (building edges):
// built as flat steps with vertical walls instead of a sloped triangle,
// which would stick out into the air as an invisible ramp.
const CLIFF_M = 2.0;
// Ground-only in Google mode: the surface includes buildings, so a minimum
// filter over this many cells (each side) removes anything narrower than ~40 m.
const GROUND_FILTER_CELLS = 4;
const PAD_HALF_M = 2; // launch pad when collision is off

const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
async function sliced(count, fn) {
  let i = 0;
  while (i < count) {
    const t0 = performance.now();
    while (i < count && performance.now() - t0 < BUDGET_MS) fn(i++);
    if (i < count) await nextFrame();
  }
}

// Heightfield -> triangles, with cliff cells built as steps + walls.
// zs: (n+1)^2 local heights at grid corners; returns { positions, indices }.
export function buildGridMesh(zs, n, step, ox, oy) {
  const w = n + 1;
  const pos = [];
  const idx = [];
  // shared corner vertices for the smooth cells
  for (let j = 0; j <= n; j++)
    for (let i = 0; i <= n; i++) pos.push(ox + i * step, oy + j * step, zs[j * w + i]);
  const quad = (p0, p1, p2, p3) => {
    const b = pos.length / 3;
    pos.push(...p0, ...p1, ...p2, ...p3);
    idx.push(b, b + 1, b + 2, b, b + 2, b + 3);
  };
  const wall = (x0, y0, x1, y1, zLow, zHigh) => {
    if (zHigh - zLow < 0.05) return;
    quad([x0, y0, zLow], [x1, y1, zLow], [x1, y1, zHigh], [x0, y0, zHigh]);
  };
  for (let j = 0; j < n; j++) {
    for (let i = 0; i < n; i++) {
      const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
      const za = zs[a], zb = zs[b], zc = zs[c], zd = zs[d];
      const zmin = Math.min(za, zb, zc, zd), zmax = Math.max(za, zb, zc, zd);
      if (zmax - zmin <= CLIFF_M) {
        idx.push(a, b, d, a, d, c);
        continue;
      }
      // Cliff: each corner owns a quarter of the cell, flat at its own height.
      const x0 = ox + i * step, x1 = x0 + step, xm = x0 + step / 2;
      const y0 = oy + j * step, y1 = y0 + step, ym = y0 + step / 2;
      quad([x0, y0, za], [xm, y0, za], [xm, ym, za], [x0, ym, za]);
      quad([xm, y0, zb], [x1, y0, zb], [x1, ym, zb], [xm, ym, zb]);
      quad([x0, ym, zc], [xm, ym, zc], [xm, y1, zc], [x0, y1, zc]);
      quad([xm, ym, zd], [x1, ym, zd], [x1, y1, zd], [xm, y1, zd]);
      // inner walls between quarters
      wall(xm, y0, xm, ym, Math.min(za, zb), Math.max(za, zb));
      wall(xm, ym, xm, y1, Math.min(zc, zd), Math.max(zc, zd));
      wall(x0, ym, xm, ym, Math.min(za, zc), Math.max(za, zc));
      wall(xm, ym, x1, ym, Math.min(zb, zd), Math.max(zb, zd));
      // outer skirts down to the cell's lowest corner (closes gaps to neighbours)
      wall(x0, y0, xm, y0, zmin, za); wall(xm, y0, x1, y0, zmin, zb);
      wall(x0, y1, xm, y1, zmin, zc); wall(xm, y1, x1, y1, zmin, zd);
      wall(x0, y0, x0, ym, zmin, za); wall(x0, ym, x0, y1, zmin, zc);
      wall(x1, y0, x1, ym, zmin, zb); wall(x1, ym, x1, y1, zmin, zd);
    }
  }
  return { positions: new Float32Array(pos), indices: new Uint32Array(idx) };
}

// Minimum filter over a (n+1)^2 grid (separable): strips narrow tall things.
function minFilter(values, w, r) {
  const tmp = new Float64Array(values.length), out = new Float64Array(values.length);
  for (let j = 0; j < w; j++)
    for (let i = 0; i < w; i++) {
      let m = Infinity;
      for (let k = Math.max(0, i - r); k <= Math.min(w - 1, i + r); k++) m = Math.min(m, values[j * w + k]);
      tmp[j * w + i] = m;
    }
  for (let j = 0; j < w; j++)
    for (let i = 0; i < w; i++) {
      let m = Infinity;
      for (let k = Math.max(0, j - r); k <= Math.min(w - 1, j + r); k++) m = Math.min(m, tmp[k * w + i]);
      out[j * w + i] = m;
    }
  return out;
}

export class CollisionGrid {
  constructor(viewer, frame, engine, { size = 160, cells = 32, exclude = [], buildings = null, mode = "full" } = {}) {
    this.buildings = buildings;
    this.viewer = viewer;
    this.frame = frame;
    this.engine = engine;
    this.size = size;
    this.cells = cells;
    this.exclude = exclude;
    this.mode = mode;
    this.center = null;
    this.busy = false;
    this.z = null;      // (cells+1)^2 local heights
    this.origin = null; // local x,y of grid corner
    this.fallbackZ = 0;
    this.generation = 0;
    this.sampledAt = 0;
  }

  setMode(mode) {
    if (mode === this.mode) return;
    this.mode = mode;
    this.generation++;  // drop any refresh in flight
    this.busy = false;
    this.center = null; // rebuild on the next frame
    this.z = null;
    if (mode === "off") this._loadPad();
  }

  // Large flat plane at the spawn height so the drone has ground immediately.
  loadFlat(z) {
    this.fallbackZ = z;
    if (this.mode === "off") { this._loadPad(); return; }
    const s = 3000;
    const pos = new Float32Array([-s, -s, z, s, -s, z, s, s, z, -s, s, z]);
    this.engine.loadMesh(pos, new Uint32Array([0, 1, 2, 0, 2, 3]), null);
  }

  // Collision off: only a small pad at the spawn point, so the drone can sit and arm.
  _loadPad() {
    const s = PAD_HALF_M;
    const pos = new Float32Array([-s, -s, 0, s, -s, 0, s, s, 0, -s, s, 0]);
    this.engine.loadMesh(pos, new Uint32Array([0, 1, 2, 0, 2, 3]), null);
    this.center = [0, 0];
    this.sampledAt = Infinity;
  }

  // Height (local z) for the basic drone.
  heightAt(x, y) {
    if (this.mode === "off") return Math.abs(x) <= PAD_HALF_M && Math.abs(y) <= PAD_HALF_M ? 0 : -1e9;
    if (!this.z) return this.fallbackZ;
    const n = this.cells, step = this.size / n;
    const gx = (x - this.origin[0]) / step, gy = (y - this.origin[1]) / step;
    if (gx < 0 || gy < 0 || gx >= n || gy >= n) return this.fallbackZ;
    const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
    const w = n + 1, Z = this.z;
    const a = Z[iy * w + ix], b = Z[iy * w + ix + 1], c = Z[(iy + 1) * w + ix], d = Z[(iy + 1) * w + ix + 1];
    if (Math.max(a, b, c, d) - Math.min(a, b, c, d) > CLIFF_M) {
      // cliff cell: the nearest corner's step, like the collision mesh
      return fx < 0.5 ? (fy < 0.5 ? a : c) : (fy < 0.5 ? b : d);
    }
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }

  needsRefresh(x, y) {
    if (this.mode === "off" || this.busy) return false;
    if (!this.center) return true;
    if (performance.now() - this.sampledAt > REFRESH_MAX_AGE_MS) return true;
    return Math.hypot(x - this.center[0], y - this.center[1]) > this.size * 0.28;
  }

  async refreshAround(x, y) {
    if (this.busy || this.mode === "off") return;
    this.busy = true;
    const gen = ++this.generation;
    const mode = this.mode;
    try {
      const n = this.cells, w = n + 1, step = this.size / n;
      const ox = x - this.size / 2, oy = y - this.size / 2;
      const cartos = [];
      for (let j = 0; j <= n; j++)
        for (let i = 0; i <= n; i++) cartos.push(this.frame.toCarto(ox + i * step, oy + j * step, 0));

      let heights = await this._sample(cartos);
      if (gen !== this.generation) return;

      let valid = 0, sum = 0;
      for (const h of heights) if (h !== undefined) { valid++; sum += h; }
      const meanH = valid ? sum / valid : 0;
      heights = heights.map((h) => (h === undefined ? meanH : h));
      // Ground only with Google tiles: the sampled surface includes buildings.
      if (mode === "ground" && this.viewer._efTileset) heights = Array.from(minFilter(heights, w, GROUND_FILTER_CELLS));

      const zs = new Float32Array(w * w);
      const scratch = new Cesium.Cartesian3();
      await sliced(cartos.length, (k) => {
        const c = cartos[k];
        zs[k] = this.frame.toLocalPoint(Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, heights[k], undefined, scratch))[2];
      });
      if (gen !== this.generation) return;

      // Free-mode buildings: exact walls and roofs (full collision only).
      const withBuildings = mode === "full" && this.buildings?.active;
      if (withBuildings) {
        await sliced(cartos.length, (k) => {
          const roof = this.buildings.roofHeightAt(Cesium.Math.toDegrees(cartos[k].longitude), Cesium.Math.toDegrees(cartos[k].latitude));
          if (roof !== undefined) {
            const c = cartos[k];
            const p = this.frame.toLocalPoint(Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, roof));
            if (p[2] > zs[k]) zs[k] = p[2];
          }
        });
        if (gen !== this.generation) return;
      }
      this.fallbackZ = zs.reduce((m, v) => m + v, 0) / zs.length;

      // The ground mesh uses terrain-only heights in free mode (buildings come
      // as exact prisms below); zs above also holds roofs for the basic drone.
      const groundZ = withBuildings ? await this._terrainOnlyZ(cartos, heights) : zs;
      if (gen !== this.generation) return;
      let mesh = buildGridMesh(groundZ, n, step, ox, oy);
      const bt = withBuildings ? this.buildings.trianglesNear(this.frame, x, y, this.size / 2 + 20) : null;
      if (bt) {
        const p = new Float32Array(mesh.positions.length + bt.positions.length);
        p.set(mesh.positions);
        p.set(bt.positions, mesh.positions.length);
        const ix = new Uint32Array(mesh.indices.length + bt.indices.length);
        ix.set(mesh.indices);
        const off = mesh.positions.length / 3;
        for (let k = 0; k < bt.indices.length; k++) ix[mesh.indices.length + k] = bt.indices[k] + off;
        mesh = { positions: p, indices: ix };
      }
      this.engine.loadMesh(mesh.positions, mesh.indices, null);
      this.z = zs;
      this.origin = [ox, oy];
      this.center = [x, y];
      this.sampledAt = performance.now();
    } catch (e) {
      console.warn("collision sampling failed", e);
    } finally {
      if (gen === this.generation) this.busy = false;
    }
  }

  async _terrainOnlyZ(cartos, heights) {
    const zs = new Float32Array(cartos.length);
    const scratch = new Cesium.Cartesian3();
    await sliced(cartos.length, (k) => {
      const c = cartos[k];
      zs[k] = this.frame.toLocalPoint(Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, heights[k], undefined, scratch))[2];
    });
    return zs;
  }

  async _sample(cartos) {
    const scene = this.viewer.scene;
    const out = new Array(cartos.length);
    const tileset = this.viewer._efTileset;
    if (tileset) {
      // Google 3D tiles: CPU ray test against the tiles already loaded around
      // the drone (cheap; scene.sampleHeightMostDetailed froze the app).
      await sliced(cartos.length, (k) => {
        const h = tileset.getHeight(cartos[k], scene);
        out[k] = h !== undefined && isFinite(h) ? h : undefined;
      });
      return out;
    }
    if (scene.terrainProvider instanceof Cesium.CustomHeightmapTerrainProvider) {
      try { return await sampleFreeTerrain(scene.terrainProvider, cartos); } catch (_) { /* fall through */ }
    }
    const flat = scene.terrainProvider instanceof Cesium.EllipsoidTerrainProvider;
    await sliced(cartos.length, (k) => {
      const h = flat ? 0 : scene.globe.getHeight(cartos[k]);
      out[k] = h === undefined ? 0 : h;
    });
    return out;
  }
}
