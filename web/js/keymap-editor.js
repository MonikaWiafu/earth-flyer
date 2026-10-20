// "Keyboard keys" editor in Settings: rebind the drone's keyboard controls.
import { ACTIONS, defaultKeymap, keyLabel, RESERVED } from "./drone/keys.js";

export function wireKeymapEditor({ settings, save, onChange }) {
  const table = document.getElementById("keymap");
  const msg = document.getElementById("keymap-msg");
  let listening = null; // action id waiting for a key

  const current = () => ({ ...defaultKeymap(), ...(settings.keymap || {}) });

  function render() {
    const map = current();
    table.innerHTML = "";
    let group = "";
    for (const a of ACTIONS) {
      if (a.group !== group) {
        group = a.group;
        const tr = table.insertRow();
        const th = document.createElement("th");
        th.colSpan = 2;
        th.textContent = group === "Flight" ? "Flying (keyboard fallback)" : "Drone mode";
        tr.appendChild(th);
      }
      const tr = table.insertRow();
      tr.insertCell().textContent = a.label;
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "btn small keybtn" + (listening === a.id ? " listening" : "");
      btn.textContent = listening === a.id ? "Press a key…" : keyLabel(map[a.id]);
      btn.setAttribute("aria-label", `${a.label}: ${keyLabel(map[a.id])}. Click to change.`);
      btn.addEventListener("click", () => { listening = a.id; msg.textContent = "Esc cancels."; render(); });
      tr.insertCell().appendChild(btn);
    }
  }

  function commit(map) {
    settings.keymap = map;
    save(settings);
    onChange();
  }

  // Capture the next key while listening (capture phase, before anything else).
  window.addEventListener("keydown", (e) => {
    if (!listening) return;
    e.preventDefault();
    e.stopPropagation();
    if (e.code === "Escape") { listening = null; msg.textContent = ""; render(); return; }
    if (RESERVED.has(e.code)) { msg.textContent = `${e.code} is reserved (F8 setup menu, F11 fullscreen, F12 tools).`; return; }
    const map = current();
    const other = ACTIONS.find((a) => a.id !== listening && map[a.id] === e.code);
    const old = map[listening];
    map[listening] = e.code;
    if (other) map[other.id] = old; // swap so no two actions share a key
    const label = ACTIONS.find((a) => a.id === listening).label;
    msg.textContent = other ? `${label} → ${keyLabel(e.code)} (swapped with ${other.label})` : `${label} → ${keyLabel(e.code)}`;
    listening = null;
    commit(map);
    render();
  }, true);

  document.getElementById("keymap-reset").addEventListener("click", () => {
    listening = null;
    commit(defaultKeymap());
    msg.textContent = "Keys reset to defaults.";
    render();
  });
  // Stop listening if the dialog closes.
  document.getElementById("settings").addEventListener("close", () => { listening = null; msg.textContent = ""; render(); });

  render();
  return { render };
}
