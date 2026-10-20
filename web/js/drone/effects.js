// FPV presentation: Betaflight OSD, analog video noise and motor sound.

export class OsdLayer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext("2d");
    canvas.width = 640;
    canvas.height = 480;
    canvas.style.objectFit = "contain";
    this.rev = -1;
    this.lastDraw = 0;
  }
  update(engine, state, visible) {
    if (!visible || !engine.osd) {
      if (this.rev !== -2) { this.ctx.clearRect(0, 0, 640, 480); this.rev = -2; }
      return;
    }
    const now = performance.now();
    if (state.osdRev === this.rev && now - this.lastDraw < 500) return;
    const img = engine.osd(640, 480, false);
    if (img) this.ctx.putImageData(img, 0, 0);
    this.rev = state.osdRev;
    this.lastDraw = now;
  }
  clear() { this.ctx.clearRect(0, 0, 640, 480); this.rev = -1; }
}

export class NoiseLayer {
  constructor(canvas) {
    this.canvas = canvas;
    canvas.width = 200;
    canvas.height = 150;
    this.ctx = canvas.getContext("2d");
    this.img = this.ctx.createImageData(200, 150);
  }
  update(noise, breakup) {
    const level = Math.min(1, Math.max(0, noise));
    this.canvas.style.opacity = level < 0.03 ? "0" : String(Math.min(0.85, level * 0.9));
    if (level < 0.03) return;
    const d = this.img.data;
    for (let i = 0; i < d.length; i += 4) {
      const v = (Math.random() * 255) | 0;
      d[i] = d[i + 1] = d[i + 2] = v;
      d[i + 3] = 255;
    }
    this.ctx.putImageData(this.img, 0, 0);
    if (breakup > 0 && Math.random() < breakup) {
      this.ctx.fillStyle = "rgba(255,255,255,0.6)";
      this.ctx.fillRect(0, Math.random() * 150, 200, 4 + Math.random() * 12);
    }
  }
}

// Motor sound pulled from libfpv on the main thread (ScriptProcessor keeps it
// simple: libfpv's web build is single-threaded by design).
export class MotorAudio {
  constructor(engine) {
    this.engine = engine;
    this.ctx = null;
    this.node = null;
  }
  start() {
    if (!this.engine.hasAudio || this.ctx) return;
    try {
      this.ctx = new (window.AudioContext || window.webkitAudioContext)();
      this.engine.audioConfigure(this.ctx.sampleRate);
      this.engine.audioVolume(0.6);
      this.node = this.ctx.createScriptProcessor(2048, 0, 1);
      this.node.onaudioprocess = (e) => {
        const out = e.outputBuffer.getChannelData(0);
        const src = this.engine.audioRead(out.length);
        if (src) out.set(src); else out.fill(0);
      };
      this.node.connect(this.ctx.destination);
    } catch (e) {
      console.warn("audio unavailable", e);
    }
  }
  stop() {
    try { this.node?.disconnect(); this.ctx?.close(); } catch (_) { /* ignore */ }
    this.node = null;
    this.ctx = null;
  }
}
