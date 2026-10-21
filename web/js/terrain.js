// Free global 3D terrain: AWS Open Data "Terrain Tiles" (Mapzen Terrarium
// PNGs, no key needed), decoded into a Cesium heightmap terrain provider.
/* global Cesium */

const URL_TEMPLATE = "https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png";
const MAX_LEVEL = 15;      // deepest level AWS serves
const SIZE = 65;           // heightmap samples per tile edge (Cesium wants corner-inclusive grids)
const CREDIT =
  'Terrain: <a href="https://registry.opendata.aws/terrain-tiles/" target="_blank" rel="noopener">Mapzen Terrain Tiles on AWS</a> (SRTM, GMTED, NED, ETOPO1 and others)';

const cache = new Map(); // "z/x/y" -> Promise<Float32Array(256*256)|null>
const CACHE_MAX = 96;

function fetchTerrarium(z, x, y) {
  const key = `${z}/${x}/${y}`;
  let p = cache.get(key);
  if (p) {
    cache.delete(key); // refresh LRU order
    cache.set(key, p);
    return p;
  }
  p = (async () => {
    const url = URL_TEMPLATE.replace("{z}", z).replace("{x}", x).replace("{y}", y);
    const r = await fetch(url, { mode: "cors" });
    if (!r.ok) return null;
    const bmp = await createImageBitmap(await r.blob());
    const canvas = typeof OffscreenCanvas !== "undefined" ? new OffscreenCanvas(256, 256) : Object.assign(document.createElement("canvas"), { width: 256, height: 256 });
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    ctx.drawImage(bmp, 0, 0, 256, 256);
    bmp.close?.();
    const px = ctx.getImageData(0, 0, 256, 256).data;
    const h = new Float32Array(256 * 256);
    for (let i = 0, j = 0; i < h.length; i++, j += 4) h[i] = px[j] * 256 + px[j + 1] + px[j + 2] / 256 - 32768;
    return h;
  })().catch(() => null);
  cache.set(key, p);
  while (cache.size > CACHE_MAX) cache.delete(cache.keys().next().value);
  return p;
}

// Bilinear sample of a 256x256 tile at fractional tile coords u,v in [0,1].
function sample(h, u, v) {
  const fx = Math.min(255, Math.max(0, u * 256 - 0.5));
  const fy = Math.min(255, Math.max(0, v * 256 - 0.5));
  const x0 = Math.floor(fx), y0 = Math.floor(fy);
  const x1 = Math.min(255, x0 + 1), y1 = Math.min(255, y0 + 1);
  const tx = fx - x0, ty = fy - y0;
  const a = h[y0 * 256 + x0], b = h[y0 * 256 + x1], c = h[y1 * 256 + x0], d = h[y1 * 256 + x1];
  return (a * (1 - tx) + b * tx) * (1 - ty) + (c * (1 - tx) + d * tx) * ty;
}

async function heightmap(x, y, level) {
  // Deeper than AWS goes: read the level-15 ancestor and interpolate its sub-square.
  const z = Math.min(level, MAX_LEVEL);
  const shift = level - z;
  const ax = x >> shift, ay = y >> shift;
  const span = 1 << shift;
  const ox = (x - ax * span) / span, oy = (y - ay * span) / span;
  const src = await fetchTerrarium(z, ax, ay);
  if (!src) {
    // Download failed. Deep tiles fall back to their parent; the top levels have
    // no parent, so they become flat instead of taking the whole globe down.
    return level <= 3 ? new Float32Array(SIZE * SIZE) : undefined;
  }
  const out = new Float32Array(SIZE * SIZE);
  for (let j = 0; j < SIZE; j++) {
    const v = oy + (j / (SIZE - 1)) / span;
    for (let i = 0; i < SIZE; i++) {
      const u = ox + (i / (SIZE - 1)) / span;
      // Water is stored as bathymetry; keep oceans at sea level so the imagery sits flat.
      out[j * SIZE + i] = Math.max(0, sample(src, u, v));
    }
  }
  return out;
}

export function createFreeTerrainProvider() {
  return new Cesium.CustomHeightmapTerrainProvider({
    width: SIZE,
    height: SIZE,
    tilingScheme: new Cesium.WebMercatorTilingScheme(),
    callback: heightmap,
    credit: new Cesium.Credit(CREDIT, false),
  });
}

// Heights (metres above the ellipsoid) for collision sampling, from a detailed level.
export async function sampleFreeTerrain(provider, cartos) {
  const pts = cartos.map((c) => c.clone());
  await Cesium.sampleTerrain(provider, 16, pts);
  return pts.map((p) => (isFinite(p.height) ? p.height : undefined));
}
