// World scale: the drone flies in its own metres while the world is magnified
// (or shrunk) by `k` around it.
//
//   engine coordinates = world (ENU) metres × k
//
// k = 10: a 100 m building is 1,000 m to the drone - the world feels 10x
// bigger and the drone tiny. k = 0.1: the drone is a giant. The drone's own
// physics (Betaflight, motors, gravity in its units) are unchanged.
// Everything else (keys, overlay, OSD, audio) passes straight through.

export function scaleEngine(engine, k) {
  const inv = 1 / k;
  const sc = (v, f) => [v[0] * f, v[1] * f, v[2] * f];
  const cam = (c) => (c ? { ...c, pos: sc(c.pos, inv), near: (c.near || 0.05) * inv } : c);

  const flight = {
    k,
    loadMesh(positions, indices, materials) {
      if (k === 1) return engine.loadMesh(positions, indices, materials);
      const p = new Float32Array(positions.length);
      for (let i = 0; i < positions.length; i++) p[i] = positions[i] * k;
      return engine.loadMesh(p, indices, materials);
    },
    spawn(x, y, z, yaw) { return engine.spawn(x * k, y * k, z * k, yaw); },
    setHeightSampler(fn) {
      if (engine.setHeightSampler) engine.setHeightSampler((x, y) => fn(x * inv, y * inv) * k);
    },
    tick(dt) {
      const s = engine.tick(dt);
      if (k === 1) return s;
      return {
        ...s,
        pos: sc(s.pos, inv),
        vel: sc(s.vel, inv),
        alt: s.alt >= 0 ? s.alt * inv : s.alt,
        cams: { fpv: cam(s.cams.fpv), chase: cam(s.cams.chase), los: cam(s.cams.los) },
      };
    },
  };
  // Anything not overridden (key, overlay*, osd, audio*, repair, ...) goes to the engine.
  return new Proxy(flight, {
    get(target, prop) {
      if (prop in target) return target[prop];
      const v = engine[prop];
      return typeof v === "function" ? v.bind(engine) : v;
    },
  });
}

export function scaleLabel(k) {
  if (Math.abs(k - 1) < 0.001) return "1× (real size)";
  const v = k >= 10 || k < 1 ? +k.toPrecision(2) : +k.toFixed(1);
  return k > 1 ? `${v}× (world bigger, drone feels tiny)` : `${v}× (world smaller, drone feels giant)`;
}
