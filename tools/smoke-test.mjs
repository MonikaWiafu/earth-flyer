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

console.log(JSON.stringify({ hud, cam, exited, errors: errors.slice(0, 25) }, null, 2));
await browser.close();
