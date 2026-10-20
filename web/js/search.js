// Search box. Google mode must use Google's geocoder (a condition of the
// Photorealistic 3D Tiles terms); free mode uses OpenStreetMap Nominatim.
/* global Cesium */
import { escapeHtml } from "./settings.js";

export function wireSearch({ getMode, getKey, onPick }) {
  const form = document.getElementById("search-form");
  const input = document.getElementById("search-input");
  const list = document.getElementById("search-results");
  const source = document.getElementById("search-source");
  let googleService = null, googleKey = null;

  function setSource() {
    source.textContent = getMode() === "google" ? "Search by Google" : "Search by OpenStreetMap Nominatim";
  }
  setSource();

  async function geocode(q) {
    // "lat, lon" typed directly
    const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[, ]\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (m) {
      const lat = +m[1], lon = +m[2];
      if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180)
        return [{ displayName: `${lat}, ${lon}`, destination: Cesium.Cartesian3.fromDegrees(lon, lat, 0) }];
    }
    if (getMode() === "google") {
      if (!googleService || googleKey !== getKey()) {
        googleKey = getKey();
        googleService = new Cesium.GoogleGeocoderService({ key: googleKey });
      }
      return googleService.geocode(q);
    }
    const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&q=${encodeURIComponent(q)}`;
    const r = await fetch(url, { headers: { Accept: "application/json" } });
    if (!r.ok) throw new Error(`Search failed (HTTP ${r.status})`);
    const rows = await r.json();
    return rows.map((row) => {
      const [s, n, w, e] = row.boundingbox.map(Number);
      return {
        displayName: row.display_name,
        destination: Cesium.Rectangle.fromDegrees(w, s, e, n),
      };
    });
  }

  function show(results) {
    list.innerHTML = "";
    if (!results.length) {
      list.innerHTML = `<li class="muted" tabindex="-1">No results</li>`;
      list.hidden = false;
      return;
    }
    results.slice(0, 6).forEach((r, i) => {
      const li = document.createElement("li");
      li.tabIndex = 0;
      li.innerHTML = escapeHtml(r.displayName);
      const go = () => { list.hidden = true; input.blur(); onPick(r); };
      li.addEventListener("click", go);
      li.addEventListener("keydown", (e) => { if (e.key === "Enter") go(); });
      list.appendChild(li);
      if (i === 0) li.dataset.first = "1";
    });
    list.hidden = false;
  }

  form.addEventListener("submit", async (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (!q) return;
    setSource();
    list.hidden = false;
    list.innerHTML = `<li class="muted" tabindex="-1">Searching…</li>`;
    try {
      const results = await geocode(q);
      // A single confident hit: fly straight there, like Google Earth.
      if (results.length === 1) { list.hidden = true; onPick(results[0]); return; }
      show(results);
    } catch (err) {
      list.innerHTML = `<li class="muted" tabindex="-1">${escapeHtml(err.message || String(err))}</li>`;
    }
  });
  input.addEventListener("keydown", (e) => { if (e.key === "Escape") list.hidden = true; });
  // Typing must not drive the drone / globe keyboard shortcuts.
  input.addEventListener("keydown", (e) => e.stopPropagation());
  return { refresh: setSource };
}
