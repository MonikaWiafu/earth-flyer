// Keyboard handling for drone mode.
//
// LibFPV's keyboard fallback listens to fixed keys (W/S throttle, A/D yaw,
// arrows pitch/roll, Enter arm, T turtle, B beeper). Earth Flyer lets the
// player rebind them: a pressed key is translated to the libfpv key it stands
// for before it reaches the engine.

// Browser KeyboardEvent.code -> libfpv fpv_key codes (include/libfpv.h).
const SPECIAL = {
  Tab: 9, Enter: 13, NumpadEnter: 13, Escape: 27, Space: 32,
  ArrowLeft: 256, ArrowRight: 257, ArrowUp: 258, ArrowDown: 259,
  PageUp: 260, PageDown: 261, Home: 262, End: 263, Insert: 264, Delete: 265, Backspace: 266,
  ShiftLeft: 267, ShiftRight: 268, ControlLeft: 269, ControlRight: 270, AltLeft: 271, AltRight: 272,
};

// Raw translation, no remapping (used by the setup menu for text and navigation).
export function fpvKeyFromCode(code) {
  if (SPECIAL[code] !== undefined) return SPECIAL[code];
  let m = code.match(/^Key([A-Z])$/);
  if (m) return m[1].charCodeAt(0);
  m = code.match(/^Digit([0-9])$/);
  if (m) return m[1].charCodeAt(0);
  m = code.match(/^F([1-9]|1[0-2])$/);
  if (m) return 272 + Number(m[1]); // F1 = 273
  return 0;
}

// Rebindable actions. `fpv` is the key libfpv listens for; app actions have none.
export const ACTIONS = [
  { id: "throttleUp", label: "Throttle up", group: "Flight", def: "KeyW", fpv: "KeyW" },
  { id: "throttleDown", label: "Throttle down", group: "Flight", def: "KeyS", fpv: "KeyS" },
  { id: "yawLeft", label: "Yaw left", group: "Flight", def: "KeyA", fpv: "KeyA" },
  { id: "yawRight", label: "Yaw right", group: "Flight", def: "KeyD", fpv: "KeyD" },
  { id: "pitchForward", label: "Pitch forward", group: "Flight", def: "ArrowUp", fpv: "ArrowUp" },
  { id: "pitchBack", label: "Pitch back", group: "Flight", def: "ArrowDown", fpv: "ArrowDown" },
  { id: "rollLeft", label: "Roll left", group: "Flight", def: "ArrowLeft", fpv: "ArrowLeft" },
  { id: "rollRight", label: "Roll right", group: "Flight", def: "ArrowRight", fpv: "ArrowRight" },
  { id: "arm", label: "Arm / disarm", group: "Flight", def: "Enter", fpv: "Enter" },
  { id: "turtle", label: "Turtle mode (flip over)", group: "Flight", def: "KeyT", fpv: "KeyT" },
  { id: "beeper", label: "Beeper", group: "Flight", def: "KeyB", fpv: "KeyB" },
  { id: "camera", label: "Change camera", group: "App", def: "KeyC" },
  { id: "respawn", label: "Respawn", group: "App", def: "KeyR" },
  { id: "exit", label: "Exit drone mode", group: "App", def: "KeyX" },
];

export function defaultKeymap() {
  return Object.fromEntries(ACTIONS.map((a) => [a.id, a.def]));
}

// Builds the lookup used while flying: physical code -> { action, fpvCode? }.
export function compileKeymap(keymap) {
  const map = { ...defaultKeymap(), ...(keymap || {}) };
  const byCode = new Map();
  for (const a of ACTIONS) {
    const code = map[a.id];
    if (!code) continue;
    byCode.set(code, { action: a.id, fpv: a.fpv ? fpvKeyFromCode(a.fpv) : 0 });
  }
  return byCode;
}

// Human label for a KeyboardEvent.code.
export function keyLabel(code) {
  if (!code) return "–";
  const names = {
    ArrowUp: "↑", ArrowDown: "↓", ArrowLeft: "←", ArrowRight: "→", Enter: "Enter", Space: "Space",
    ShiftLeft: "Left Shift", ShiftRight: "Right Shift", ControlLeft: "Left Ctrl", ControlRight: "Right Ctrl",
    AltLeft: "Left Alt", AltRight: "Right Alt", Backspace: "Backspace", Tab: "Tab",
  };
  if (names[code]) return names[code];
  let m = code.match(/^Key([A-Z])$/) || code.match(/^Digit([0-9])$/) || code.match(/^Numpad(.+)$/);
  if (m) return code.startsWith("Numpad") ? `Num ${m[1]}` : m[1];
  return code;
}

// Keys the app reserves: the setup menu toggle and browser/desktop shortcuts.
export const RESERVED = new Set(["F8", "F11", "F12", "Escape"]);
