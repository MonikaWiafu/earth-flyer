// Sun, time of day and atmosphere controls.
/* global Cesium */

export function wireSky(viewer) {
  const panel = document.getElementById("sky-panel");
  const btn = document.getElementById("btn-sky");
  const slider = document.getElementById("sky-time");
  const out = document.getElementById("sky-time-out");
  const animate = document.getElementById("sky-animate");
  const scene = viewer.scene;

  btn.addEventListener("click", () => {
    panel.hidden = !panel.hidden;
    btn.setAttribute("aria-pressed", String(!panel.hidden));
    if (!panel.hidden) syncSlider();
  });

  // Local *solar* time at the camera's longitude (what the sun actually does there).
  function cameraLonDeg() {
    return Cesium.Math.toDegrees(viewer.camera.positionCartographic.longitude);
  }
  function solarMinutes(jd) {
    const d = Cesium.JulianDate.toDate(jd);
    const utcMin = d.getUTCHours() * 60 + d.getUTCMinutes();
    return (((utcMin + cameraLonDeg() * 4) % 1440) + 1440) % 1440;
  }
  function fmt(min) {
    const h = Math.floor(min / 60), m = Math.round(min % 60);
    return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")} solar`;
  }
  function syncSlider() {
    const min = solarMinutes(viewer.clock.currentTime);
    slider.value = String(Math.round(min));
    out.textContent = fmt(min);
  }

  slider.addEventListener("input", () => {
    const target = +slider.value;
    const now = Cesium.JulianDate.toDate(viewer.clock.currentTime);
    const utcMin = ((target - cameraLonDeg() * 4) % 1440 + 1440) % 1440;
    const d = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate(), 0, 0, 0));
    d.setUTCMinutes(utcMin);
    viewer.clock.currentTime = Cesium.JulianDate.fromDate(d);
    animate.checked = false;
    viewer.clock.shouldAnimate = true;
    viewer.clock.multiplier = 0.0001; // effectively frozen, but keeps rendering
    out.textContent = fmt(target);
  });
  document.getElementById("sky-now").addEventListener("click", () => {
    viewer.clock.currentTime = Cesium.JulianDate.now();
    viewer.clock.multiplier = 1;
    animate.checked = true;
    syncSlider();
  });
  animate.addEventListener("change", () => {
    viewer.clock.multiplier = animate.checked ? 1 : 0.0001;
  });

  const bind = (id, fn) => {
    const el = document.getElementById(id);
    el.addEventListener("change", () => fn(el.checked));
  };
  bind("sky-lighting", (on) => { scene.globe.enableLighting = on; });
  bind("sky-atmo", (on) => { scene.skyAtmosphere.show = on; scene.globe.showGroundAtmosphere = on; });
  bind("sky-stars", (on) => { scene.skyBox.show = on; scene.sun.show = on; scene.moon.show = on; });
  bind("sky-fog", (on) => { scene.fog.enabled = on; });

  setInterval(() => { if (!panel.hidden && animate.checked) syncSlider(); }, 5000);
}
