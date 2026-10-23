// Settings → Drone controls: video signal, infinite battery, world scale.
// Like the keyboard editor, these save immediately (no need to press Save).
import { scaleLabel } from "./drone/scaled-engine.js";

export function wireDroneOptions({ settings, save, drone, toast }) {
  const video = document.getElementById("set-video");
  const battery = document.getElementById("set-battery");
  const scale = document.getElementById("set-scale");
  const scaleOut = document.getElementById("set-scale-out");

  // slider is log10(scale): -1 .. 1  ->  0.1x .. 10x
  const toK = (v) => (Math.abs(v) < 0.025 ? 1 : Math.pow(10, v));
  const toV = (k) => Math.log10(Math.min(10, Math.max(0.1, k || 1)));

  const invertBoxes = [...document.querySelectorAll(".invert input[data-axis]")];
  for (const box of invertBoxes) {
    box.addEventListener("change", () => {
      settings.invertAxes = { ...(settings.invertAxes || {}), [box.dataset.axis]: box.checked };
      save(settings);
      drone.applyOptions();
    });
  }

  function sync() {
    for (const box of invertBoxes) box.checked = !!(settings.invertAxes || {})[box.dataset.axis];
    video.checked = !!settings.realisticVideo;
    battery.checked = settings.infiniteBattery !== false;
    scale.value = String(toV(settings.worldScale));
    scaleOut.textContent = scaleLabel(settings.worldScale || 1);
  }

  video.addEventListener("change", () => {
    settings.realisticVideo = video.checked;
    save(settings);
    drone.applyOptions();
  });
  battery.addEventListener("change", () => {
    settings.infiniteBattery = battery.checked;
    save(settings);
    drone.applyOptions();
  });
  scale.addEventListener("input", () => {
    settings.worldScale = +toK(+scale.value).toPrecision(3);
    scaleOut.textContent = scaleLabel(settings.worldScale);
  });
  scale.addEventListener("change", () => {
    save(settings);
    if (drone.active && drone.scale !== settings.worldScale) toast("New world scale applies when you respawn (R).", 3000);
  });

  document.getElementById("btn-settings").addEventListener("click", sync);
  sync();
  return { sync };
}
