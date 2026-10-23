// LibFPV engine: real Betaflight + quad physics compiled to WebAssembly
// (native/earthflyer_fpv.c, built by CI into web/wasm/).
//
// All coordinates are a local East-North-Up frame in metres.

const FLAGS = {
  ARMED: 1 << 0, FAILSAFE: 1 << 1, CRASHED: 1 << 2, BEEPER: 1 << 3, PAUSED: 1 << 4,
  ON_GROUND: 1 << 5, ANGLE: 1 << 6, HORIZON: 1 << 7, TURTLE: 1 << 8, OSD_DISABLED: 1 << 9,
};
export { FLAGS };

export async function loadLibFPV() {
  const url = new URL("../../wasm/earthflyer_fpv.js", import.meta.url).href;
  const mod = await import(/* @vite-ignore */ url);
  const M = await mod.default();
  return new LibFPVEngine(M);
}

class LibFPVEngine {
  constructor(M) {
    this.M = M;
    this.name = "LibFPV (Betaflight)";
    this.real = true;
    this.hasOverlay = true;
    this.hasAudio = true;
    if (!M._ef_init()) throw new Error("libfpv init failed: " + M.UTF8ToString(M._ef_last_error()));
    this.version = M.UTF8ToString(M._ef_version());
    this._meshPtrs = [];
  }

  loadMesh(positions, indices, materials) {
    const M = this.M;
    for (const p of this._meshPtrs) M._free(p);
    const pp = M._malloc(positions.byteLength);
    const ip = M._malloc(indices.byteLength);
    const mp = materials ? M._malloc(materials.byteLength) : 0;
    M.HEAPF32.set(positions, pp >> 2);
    M.HEAPU32.set(indices, ip >> 2);
    if (mp) M.HEAPU8.set(materials, mp);
    const ok = M._ef_load_mesh(pp, positions.length / 3, ip, indices.length / 3, mp);
    // libfpv copies the data; free right away.
    M._free(pp); M._free(ip); if (mp) M._free(mp);
    this._meshPtrs = [];
    return !!ok;
  }

  spawn(x, y, z, yaw) {
    if (!this.M._ef_spawn(x, y, z, yaw)) throw new Error(this.M.UTF8ToString(this.M._ef_last_error()));
  }
  repair() { this.M._ef_repair(); }
  despawn() { this.M._ef_despawn(); }
  setPaused(p) { this.M._ef_set_paused(p ? 1 : 0); }
  // Earth Flyer options (patches/libfpv-earthflyer.patch)
  setInfiniteBattery(on) { this.M._ef_set_infinite_battery?.(on ? 1 : 0); }
  setUnlimitedVideo(on) { this.M._ef_set_unlimited_video?.(on ? 1 : 0); }
  // bits: 1 roll, 2 pitch, 4 throttle, 8 yaw
  setInverted(mask) { this.M._ef_set_inverted?.(mask >>> 0); }

  tick(dt) {
    const M = this.M;
    const ptr = M._ef_tick(dt) >> 2;
    const s = M.HEAPF32.subarray(ptr, ptr + 64);
    const cam = (o, fov, near) => ({
      pos: [s[o], s[o + 1], s[o + 2]], fwd: [s[o + 3], s[o + 4], s[o + 5]], up: [s[o + 6], s[o + 7], s[o + 8]],
      fov: s[fov], near: near === undefined ? 0.05 : s[near],
    });
    return {
      pos: [s[0], s[1], s[2]],
      rot: [s[3], s[4], s[5], s[6]],
      vel: [s[7], s[8], s[9]],
      speedKmh: s[10],
      alt: s[11],
      cams: { fpv: cam(12, 21, 22), chase: cam(24, 33, 34), los: cam(35, 44) },
      flags: s[45] | 0,
      battery: { volts: s[46], cell: s[47], mah: s[48] },
      noise: s[49], breakup: s[50],
      osdRev: s[51],
      impacts: s[52] | 0, impactSpeed: s[53],
      rpm: [s[54], s[55], s[56], s[57]],
      time: s[58],
      armingText: M.UTF8ToString(M._ef_arming_text()),
    };
  }

  key(code, down) { if (code) this.M._ef_key(code, down ? 1 : 0); }

  inputStatus() {
    const [src, needsSetup, count, ...name] = this.M.UTF8ToString(this.M._ef_input_status()).split("|");
    const kinds = ["none", "radio", "gamepad", "keyboard", "host"];
    return { source: kinds[+src] || "none", needsSetup: needsSetup === "1", devices: +count, device: name.join("|") };
  }

  // OSD as ImageData (w x h), or null.
  osd(w, h, hd) {
    const ptr = this.M._ef_osd_rgba(w, h, hd ? 1 : 0);
    if (!ptr) return null;
    return new ImageData(new Uint8ClampedArray(this.M.HEAPU8.buffer, ptr, w * h * 4).slice(), w, h);
  }

  // ---- overlay (F8) ----
  overlayDisplay(w, h, scale) { this.M._ef_overlay_display(w, h, scale); }
  overlayRender(dt) {
    const M = this.M;
    const n = M._ef_overlay_render(dt);
    if (!n) return null;
    const vp = M._ef_overlay_vertices() >> 2, vn = M._ef_overlay_vertex_count();
    const ip = M._ef_overlay_indices() >> 2, inN = M._ef_overlay_index_count();
    const cp = M._ef_overlay_commands() >> 2;
    return {
      vertices: M.HEAPF32.subarray(vp, vp + vn * 5),
      indices: M.HEAPU32.subarray(ip, ip + inN),
      commands: M.HEAPF32.subarray(cp, cp + n * 6),
      count: n,
    };
  }
  texture(id) {
    const M = this.M;
    const p = M._ef_texture(id);
    if (!p) return null;
    const ip = M._ef_texture_info() >> 2;
    const [w, h, rev] = M.HEAPU32.subarray(ip, ip + 3);
    return { width: w, height: h, revision: rev, rgba: M.HEAPU8.subarray(p, p + w * h * 4) };
  }
  overlayOpen() { return !!this.M._ef_overlay_is_open(); }
  overlayWantsInput() { return !!this.M._ef_overlay_wants_input(); }
  overlaySetOpen(o) { this.M._ef_overlay_set_open(o ? 1 : 0); }
  overlayMouseMove(x, y) { this.M._ef_overlay_mouse_move(x, y); }
  overlayMouseButton(b, d) { this.M._ef_overlay_mouse_button(b, d ? 1 : 0); }
  overlayWheel(dx, dy) { this.M._ef_overlay_mouse_wheel(dx, dy); }
  overlayText(t) {
    const p = this.M.stringToNewUTF8(t);
    this.M._ef_overlay_text(p);
    this.M._free(p);
  }
  overlaySetAction(id, label) {
    const p = this.M.stringToNewUTF8(label || "");
    this.M._ef_overlay_set_action(id, p);
    this.M._free(p);
  }
  overlayPollAction() { return this.M._ef_overlay_poll_action(); }

  // ---- audio ----
  audioConfigure(rate) { this.M._ef_audio_configure(rate); }
  audioRead(frames) {
    const p = this.M._ef_audio_read(frames);
    return p ? this.M.HEAPF32.subarray(p >> 2, (p >> 2) + frames) : null;
  }
  audioVolume(v) { this.M._ef_audio_volume(v); }
}
