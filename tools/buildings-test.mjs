// Offline test of the 3D buildings layer: serves a hand-encoded vector tile
// (two buildings, 30 m tall), a fake TileJSON and a solid-colour satellite
// tile through Playwright request interception, then checks decoding, both
// modes, roof spawning and drone collision.
//   node tools/buildings-test.mjs http://localhost:8765/ out-dir
import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:8765/";
const out = process.argv[3] || ".";

// ---- tiny MVT encoder ----
const varint = (n, o) => { while (n > 127) { o.push((n & 127) | 128); n = Math.floor(n / 128); } o.push(n); };
const key = (f, w, o) => varint((f << 3) | w, o);
const lenField = (f, bytes, o) => { key(f, 2, o); varint(bytes.length, o); o.push(...bytes); };
const str = (s) => [...Buffer.from(s)];
const zz = (n) => (n << 1) ^ (n >> 31);
const packed = (f, arr, o) => { const b = []; arr.forEach((v) => varint(v, b)); lenField(f, b, o); };
const dbl = (v) => { const b = Buffer.alloc(8); b.writeDoubleLE(v); return [...b]; };
function encodeTile(squares) {
  const layer = [];
  key(15, 0, layer); varint(2, layer);
  lenField(1, str("building"), layer);
  for (const [x0, y0, x1, y1] of squares) {
    const geom = [9, zz(x0), zz(y0), 26, zz(x1 - x0), zz(0), zz(0), zz(y1 - y0), zz(x0 - x1), zz(0), 15];
    const f = [];
    packed(2, [0, 0, 1, 1], f); key(3, 0, f); varint(3, f); packed(4, geom, f);
    lenField(2, f, layer);
  }
  lenField(3, str("render_height"), layer); lenField(3, str("render_min_height"), layer);
  const v1 = []; key(3, 1, v1); v1.push(...dbl(30)); lenField(4, v1, layer);
  const v2 = []; key(5, 0, v2); varint(0, v2); lenField(4, v2, layer);
  key(5, 0, layer); varint(4096, layer);
  const tile = []; lenField(3, layer, tile);
  return Buffer.from(tile);
}

const LON = -122.4783, LAT = 37.8279;
const n = 1 << 14;
const fx = ((LON + 180) / 360) * n, r = (LAT * Math.PI) / 180;
const fy = ((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n;
const TX = Math.floor(fx), TY = Math.floor(fy);
const px = Math.round((fx - TX) * 4096), py = Math.round((fy - TY) * 4096);
const tilePbf = encodeTile([[px - 40, py - 40, px + 40, py + 40], [100, 100, 300, 260]]);
const ORANGE_PNG = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFBQIAX8jx0gAAAABJRU5ErkJggg==", "base64");

const browser = await chromium.launch({ args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader"] });
const p = await browser.newPage({ viewport: { width: 1000, height: 700 } });
const errs = [];
p.on("pageerror", (e) => errs.push("pageerror: " + e.message));
p.on("console", (m) => { if (m.type() === "error" || /buildings:/.test(m.text())) errs.push(m.text()); });
const cors = { "access-control-allow-origin": "*" };
await p.route("https://tiles.openfreemap.org/planet", (rt) => rt.fulfill({ status: 200, contentType: "application/json", headers: cors,
  body: JSON.stringify({ tiles: ["https://tiles.openfreemap.org/planet/test/{z}/{x}/{y}.pbf"] }) }));
await p.route("https://tiles.openfreemap.org/planet/test/**", (rt) => {
  const m = rt.request().url().match(/(\d+)\/(\d+)\/(\d+)\.pbf/);
  rt.fulfill({ status: 200, contentType: "application/x-protobuf", headers: cors, body: +m[2] === TX && +m[3] === TY ? tilePbf : encodeTile([]) });
});
await p.route("https://server.arcgisonline.com/**", (rt) => rt.fulfill({ status: 200, contentType: "image/png", headers: cors, body: ORANGE_PNG }));

await p.goto(url);
await p.waitForFunction(() => document.getElementById("boot").classList.contains("done"), null, { timeout: 60000 });
await p.evaluate(([lon, lat]) => window.efViewer.camera.setView({ destination: Cesium.Cartesian3.fromDegrees(lon, lat - 0.004, 350),
  orientation: { heading: 0, pitch: Cesium.Math.toRadians(-35), roll: 0 } }), [LON, LAT]);
await p.waitForFunction(() => [...window.efBuildings.tiles.values()].some((t) => t.buildings?.length && t.prims.length), null, { timeout: 40000 });
const result = {};
result.textured = await p.evaluate(([lon, lat]) => {
  const L = window.efBuildings;
  const t = [...L.tiles.values()].find((t) => t.buildings?.length);
  return { mode: L.mode, buildings: t.buildings.length, prims: t.prims.length, roofAt: L.roofHeightAt(lon, lat), outside: L.roofHeightAt(lon + 0.01, lat) ?? null };
}, [LON, LAT]);
await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}/buildings-textured.png` });

await p.click("#btn-buildings");
await p.check('input[name="bmode"][value="plain"]');
await p.waitForTimeout(1200);
await p.screenshot({ path: `${out}/buildings-plain.png` });
result.plain = await p.evaluate(() => ({ prims: [...window.efBuildings.tiles.values()].reduce((s, t) => s + t.prims.length, 0), wallsDisabled: document.getElementById("bwalls-set").disabled }));
await p.check('input[name="bmode"][value="off"]');
await p.waitForTimeout(300);
result.off = await p.evaluate(() => ({ tiles: window.efBuildings.tiles.size }));
await p.check('input[name="bmode"][value="textured"]');
await p.check('input[name="bwalls"][value="roof"]');
await p.click("#btn-buildings");
await p.waitForFunction(() => [...window.efBuildings.tiles.values()].some((t) => t.prims.length), null, { timeout: 30000 });

// Aim the drone's spawn point (screen centre, 62% down) exactly at the 30 m building.
await p.evaluate(([lon, lat]) => {
  const v = window.efViewer, c = v.camera, sc = v.scene;
  const look = () => c.setView({ destination: c.position, orientation: { heading: 0, pitch: Cesium.Math.toRadians(-89.9), roll: 0 } });
  c.setView({ destination: Cesium.Cartesian3.fromDegrees(lon, lat, 300), orientation: { heading: 0, pitch: Cesium.Math.toRadians(-89.9), roll: 0 } });
  const scr = new Cesium.Cartesian2(sc.canvas.clientWidth / 2, sc.canvas.clientHeight * 0.62);
  const hit = sc.globe.pick(c.getPickRay(scr), sc) || c.pickEllipsoid(scr);
  const off = Cesium.Cartesian3.subtract(Cesium.Cartesian3.fromDegrees(lon, lat, 0), hit, new Cesium.Cartesian3());
  c.position = Cesium.Cartesian3.add(c.position, off, new Cesium.Cartesian3());
  look();
}, [LON, LAT]);
await p.waitForFunction(([lon, lat]) => window.efBuildings.roofHeightAt(lon, lat) !== undefined, [LON, LAT], { timeout: 30000 });
await p.waitForTimeout(800);
await p.click("#btn-drone");
await p.waitForFunction(() => document.body.classList.contains("drone"), null, { timeout: 30000 });
await p.waitForTimeout(3000);
result.drone = await p.evaluate(() => {
  const d = window.efDrone, o = Cesium.Cartographic.fromCartesian(d.frame.origin);
  const tris = d.collision.buildings?.trianglesNear(d.frame, 0, 0, 200);
  return { spawnHeightM: +o.height.toFixed(1), buildingTriangles: tris ? tris.indices.length / 3 : 0, basicGroundAtSpawn: +d.collision.heightAt(0, 0).toFixed(1) };
});
await p.keyboard.press("KeyC");
await p.waitForTimeout(1500);
await p.screenshot({ path: `${out}/buildings-drone-chase.png` });
await p.unrouteAll({ behavior: "ignoreErrors" });
await browser.close();

const fails = [];
if (result.textured.buildings !== 2 || result.textured.prims !== 2) fails.push("expected 2 buildings drawn as 2 meshes (roofs + walls)");
if (Math.abs((result.textured.roofAt ?? -1) - 30) > 0.5) fails.push("roof height at the test building should be 30 m");
if (result.textured.outside !== null) fails.push("roof found where there is no building");
if (result.plain.prims !== 2 || !result.plain.wallsDisabled) fails.push("plain mode should draw 2 meshes and disable the wall options");
if (result.off.tiles !== 0) fails.push("off should remove all building tiles");
if (Math.abs(result.drone.spawnHeightM - 30) > 0.5) fails.push("drone should spawn on the 30 m roof");
if (result.drone.buildingTriangles < 10) fails.push("collision mesh should include the building");
if (errs.some((e) => e.startsWith("pageerror"))) fails.push("page errors");
console.log(JSON.stringify({ result, errors: errs.filter((e) => !/wasm|LibFPV/.test(e)).slice(0, 10) }, null, 2));
if (fails.length) { console.error("BUILDINGS TEST FAILED:\n- " + fails.join("\n- ")); process.exit(1); }
console.log("BUILDINGS TEST PASSED");
