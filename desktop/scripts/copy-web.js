// Copies ../web (with vendor/cesium and wasm/) into ./web for packaging.
// A plain recursive copy (fs.cpSync behaved differently on the macOS runner).
const fs = require("node:fs");
const path = require("node:path");

const src = path.resolve(__dirname, "..", "..", "web");
const dst = path.resolve(__dirname, "..", "web");

function copyDir(from, to) {
  fs.mkdirSync(to, { recursive: true });
  for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
    const a = path.join(from, entry.name);
    const b = path.join(to, entry.name);
    if (entry.isDirectory()) copyDir(a, b);
    else if (entry.isFile()) fs.copyFileSync(a, b);
    else if (entry.isSymbolicLink()) {
      const real = fs.realpathSync(a);
      if (fs.statSync(real).isDirectory()) copyDir(real, b);
      else fs.copyFileSync(real, b);
    }
  }
}

fs.rmSync(dst, { recursive: true, force: true });
copyDir(src, dst);

const missing = ["index.html", "vendor/cesium/Cesium.js"].filter((f) => !fs.existsSync(path.join(dst, f)));
if (missing.length) {
  console.error(`missing in desktop/web: ${missing.join(", ")}`);
  console.error(`source ${src}: ${fs.readdirSync(src).join(" ")}`);
  const v = path.join(src, "vendor");
  if (fs.existsSync(v)) console.error(`source vendor: ${fs.readdirSync(v).join(" ")}`);
  const vc = path.join(v, "cesium");
  if (fs.existsSync(vc)) console.error(`source vendor/cesium: ${fs.readdirSync(vc).slice(0, 20).join(" ")}`);
  console.error("Run scripts/fetch-cesium.sh first.");
  process.exit(1);
}
if (!fs.existsSync(path.join(dst, "wasm", "earthflyer_fpv.wasm")))
  console.warn("warning: web/wasm/earthflyer_fpv.wasm missing - the app will use the basic drone");
console.log("copied web ->", dst);
