// Copies ../web (with vendor/cesium and wasm/) into ./web for packaging.
const fs = require("node:fs");
const path = require("node:path");

const src = path.join(__dirname, "..", "..", "web");
const dst = path.join(__dirname, "..", "web");
fs.rmSync(dst, { recursive: true, force: true });
fs.cpSync(src, dst, { recursive: true });
for (const need of ["index.html", "vendor/cesium/Cesium.js"]) {
  if (!fs.existsSync(path.join(dst, need))) {
    console.error(`missing web/${need} (run scripts/fetch-cesium.sh first)`);
    process.exit(1);
  }
}
if (!fs.existsSync(path.join(dst, "wasm", "earthflyer_fpv.wasm")))
  console.warn("warning: web/wasm/earthflyer_fpv.wasm missing - the app will use the basic drone");
console.log("copied web ->", dst);
