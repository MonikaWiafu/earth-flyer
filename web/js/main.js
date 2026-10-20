// Earth Flyer - entry point.
/* global Cesium */
import { loadSettings, saveSettings, effectiveMode, wireSettingsDialog } from "./settings.js";
import { createViewer, applyMapSource, swoopTo, flyHome, wireCoords } from "./globe.js";
import { wireSearch } from "./search.js";
import { wireSky } from "./sky.js";
import { DroneMode } from "./drone/drone-mode.js";

const GUIDE_URL = "https://github.com/MonikaWiafu/earth-flyer/blob/main/docs/GOOGLE_API_KEY.md";

function cesiumReady() {
  return window.Cesium ? Promise.resolve() : new Promise((r) => window.addEventListener("cesium-ready", r, { once: true }));
}

let toastTimer = 0;
function toast(msg, ms = 3500) {
  const el = document.getElementById("toast");
  el.textContent = msg;
  el.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => { el.hidden = true; }, ms);
}

async function main() {
  await cesiumReady();
  // Cesium ion is not used; silence its default-token banner.
  Cesium.Ion.defaultAccessToken = undefined;

  const settings = loadSettings();
  const viewer = createViewer("globe");
  window.efViewer = viewer; // handy in devtools

  let mode = effectiveMode(settings);
  async function loadSource() {
    mode = effectiveMode(settings);
    try {
      await applyMapSource(viewer, mode, settings);
    } catch (e) {
      console.error(e);
      if (mode === "google") {
        toast("Google 3D Tiles failed to load (check the API key in Settings). Showing free imagery.", 7000);
        mode = "free";
        await applyMapSource(viewer, mode, settings);
      }
    }
    search.refresh();
  }

  const search = wireSearch({
    getMode: () => mode,
    getKey: () => settings.apiKey,
    onPick: (place) => swoopTo(viewer, place),
  });
  wireSettingsDialog({ settings, onSave: () => loadSource(), guideUrl: GUIDE_URL });
  wireSky(viewer);
  wireCoords(viewer);

  const drone = new DroneMode(viewer, { toast, settings, saveSettings });
  window.efDrone = drone; // handy in devtools
  document.getElementById("btn-drone").addEventListener("click", () => (drone.active ? drone.exit() : drone.enter()));
  document.getElementById("btn-home").addEventListener("click", () => flyHome(viewer));
  window.addEventListener("keydown", (e) => {
    if (drone.active || e.target.closest("input, textarea, dialog")) return;
    if (e.code === "KeyD" && !e.ctrlKey && !e.metaKey) drone.enter();
  });

  await loadSource();
  document.getElementById("boot").classList.add("done");
  if (mode === "free") {
    toast("Free imagery mode. Add a Google API key in Settings for photorealistic 3D cities.", 6000);
  }
}

main().catch((e) => {
  console.error(e);
  document.getElementById("boot-msg").textContent = "Something went wrong: " + (e.message || e);
});
