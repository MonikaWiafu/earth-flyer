// Collision around the drone: samples the visible surface (Google 3D tiles,
// including buildings and trees, or the plain globe) on a grid and hands it
// to the drone engine as a triangle mesh in local ENU metres.
/* global Cesium */
import { sampleFreeTerrain } from "../terrain.js";

// Work that touches many points runs in slices of at most BUDGET_MS per frame,
// so a collision refresh can never freeze the picture.
const BUDGET_MS = 3;
const REFRESH_MAX_AGE_MS = 8000; // re-sample now and then: sharper tiles stream in
const nextFrame = () => new Promise((r) => requestAnimationFrame(() => r()));
async function sliced(count, fn) {
  let i = 0;
  while (i < count) {
    const t0 = performance.now();
    while (i < count && performance.now() - t0 < BUDGET_MS) fn(i++);
    if (i < count) await nextFrame();
  }
}

export class CollisionGrid {
  constructor(viewer, frame, engine, { size = 160, cells = 32, exclude = [], buildings = null } = {}) {
    this.buildings = buildings;
    this.viewer = viewer;
    this.frame = frame;
    this.engine = engine;
    this.size = size;
    this.cells = cells;
    this.exclude = exclude;
    this.center = null;
    this.busy = false;
    this.z = null;      // (cells+1)^2 local heights
    this.origin = null; // local x,y of grid corner
    this.fallbackZ = 0;
    this.generation = 0;
    this.sampledAt = 0;
  }

  // Large flat plane at the spawn height so the drone has ground immediately.
  loadFlat(z) {
    this.fallbackZ = z;
    const s = 3000;
    const pos = new Float32Array([-s, -s, z, s, -s, z, s, s, z, -s, s, z]);
    this.engine.loadMesh(pos, new Uint32Array([0, 1, 2, 0, 2, 3]), null);
  }

  // Bilinear height (local z) for the basic drone.
  heightAt(x, y) {
    if (!this.z) return this.fallbackZ;
    const n = this.cells, step = this.size / n;
    const gx = (x - this.origin[0]) / step, gy = (y - this.origin[1]) / step;
    if (gx < 0 || gy < 0 || gx >= n || gy >= n) return this.fallbackZ;
    const ix = Math.floor(gx), iy = Math.floor(gy), fx = gx - ix, fy = gy - iy;
    const w = n + 1, Z = this.z;
    const a = Z[iy * w + ix], b = Z[iy * w + ix + 1], c = Z[(iy + 1) * w + ix], d = Z[(iy + 1) * w + ix + 1];
    return (a * (1 - fx) + b * fx) * (1 - fy) + (c * (1 - fx) + d * fx) * fy;
  }

  needsRefresh(x, y) {
    if (this.busy) return false;
    if (!this.center) return true;
    if (performance.now() - this.sampledAt > REFRESH_MAX_AGE_MS) return true;
    return Math.hypot(x - this.center[0], y - this.center[1]) > this.size * 0.28;
  }

  async refreshAround(x, y) {
    if (this.busy) return;
    this.busy = true;
    const gen = ++this.generation;
    try {
      const n = this.cells, w = n + 1, step = this.size / n;
      const ox = x - this.size / 2, oy = y - this.size / 2;
      const cartos = [];
      for (let j = 0; j <= n; j++)
        for (let i = 0; i <= n; i++) cartos.push(this.frame.toCarto(ox + i * step, oy + j * step, 0));

      const heights = await this._sample(cartos);
      if (gen !== this.generation) return;

      const pos = new Float32Array(w * w * 3);
      const zs = new Float32Array(w * w);
      let valid = 0, sum = 0;
      for (const h of heights) if (h !== undefined) { valid++; sum += h; }
      const meanH = valid ? sum / valid : 0;
      const scratch = new Cesium.Cartesian3();
      await sliced(cartos.length, (k) => {
        const c = cartos[k];
        const h = heights[k] === undefined ? meanH : heights[k];
        const p = this.frame.toLocalPoint(Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, h, undefined, scratch));
        pos[k * 3] = p[0]; pos[k * 3 + 1] = p[1]; pos[k * 3 + 2] = p[2];
        zs[k] = p[2];
      });
      if (gen !== this.generation) return;
      const idx = new Uint32Array(n * n * 6);
      let t = 0;
      for (let j = 0; j < n; j++)
        for (let i = 0; i < n; i++) {
          const a = j * w + i, b = a + 1, c = a + w, d = c + 1;
          idx[t++] = a; idx[t++] = b; idx[t++] = d;
          idx[t++] = a; idx[t++] = d; idx[t++] = c;
        }
      // Skirt: everything outside the grid falls back to the mean height.
      this.fallbackZ = zs.reduce((m, v) => m + v, 0) / zs.length;

      // Buildings: real walls and roofs for LibFPV; roof heights for the basic drone.
      let meshPos = pos, meshIdx = idx;
      const bt = this.buildings?.trianglesNear(this.frame, x, y, this.size / 2 + 20);
      if (bt) {
        meshPos = new Float32Array(pos.length + bt.positions.length);
        meshPos.set(pos);
        meshPos.set(bt.positions, pos.length);
        meshIdx = new Uint32Array(idx.length + bt.indices.length);
        meshIdx.set(idx);
        const off = pos.length / 3;
        for (let k = 0; k < bt.indices.length; k++) meshIdx[idx.length + k] = bt.indices[k] + off;
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
      this.engine.loadMesh(meshPos, meshIdx, null);
      this.z = zs;
      this.origin = [ox, oy];
      this.center = [x, y];
      this.sampledAt = performance.now();
    } catch (e) {
      console.warn("collision sampling failed", e);
    } finally {
      this.busy = false;
    }
  }

  async _sample(cartos) {
    const scene = this.viewer.scene;
    const out = new Array(cartos.length);
    const tileset = this.viewer._efTileset;
    if (tileset) {
      // Google 3D tiles: CPU ray test against the tiles already loaded around
      // the drone. (scene.sampleHeightMostDetailed traverses the whole tileset
      // and renders an offscreen pick per point - over a thousand per refresh,
      // which froze the app for 1-2 s every few seconds.)
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
