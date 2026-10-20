// Browser KeyboardEvent.code -> libfpv fpv_key codes (include/libfpv.h).
const SPECIAL = {
  Tab: 9, Enter: 13, NumpadEnter: 13, Escape: 27, Space: 32,
  ArrowLeft: 256, ArrowRight: 257, ArrowUp: 258, ArrowDown: 259,
  PageUp: 260, PageDown: 261, Home: 262, End: 263, Insert: 264, Delete: 265, Backspace: 266,
  ShiftLeft: 267, ShiftRight: 268, ControlLeft: 269, ControlRight: 270, AltLeft: 271, AltRight: 272,
};

export function fpvKey(e) {
  if (SPECIAL[e.code] !== undefined) return SPECIAL[e.code];
  let m = e.code.match(/^Key([A-Z])$/);
  if (m) return m[1].charCodeAt(0);
  m = e.code.match(/^Digit([0-9])$/);
  if (m) return m[1].charCodeAt(0);
  m = e.code.match(/^F([1-9]|1[0-2])$/);
  if (m) return 272 + Number(m[1]); // F1 = 273
  return 0;
}
