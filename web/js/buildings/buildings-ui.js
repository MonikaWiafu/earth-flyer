// Toolbar "Buildings" button + popover menu.

export function wireBuildingsUI({ layer, settings, save, toast }) {
  const btn = document.getElementById("btn-buildings");
  const panel = document.getElementById("buildings-panel");
  const status = document.getElementById("buildings-status");
  const wallsSet = document.getElementById("bwalls-set");
  const skyPanel = document.getElementById("sky-panel");

  function sync() {
    for (const r of panel.querySelectorAll('input[name="bmode"]')) r.checked = r.value === settings.buildings;
    for (const r of panel.querySelectorAll('input[name="bwalls"]')) r.checked = r.value === settings.buildingWalls;
    wallsSet.disabled = settings.buildings !== "textured" || !layer.available;
    btn.setAttribute("aria-pressed", String(layer.available && settings.buildings !== "off"));
    btn.disabled = !layer.available;
    btn.style.opacity = layer.available ? "" : "0.45";
    btn.title = layer.available ? "3D buildings" : "Google 3D tiles already include buildings";
  }

  btn.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    if (!panel.hidden) { skyPanel.hidden = true; document.getElementById("btn-sky").setAttribute("aria-pressed", "false"); }
  });
  // The sky button closes this panel too (one popover at a time).
  document.getElementById("btn-sky").addEventListener("click", () => { panel.hidden = true; });

  panel.addEventListener("change", (e) => {
    if (e.target.name === "bmode") {
      settings.buildings = e.target.value;
      layer.setMode(settings.buildings);
      if (settings.buildings !== "off") {
        toast(settings.buildings === "plain" ? "3D buildings over the 2D map" : "Satellite-textured 3D buildings", 1800);
      }
    }
    if (e.target.name === "bwalls") {
      settings.buildingWalls = e.target.value;
      layer.setWalls(settings.buildingWalls);
    }
    save(settings);
    sync();
  });

  layer.onStatus = ({ loading, buildings }) => {
    if (!layer.active) { status.textContent = ""; return; }
    status.textContent = loading
      ? `Loading buildings… (${buildings.toLocaleString()} so far)`
      : buildings ? `${buildings.toLocaleString()} buildings around you` : "Zoom in to a town or city to load buildings.";
  };

  layer.setWalls(settings.buildingWalls);
  layer.setMode(settings.buildings);
  sync();
  return { sync };
}
