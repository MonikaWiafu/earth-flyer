// Collision around the drone: samples the visible surface (Google 3D tiles,
// including buildings and trees, or the plain globe) on a grid and hands it
// to the drone engine as a triangle mesh in local ENU metres.
/* global Cesium */

export class CollisionGrid {
  constructor(viewer, frame, engine, { size = 160, cells = 32, exclude = [] } = {}) {
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
    if (!this.center) return true;
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
      for (let k = 0; k < cartos.length; k++) {
        const c = cartos[k];
        const h = heights[k] === undefined ? meanH : heights[k];
        const p = this.frame.toLocalPoint(Cesium.Cartesian3.fromRadians(c.longitude, c.latitude, h));
        pos[k * 3] = p[0]; pos[k * 3 + 1] = p[1]; pos[k * 3 + 2] = p[2];
        zs[k] = p[2];
      }
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
      this.engine.loadMesh(pos, idx, null);
      this.z = zs;
      this.origin = [ox, oy];
      this.center = [x, y];
    } catch (e) {
      console.warn("collision sampling failed", e);
    } finally {
      this.busy = false;
    }
  }

  async _sample(cartos) {
    const scene = this.viewer.scene;
    if (this.viewer._efTileset && scene.sampleHeightSupported) {
      const out = await scene.sampleHeightMostDetailed(cartos.map((c) => c.clone()), this.exclude, 0.5);
      return out.map((c) => (c && c.height !== undefined && isFinite(c.height) ? c.height : undefined));
    }
    const flat = scene.terrainProvider instanceof Cesium.EllipsoidTerrainProvider;
    return cartos.map((c) => {
      if (flat) return 0;
      const h = scene.globe.getHeight(c);
      return h === undefined ? 0 : h;
    });
  }
}
