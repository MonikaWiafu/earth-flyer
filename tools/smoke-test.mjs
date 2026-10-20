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

// Free 3D terrain: sample Mount Rainier's summit (4,392 m) from the AWS tiles.
const terrain = await page.evaluate(async () => {
  try {
    const mod = await import("./js/terrain.js");
    const p = window.efViewer.scene.terrainProvider;
    const [h] = await mod.sampleFreeTerrain(p, [Cesium.Cartographic.fromDegrees(-121.7603, 46.8523)]);
    return { on: p instanceof Cesium.CustomHeightmapTerrainProvider, rainierSummitM: h === undefined ? null : Math.round(h) };
  } catch (e) { return { error: String(e) }; }
});

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
console.log(JSON.stringify({ hud, cam, exited, engine, terrain, errors: realErrors.slice(0, 25) }, null, 2));
await browser.close();

if (process.env.EXPECT_LIBFPV) {
  const fails = [];
  if (!engine.real) fails.push("LibFPV engine did not load (fell back to the basic drone)");
  if (engine.real && !engine.simTimeAdvanced) fails.push("LibFPV simulation time did not advance");
  if (engine.real && engine.osdPixels < 100) fails.push("Betaflight OSD did not draw");
  if (!exited) fails.push("could not exit drone mode");
  if (!terrain.on) fails.push("free 3D terrain provider is not active");
  if (!(terrain.rainierSummitM > 3800 && terrain.rainierSummitM < 4600)) fails.push(`terrain height check failed: ${JSON.stringify(terrain)}`);
  if (realErrors.some((e) => e.startsWith("pageerror"))) fails.push("page errors: " + realErrors.join(" | "));
  if (fails.length) { console.error("SMOKE TEST FAILED:\n- " + fails.join("\n- ")); process.exit(1); }
  console.log("SMOKE TEST PASSED");
}
