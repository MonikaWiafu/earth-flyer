// Basic drone: a simple self-levelling quad used only when the LibFPV
// WebAssembly build is not present (e.g. before CI has built it). Same
// interface and the same ENU convention (x east, y north, z up) as libfpv.js.

const G = 9.81;

// ---- tiny quaternion helpers [x, y, z, w] ----
function qMul(a, b) {
  return [
    a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
    a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
    a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
    a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
  ];
}
function qAxis(ax, ay, az, ang) {
  const s = Math.sin(ang / 2);
  return [ax * s, ay * s, az * s, Math.cos(ang / 2)];
}
function qRot(q, v) {
  const [x, y, z, w] = q;
  const ix = w * v[0] + y * v[2] - z * v[1];
  const iy = w * v[1] + z * v[0] - x * v[2];
  const iz = w * v[2] + x * v[1] - y * v[0];
  const iw = -x * v[0] - y * v[1] - z * v[2];
  return [
    ix * w + iw * -x + iy * -z - iz * -y,
    iy * w + iw * -y + iz * -x - ix * -z,
    iz * w + iw * -z + ix * -y - iy * -x,
  ];
}
const add = (a, b, k = 1) => [a[0] + b[0] * k, a[1] + b[1] * k, a[2] + b[2] * k];

export class BasicDrone {
  constructor() {
    this.name = "Basic drone (LibFPV build not found)";
    this.real = false;
    this.hasOverlay = false;
    this.hasAudio = false;
    this.keys = new Set();
    this.heightAt = () => 0;
    this.spawnPos = [0, 0, 0];
    this._reset(0, 0, 0, 0);
  }

  _reset(x, y, z, yaw) {
    this.p = [x, y, z + 0.05];
    this.v = [0, 0, 0];
    this.yaw = yaw;
    this.pitch = 0; this.roll = 0;
    this.throttle = 0;
    this.armed = false;
    this.crashed = false;
    this.impacts = 0; this.impactSpeed = 0;
  }

  loadMesh() { return true; }               // uses heightAt() instead of triangles
  setHeightSampler(fn) { this.heightAt = fn; }
  spawn(x, y, z, yaw) { this.spawnPos = [x, y, z]; this._reset(x, y, z, yaw); }
  repair() { this.crashed = false; }
  despawn() {}
  setPaused() {}
  inputStatus() { return { source: this._gamepad() ? "gamepad" : "keyboard", needsSetup: false, devices: this._gamepad() ? 1 : 0, device: this._gamepad()?.id || "" }; }

  key(code, down) {
    if (down) {
      if (code === 13 && !this.keys.has(13)) this.armed = !this.armed; // Enter toggles arm
      this.keys.add(code);
    } else this.keys.delete(code);
  }

  _gamepad() {
    const pads = navigator.getGamepads ? navigator.getGamepads() : [];
    for (const p of pads) if (p && p.connected) return p;
    return null;
  }

  // sticks in -1..1 (mode 2): thr, yaw, pitch(+fwd), roll(+right)
  _sticks(dt) {
    const k = this.keys;
    const pad = this._gamepad();
    let yaw = 0, pitch = 0, roll = 0;
    if (pad) {
      const dz = (v) => (Math.abs(v) < 0.08 ? 0 : v);
      this.throttle = Math.max(0, Math.min(1, (1 - dz(pad.axes[1] || 0)) / 2));
      yaw = dz(pad.axes[0] || 0);
      roll = dz(pad.axes[2] || 0);
      pitch = -dz(pad.axes[3] || 0);
      if (pad.buttons[0]?.pressed && !this._padArm) this.armed = !this.armed;
      this._padArm = !!pad.buttons[0]?.pressed;
    }
    if (k.has(87)) this.throttle = Math.min(1, this.throttle + dt * 0.6); // W
    if (k.has(83)) this.throttle = Math.max(0, this.throttle - dt * 0.6); // S
    if (k.has(65)) yaw = -1; if (k.has(68)) yaw = 1;                    // A / D
    if (k.has(258)) pitch = 1; if (k.has(259)) pitch = -1;               // up / down
    if (k.has(256)) roll = -1; if (k.has(257)) roll = 1;                 // left / right
    return { yaw, pitch, roll };
  }

  tick(frameDt) {
    // Fixed 5 ms physics steps so slow frames don't slow the flight down.
    let t = Math.min(frameDt, 0.1);
    let out, hits = 0, hitSpeed = 0;
    while (t > 1e-6) {
      const dt = Math.min(0.005, t);
      out = this._step(dt);
      if (out.impacts) { hits++; hitSpeed = Math.max(hitSpeed, out.impactSpeed); }
      t -= dt;
    }
    out = out || this._step(0);
    out.impacts = hits;
    out.impactSpeed = hitSpeed;
    return out;
  }

  _step(dt) {
    const s = this._sticks(dt);
    const maxTilt = 0.6; // rad
    const smooth = 1 - Math.exp(-dt * 8);
    this.pitch += (s.pitch * maxTilt - this.pitch) * smooth;
    this.roll += (s.roll * maxTilt - this.roll) * smooth;
    this.yaw += s.yaw * 2.2 * dt;

    // orientation: yaw about +Z (east = clockwise), then pitch (nose down), roll (right)
    const q = qMul(qMul(qAxis(0, 0, 1, -this.yaw), qAxis(1, 0, 0, -this.pitch)), qAxis(0, 1, 0, this.roll));
    const up = qRot(q, [0, 0, 1]);
    const thrust = this.armed && !this.crashed ? this.throttle * 2.6 * G : 0;
    let a = add([0, 0, -G], up, thrust);
    a = add(a, this.v, -0.35); // drag
    this.v = add(this.v, a, dt);
    this.p = add(this.p, this.v, dt);

    // ground
    this.impacts = 0;
    const ground = this.heightAt(this.p[0], this.p[1]);
    const onGround = this.p[2] <= ground + 0.05;
    if (onGround) {
      const vz = this.v[2];
      if (vz < -6) { this.crashed = true; this.impacts = 1; this.impactSpeed = -vz; }
      this.p[2] = ground + 0.05;
      this.v = [this.v[0] * 0.5, this.v[1] * 0.5, Math.max(0, vz)];
    }

    const fwd = qRot(q, [0, 1, 0]);
    const camQ = qMul(q, qAxis(1, 0, 0, 0.44)); // 25° uptilt
    const fpv = { pos: add(this.p, up, 0.05), fwd: qRot(camQ, [0, 1, 0]), up: qRot(camQ, [0, 0, 1]), fov: 100, near: 0.05 };
    const hd = [Math.sin(this.yaw), Math.cos(this.yaw), 0];
    const chasePos = add(add(this.p, hd, -3.2), [0, 0, 1], 1.1);
    const look = norm(add(this.p, chasePos, -1));
    const chase = { pos: chasePos, fwd: look, up: [0, 0, 1], fov: 75, near: 0.1 };
    const lp = add(this.spawnPos, [0, 0, 1.7]);
    const los = { pos: lp, fwd: norm(add(this.p, lp, -1)), up: [0, 0, 1], fov: 60 };
    const speed = Math.hypot(...this.v);
    return {
      pos: this.p, rot: q, vel: this.v, speedKmh: speed * 3.6, alt: this.p[2] - ground,
      cams: { fpv, chase, los },
      flags: (this.armed ? 1 : 0) | (this.crashed ? 4 : 0) | (onGround ? 32 : 0) | 64,
      battery: { volts: 0, cell: 0, mah: 0 }, noise: 0, breakup: 0, osdRev: 0,
      impacts: this.impacts, impactSpeed: this.impactSpeed, rpm: [0, 0, 0, 0], time: 0,
      armingText: this.armed ? "" : "Press Enter (or gamepad A) to arm",
      fwd,
    };
  }
}

function norm(v) {
  const l = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / l, v[1] / l, v[2] / l];
}
