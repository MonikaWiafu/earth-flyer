// Minimal Mapbox Vector Tile (MVT 2.x) decoder: just what the buildings layer
// needs - layers, polygon features, their properties - with no dependencies.

class Pbf {
  constructor(buf) { this.buf = buf; this.pos = 0; this.end = buf.length; }
  varint() {
    let val = 0, shift = 0, b;
    do {
      b = this.buf[this.pos++];
      if (shift < 28) val |= (b & 0x7f) << shift;
      else val += (b & 0x7f) * Math.pow(2, shift);
      shift += 7;
    } while (b & 0x80);
    return val >>> 0 === val ? val : val; // keep large values as numbers
  }
  svarint() { const v = this.varint(); return (v % 2 === 1) ? (v + 1) / -2 : v / 2; }
  bytes() { const len = this.varint(); const s = this.pos; this.pos += len; return this.buf.subarray(s, s + len); }
  string() { return new TextDecoder().decode(this.bytes()); }
  float() { const v = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 4).getFloat32(0, true); this.pos += 4; return v; }
  double() { const v = new DataView(this.buf.buffer, this.buf.byteOffset + this.pos, 8).getFloat64(0, true); this.pos += 8; return v; }
  skip(wire) {
    if (wire === 0) this.varint();
    else if (wire === 1) this.pos += 8;
    else if (wire === 2) this.pos += this.varint();
    else if (wire === 5) this.pos += 4;
    else throw new Error("mvt: unsupported wire type " + wire);
  }
  packed() {
    const end = this.varint() + this.pos, out = [];
    while (this.pos < end) out.push(this.varint());
    return out;
  }
}

function readValue(bytes) {
  const p = new Pbf(bytes);
  let v = null;
  while (p.pos < p.end) {
    const tag = p.varint(), f = tag >> 3, w = tag & 7;
    if (f === 1) v = p.string();
    else if (f === 2) v = p.float();
    else if (f === 3) v = p.double();
    else if (f === 4 || f === 5) v = p.varint();
    else if (f === 6) v = p.svarint();
    else if (f === 7) v = !!p.varint();
    else p.skip(w);
  }
  return v;
}

function readFeature(bytes) {
  const p = new Pbf(bytes);
  const f = { type: 0, tags: [], geometry: [] };
  while (p.pos < p.end) {
    const tag = p.varint(), n = tag >> 3, w = tag & 7;
    if (n === 2) f.tags = p.packed();
    else if (n === 3) f.type = p.varint();
    else if (n === 4) f.geometry = p.packed();
    else p.skip(w);
  }
  return f;
}

function readLayer(bytes) {
  const p = new Pbf(bytes);
  const layer = { name: "", extent: 4096, keys: [], values: [], features: [] };
  while (p.pos < p.end) {
    const tag = p.varint(), n = tag >> 3, w = tag & 7;
    if (n === 1) layer.name = p.string();
    else if (n === 2) layer.features.push(p.bytes());
    else if (n === 3) layer.keys.push(p.string());
    else if (n === 4) layer.values.push(readValue(p.bytes()));
    else if (n === 5) layer.extent = p.varint();
    else p.skip(w);
  }
  return layer;
}

// Polygon geometry -> array of polygons, each [exteriorRing, ...holes], rings
// as flat arrays [x0, y0, x1, y1, ...] in tile units (0..extent, y down).
function decodePolygons(cmds) {
  const rings = [];
  let x = 0, y = 0, i = 0, ring = null;
  while (i < cmds.length) {
    const c = cmds[i++], id = c & 7, count = c >> 3;
    if (id === 1 || id === 2) {
      for (let k = 0; k < count; k++) {
        const dx = cmds[i++], dy = cmds[i++];
        x += (dx >>> 1) ^ -(dx & 1);
        y += (dy >>> 1) ^ -(dy & 1);
        if (id === 1) { ring = [x, y]; rings.push(ring); } else ring.push(x, y);
      }
    } else if (id === 7) {
      /* ClosePath: the ring is implicitly closed */
    } else break;
  }
  // Exterior rings have positive area in tile coords (y down), holes negative.
  const polys = [];
  for (const r of rings) {
    if (r.length < 6) continue;
    let a = 0;
    for (let k = 0, n = r.length; k < n; k += 2) {
      const k2 = (k + 2) % n;
      a += r[k] * r[k2 + 1] - r[k2] * r[k + 1];
    }
    if (a > 0) polys.push([r]);
    else if (a < 0 && polys.length) polys[polys.length - 1].push(r);
  }
  return polys;
}

// Returns { layerName: { extent, features: [{ properties, polygons }] } } for the
// requested layers (polygon features only).
export function decodeTile(buf, wanted) {
  const p = new Pbf(buf);
  const out = {};
  while (p.pos < p.end) {
    const tag = p.varint(), n = tag >> 3, w = tag & 7;
    if (n !== 3) { p.skip(w); continue; }
    const layer = readLayer(p.bytes());
    if (wanted && !wanted.includes(layer.name)) continue;
    const features = [];
    for (const fb of layer.features) {
      const f = readFeature(fb);
      if (f.type !== 3) continue;
      const props = {};
      for (let t = 0; t + 1 < f.tags.length; t += 2) props[layer.keys[f.tags[t]]] = layer.values[f.tags[t + 1]];
      features.push({ properties: props, polygons: decodePolygons(f.geometry) });
    }
    out[layer.name] = { extent: layer.extent, features };
  }
  return out;
}
