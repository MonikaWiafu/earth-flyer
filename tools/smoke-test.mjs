// Headless smoke test: loads the app, checks the globe boots, enters drone
// mode, flies a little on the keyboard, and saves screenshots.
//   node tools/smoke-test.mjs http://localhost:8765/ out-dir
import { chromium } from "playwright";

const url = process.argv[2] || "http://localhost:8765/";
const out = process.argv[3] || ".";
const browser = await chromium.launch({
  args: ["--use-gl=angle", "--use-angle=swiftshader", "--enable-unsafe-swiftshader", "--ignore-gpu-blocklist"],
});
const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
const errors = [];
page.on("pageerror", (e) => errors.push("pageerror: " + e.message));
page.on("console", (m) => { if (m.type() === "error" || m.type() === "warning") errors.push(`${m.type()}: ${m.text()}`); });

await page.goto(url);
await page.waitForFunction(() => document.getElementById("boot").classList.contains("done"), null, { timeout: 60000 });
await page.waitForTimeout(2000);
await page.screenshot({ path: `${out}/1-space.png` });

// Drone setup menu over the globe: Settings → Open drone setup, then F8 closes it.
await page.click("#btn-settings");
await page.click("#set-drone-setup");
await page.waitForTimeout(2500);
const setupMenu = await page.evaluate(() => {
  const d = window.efDrone;
  return { open: !!d.setupOpen && !!d.engine?.overlayOpen?.(), drawCommands: d.overlay?.lastCommandCount || 0 };
});
await page.keyboard.press("F8");
await page.waitForTimeout(800);
setupMenu.closedWithF8 = await page.evaluate(() => !window.efDrone.setupOpen);

// Free 3D terrain: sample Mount Rainier's summit (4,392 m) from the AWS tiles.
const terrain = await page.evaluate(async () => {
  try {
    const mod = await import("./js/terrain.js");
    const p = window.efViewer.scene.terrainProvider;
    const [h] = await mod.sampleFreeTerrain(p, [Cesium.Cartographic.fromDegrees(-121.7603, 46.8523)]);
    return { on: p instanceof Cesium.CustomHeightmapTerrainProvider, rainierSummitM: h === undefined ? null : Math.round(h) };
  } catch (e) { return { error: String(e) }; }
});

// Free 3D buildings (default: satellite-textured): Times Square, real OpenFreeMap data.
await page.evaluate(() => window.efViewer.camera.setView({
  destination: Cesium.Cartesian3.fromDegrees(-73.9855, 40.7500, 900),
  orientation: { heading: 0, pitch: Cesium.Math.toRadians(-30), roll: 0 },
}));
const buildings = await page.evaluate(() => new Promise((resolve) => {
  const t0 = performance.now();
  const check = () => {
    const L = window.efBuildings;
    const tiles = [...L.tiles.values()];
    const count = tiles.reduce((n, t) => n + (t.buildings ? t.buildings.length : 0), 0);
    const meshes = tiles.reduce((n, t) => n + t.prims.length, 0);
    const withMosaic = tiles.filter((t) => t.mosaic);
    let textureLooksReal = null;
    if (withMosaic.length) {
      const c = withMosaic[0].mosaic, ctx = c.getContext("2d");
      const px = ctx.getImageData(c.width / 2, c.height / 2, 1, 1).data;
      textureLooksReal = !(px[0] === 0x8a && px[1] === 0x8a && px[2] === 0x84); // not the grey placeholder
    }
    if ((count > 200 && meshes > 0 && withMosaic.length) || performance.now() - t0 > 45000)
      resolve({ mode: L.mode, buildings: count, meshes, tilesWithTexture: withMosaic.length, textureLooksReal });
    else setTimeout(check, 1000);
  };
  check();
}));
await page.waitForTimeout(2000);
await page.screenshot({ path: `${out}/0-buildings-times-square.png` });

// Jump close to the ground (Golden Gate area) and enter drone mode.
await page.evaluate(() => {
  const v = window.efViewer;
  v.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(-122.4783, 37.8199, 600),
    orientation: { heading: 0, pitch: Cesium.Math.toRadians(-35), roll: 0 },
  });
});
await page.waitForTimeout(1500);
await page.click("#btn-drone");
await page.waitForFunction(() => document.body.classList.contains("drone"), null, { timeout: 30000 });
await page.waitForTimeout(500);
// Arm, throttle up, fly forward.
await page.keyboard.press("Enter");
await page.keyboard.down("KeyW");
await page.waitForTimeout(1500);
await page.keyboard.up("KeyW");
await page.keyboard.down("ArrowUp");
await page.waitForTimeout(1200);
await page.keyboard.up("ArrowUp");
const hud = await page.textContent("#hud-status");
const engine = await page.evaluate(() => {
  const d = window.efDrone, e = d.engine;
  const s1 = e.tick(0.016);
  return new Promise((r) => setTimeout(() => {
    const s2 = e.tick(0.016);
    const osd = document.getElementById("drone-osd");
    const px = osd.getContext("2d").getImageData(0, 0, osd.width, osd.height).data;
    let lit = 0;
    for (let i = 3; i < px.length; i += 4) if (px[i] > 0) lit++;
    r({ name: e.name, real: !!e.real, version: e.version || null, simTimeAdvanced: s2.time > s1.time,
        t1: s1.time, t2: s2.time, osdPixels: lit, input: e.inputStatus(), arming: s2.armingText });
  }, 1500));
});
const cam = await page.evaluate(() => {
  const c = window.efViewer.camera.positionCartographic;
  return { lat: Cesium.Math.toDegrees(c.latitude), lon: Cesium.Math.toDegrees(c.longitude), h: c.height };
});
await page.screenshot({ path: `${out}/2-drone-fpv.png` });
await page.keyboard.press("KeyC");
await page.waitForTimeout(800);
await page.screenshot({ path: `${out}/3-drone-chase.png` });
await page.keyboard.press("KeyX");
await page.waitForTimeout(500);
const exited = await page.evaluate(() => !document.body.classList.contains("drone"));

const realErrors = errors.filter((e) => !/ERR_TUNNEL|ERR_NAME|Failed to load resource/.test(e) || /wasm/.test(e));
console.log(JSON.stringify({ hud, cam, exited, engine, terrain, setupMenu, buildings, errors: realErrors.slice(0, 25) }, null, 2));
await browser.close();

if (process.env.EXPECT_LIBFPV) {
  const fails = [];
  if (!engine.real) fails.push("LibFPV engine did not load (fell back to the basic drone)");
  if (engine.real && !engine.simTimeAdvanced) fails.push("LibFPV simulation time did not advance");
  if (engine.real && engine.osdPixels < 100) fails.push("Betaflight OSD did not draw");
  if (!exited) fails.push("could not exit drone mode");
  if (engine.real && !(setupMenu.open && setupMenu.drawCommands > 0)) fails.push(`drone setup menu did not render over the globe: ${JSON.stringify(setupMenu)}`);
  if (engine.real && !setupMenu.closedWithF8) fails.push("F8 did not close the drone setup menu");
  if (!(buildings.buildings > 200 && buildings.meshes > 0)) fails.push(`free 3D buildings did not load: ${JSON.stringify(buildings)}`);
  if (buildings.textureLooksReal === false) fails.push("building texture mosaic stayed grey (satellite tiles did not load)");
  if (!terrain.on) fails.push("free 3D terrain provider is not active");
  if (!(terrain.rainierSummitM > 3800 && terrain.rainierSummitM < 4600)) fails.push(`terrain height check failed: ${JSON.stringify(terrain)}`);
  if (realErrors.some((e) => e.startsWith("pageerror"))) fails.push("page errors: " + realErrors.join(" | "));
  if (fails.length) { console.error("SMOKE TEST FAILED:\n- " + fails.join("\n- ")); process.exit(1); }
  console.log("SMOKE TEST PASSED");
}
