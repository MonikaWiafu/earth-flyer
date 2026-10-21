// Settings kept per browser / desktop app (localStorage, guarded: it can throw
// in private windows or be unavailable).
const KEY = "earthflyer.settings.v1";

const defaults = {
  apiKey: "",
  mode: "auto",     // "google" | "free" | "auto" (google when a key exists)
  highDetail: false,
  terrain: true,    // free 3D terrain under the free imagery
  buildings: "textured", // "off" | "plain" (3D over 2D) | "textured" (2D over 3D)
  buildingWalls: "projected", // "projected" | "roof"
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

export function effectiveMode(s) {
  if (s.mode === "free") return "free";
  if (s.mode === "google") return s.apiKey ? "google" : "free";
  return s.apiKey ? "google" : "free";
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
  const quality = document.getElementById("set-quality");
  const testBtn = document.getElementById("set-test");
  const testOut = document.getElementById("set-test-out");
  document.getElementById("key-guide-link").href = guideUrl;

  function open() {
    keyIn.value = settings.apiKey || "";
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

  dlg.addEventListener("close", () => {
    if (dlg.returnValue !== "save") return;
    const mode = dlg.querySelector('input[name="mode"]:checked')?.value || "auto";
    settings.apiKey = keyIn.value.trim();
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
