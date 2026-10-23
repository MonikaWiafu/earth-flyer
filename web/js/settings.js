// Settings kept per browser / desktop app (localStorage, guarded: it can throw
// in private windows or be unavailable).
const KEY = "earthflyer.settings.v1";

const defaults = {
  apiKey: "",
  ionToken: "",     // Cesium ion token: Google 3D tiles through Cesium (no Google key)
  mode: "auto",     // "google" | "ion" | "free" | "auto"
  highDetail: false,
  terrain: true,    // free 3D terrain under the free imagery
  buildings: "textured", // "off" | "plain" (3D over 2D) | "textured" (2D over 3D)
  buildingWalls: "projected", // "projected" | "roof"
  realisticVideo: false, // range limit + static (off: clean video at any distance)
  infiniteBattery: true, // battery never drains (still sags under load)
  collision: "full",     // "full" ground + buildings, "ground" terrain only, "off" launch pad only
  worldScale: 1,         // drone size vs world: engine metres = world metres × worldScale
  invertAxes: { roll: false, pitch: false, throttle: false, yaw: false }, // every input source
  helpSeen: false,
};

export function loadSettings() {
  try {
    const raw = localStorage.getItem(KEY);
    if (raw) return { ...defaults, ...JSON.parse(raw) };
  } catch (_) { /* storage unavailable */ }
  return { ...defaults };
}

export function saveSettings(s) {
  try { localStorage.setItem(KEY, JSON.stringify(s)); } catch (_) { /* ignore */ }
}

// Which map source actually runs, given what keys/tokens exist.
export function effectiveMode(s) {
  if (s.mode === "free") return "free";
  if (s.mode === "google") return s.apiKey ? "google" : s.ionToken ? "ion" : "free";
  if (s.mode === "ion") return s.ionToken ? "ion" : s.apiKey ? "google" : "free";
  return s.apiKey ? "google" : s.ionToken ? "ion" : "free"; // auto
}

// Checks a Cesium ion token: the Google 3D tiles asset (2275207) and Google search via ion.
export async function testIonToken(token) {
  const out = { tiles: false, geocode: false, detail: "" };
  const t = encodeURIComponent(token);
  try {
    const r = await fetch(`https://api.cesium.com/v1/assets/2275207/endpoint?access_token=${t}`);
    out.tiles = r.ok;
    if (!r.ok) out.detail = `3D tiles: HTTP ${r.status}${r.status === 401 ? " (token not valid or missing assets:read)" : r.status === 404 ? " (asset not available to this token)" : ""}`;
  } catch (e) { out.detail = `3D tiles: ${e.message}`; }
  try {
    const r = await fetch(`https://api.cesium.com/v1/geocode/search?text=Paris&geocoder=google&access_token=${t}`);
    out.geocode = r.ok;
    if (!r.ok) out.detail += `${out.detail ? " · " : ""}Search: HTTP ${r.status}${r.status === 401 || r.status === 403 ? " (token missing the geocode scope)" : ""}`;
  } catch (e) { out.detail += `${out.detail ? " · " : ""}Search: ${e.message}`; }
  return out;
}

// Checks a key against the Map Tiles API root and the Geocoding API.
export async function testKey(key) {
  const out = { tiles: false, geocode: false, detail: "" };
  try {
    const r = await fetch(`https://tile.googleapis.com/v1/3dtiles/root.json?key=${encodeURIComponent(key)}`);
    out.tiles = r.ok;
    if (!r.ok) out.detail = `Map Tiles API: HTTP ${r.status}`;
  } catch (e) { out.detail = `Map Tiles API: ${e.message}`; }
  try {
    const r = await fetch(`https://maps.googleapis.com/maps/api/geocode/json?address=Paris&key=${encodeURIComponent(key)}`);
    const j = await r.json();
    out.geocode = j.status === "OK";
    if (!out.geocode) out.detail += `${out.detail ? " · " : ""}Geocoding API: ${j.status}${j.error_message ? " (" + j.error_message + ")" : ""}`;
  } catch (e) { out.detail += `${out.detail ? " · " : ""}Geocoding API: ${e.message}`; }
  return out;
}

export function wireSettingsDialog({ settings, onSave, guideUrl }) {
  const dlg = document.getElementById("settings");
  const keyIn = document.getElementById("set-key");
  const ionIn = document.getElementById("set-ion");
  const ionTestBtn = document.getElementById("set-ion-test");
  const ionTestOut = document.getElementById("set-ion-test-out");
  const quality = document.getElementById("set-quality");
  const testBtn = document.getElementById("set-test");
  const testOut = document.getElementById("set-test-out");
  document.getElementById("key-guide-link").href = guideUrl;

  function open() {
    keyIn.value = settings.apiKey || "";
    ionIn.value = settings.ionToken || "";
    ionTestOut.textContent = "";
    quality.checked = !!settings.highDetail;
    const mode = effectiveMode(settings);
    for (const r of dlg.querySelectorAll('input[name="mode"]')) r.checked = r.value === mode;
    testOut.textContent = "";
    dlg.showModal();
  }

  testBtn.addEventListener("click", async () => {
    const k = keyIn.value.trim();
    if (!k) { testOut.textContent = "Paste a key first."; return; }
    testOut.textContent = "Testing…";
    const r = await testKey(k);
    testOut.innerHTML = `3D tiles ${r.tiles ? "✓" : "✗"} · search ${r.geocode ? "✓" : "✗"}` +
      (r.detail ? `<br><span class="muted">${escapeHtml(r.detail)}</span>` : "");
  });

  ionTestBtn.addEventListener("click", async () => {
    const t = ionIn.value.trim();
    if (!t) { ionTestOut.textContent = "Paste a token first."; return; }
    ionTestOut.textContent = "Testing…";
    const r = await testIonToken(t);
    ionTestOut.innerHTML = `Google 3D tiles ${r.tiles ? "✓" : "✗"} · search ${r.geocode ? "✓" : "✗"}` +
      (r.detail ? `<br><span class="muted">${escapeHtml(r.detail)}</span>` : "");
  });

  dlg.addEventListener("close", () => {
    if (dlg.returnValue !== "save") return;
    const mode = dlg.querySelector('input[name="mode"]:checked')?.value || "auto";
    settings.apiKey = keyIn.value.trim();
    settings.ionToken = ionIn.value.trim();
    settings.mode = mode;
    settings.highDetail = quality.checked;
    saveSettings(settings);
    onSave(settings);
  });

  document.getElementById("btn-settings").addEventListener("click", open);
  return { open };
}

export function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}
