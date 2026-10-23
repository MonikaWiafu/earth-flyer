// Earth Flyer - entry point.
/* global Cesium */
import { loadSettings, saveSettings, effectiveMode, wireSettingsDialog } from "./settings.js";
import { createViewer, applyMapSource, swoopTo, flyHome, wireCoords, setFreeTerrain } from "./globe.js";
import { wireSearch } from "./search.js";
import { wireSky } from "./sky.js";
import { DroneMode } from "./drone/drone-mode.js";
import { wireKeymapEditor } from "./keymap-editor.js";
import { wireDroneOptions } from "./drone-options.js";
import { BuildingLayer } from "./buildings/buildings.js";
import { wireBuildingsUI } from "./buildings/buildings-ui.js";

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

  const buildings = new BuildingLayer(viewer);
  window.efBuildings = buildings; // handy in devtools
  let buildingsUI = null;

  let mode = effectiveMode(settings);
  async function loadSource() {
    mode = effectiveMode(settings);
    try {
      await applyMapSource(viewer, mode, settings);
    } catch (e) {
      console.error(e);
      if (mode !== "free") {
        toast(mode === "ion"
          ? "Google 3D via Cesium ion failed to load (check the token in Settings, or this month's free limit). Showing free imagery."
          : "Google 3D Tiles failed to load (check the API key in Settings). Showing free imagery.", 8000);
        mode = "free";
        await applyMapSource(viewer, mode, settings);
      }
    }
    search.refresh();
    syncTerrainButton();
    buildings.setHighDetail(!!settings.highDetail);
    buildings.setAvailable(mode === "free"); // Google's tiles already contain buildings
    buildings.reload();                          // terrain under them may have changed
    buildingsUI?.sync();
  }

  // Terrain toggle (free mode only; Google's 3D tiles already include terrain).
  const terrainBtn = document.getElementById("btn-terrain");
  function syncTerrainButton() {
    const google = mode !== "free"; // both Google modes carry their own terrain
    terrainBtn.disabled = google;
    terrainBtn.style.opacity = google ? "0.45" : "";
    terrainBtn.title = google ? "Google 3D tiles already include terrain" : "3D terrain on/off (T)";
    terrainBtn.setAttribute("aria-pressed", String(!google && settings.terrain !== false));
  }
  function toggleTerrain() {
    if (mode !== "free" || drone.active) return;
    settings.terrain = settings.terrain === false;
    saveSettings(settings);
    setFreeTerrain(viewer, settings.terrain);
    syncTerrainButton();
    buildings.reload(); // re-seat the buildings on (or off) the terrain
    toast(settings.terrain ? "3D terrain on" : "3D terrain off (flat globe)", 1500);
  }
  terrainBtn.addEventListener("click", toggleTerrain);

  const search = wireSearch({
    getMode: () => mode,
    getKey: () => settings.apiKey,
    getIonToken: () => settings.ionToken,
    getScene: () => viewer.scene,
    onPick: (place) => swoopTo(viewer, place),
  });
  wireSettingsDialog({ settings, onSave: () => loadSource(), guideUrl: GUIDE_URL });
  wireSky(viewer);
  wireCoords(viewer);

  buildingsUI = wireBuildingsUI({ layer: buildings, settings, save: saveSettings, toast });
  const drone = new DroneMode(viewer, { toast, settings, saveSettings, buildings });
  window.efDrone = drone; // handy in devtools
  document.getElementById("btn-drone").addEventListener("click", () => (drone.active ? drone.exit() : drone.enter()));
  document.getElementById("btn-home").addEventListener("click", () => flyHome(viewer));
  wireKeymapEditor({ settings, save: saveSettings, onChange: () => drone.refreshKeymap() });
  wireDroneOptions({ settings, save: saveSettings, drone, toast });
  document.getElementById("set-drone-setup").addEventListener("click", () => {
    document.getElementById("settings").close("setup");
    drone.openSetup();
  });
  window.addEventListener("keydown", (e) => {
    if (e.code === "F8" && !drone.active && !drone.setupOpen) {
      e.preventDefault();
      if (!document.getElementById("settings").open) drone.openSetup();
      return;
    }
    if (drone.active || drone.setupOpen || e.target.closest("input, textarea, dialog")) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    if (e.code === "KeyD") drone.enter();
    if (e.code === "KeyT") toggleTerrain();
  });

  await loadSource();
  document.getElementById("boot").classList.add("done");
  if (mode === "free") {
    toast("Free imagery mode. Add a free Cesium ion token in Settings for Google's photorealistic 3D cities.", 6000);
  }
}

main().catch((e) => {
  console.error(e);
  document.getElementById("boot-msg").textContent = "Something went wrong: " + (e.message || e);
});
