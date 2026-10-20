// A local East-North-Up frame (metres) anchored on the globe.
/* global Cesium */

export class EnuFrame {
  constructor(originCartesian) {
    this.origin = Cesium.Cartesian3.clone(originCartesian);
    this.toFixed = Cesium.Transforms.eastNorthUpToFixedFrame(this.origin);
    this.toLocal = Cesium.Matrix4.inverse(this.toFixed, new Cesium.Matrix4());
    this.rotation = Cesium.Matrix4.getMatrix3(this.toFixed, new Cesium.Matrix3());
    this.rotationQ = Cesium.Quaternion.fromRotationMatrix(this.rotation);
    this._p = new Cesium.Cartesian3();
  }

  // local [x,y,z] -> Cartesian3 (ECEF)
  toWorld(v, result) {
    this._p.x = v[0]; this._p.y = v[1]; this._p.z = v[2];
    return Cesium.Matrix4.multiplyByPoint(this.toFixed, this._p, result || new Cesium.Cartesian3());
  }
  dirToWorld(v, result) {
    this._p.x = v[0]; this._p.y = v[1]; this._p.z = v[2];
    const r = Cesium.Matrix4.multiplyByPointAsVector(this.toFixed, this._p, result || new Cesium.Cartesian3());
    return Cesium.Cartesian3.normalize(r, r);
  }
  // Cartesian3 -> local [x,y,z]
  toLocalPoint(c) {
    const r = Cesium.Matrix4.multiplyByPoint(this.toLocal, c, new Cesium.Cartesian3());
    return [r.x, r.y, r.z];
  }
  // local -> Cartographic
  toCarto(x, y, z = 0) {
    return Cesium.Cartographic.fromCartesian(this.toWorld([x, y, z]));
  }
  // drone quaternion (local axes -> ENU) -> ECEF orientation for entities
  orientation(q, result) {
    const dq = new Cesium.Quaternion(q[0], q[1], q[2], q[3]);
    return Cesium.Quaternion.multiply(this.rotationQ, dq, result || new Cesium.Quaternion());
  }
}

// Sets the Cesium camera from an engine camera {pos, fwd, up, fov(deg, vertical), near}.
export function applyCamera(viewer, frame, cam) {
  const camera = viewer.camera;
  const pos = frame.toWorld(cam.pos);
  const dir = frame.dirToWorld(cam.fwd);
  const up = frame.dirToWorld(cam.up);
  camera.setView({ destination: pos, orientation: { direction: dir, up } });
  const f = camera.frustum;
  if (f instanceof Cesium.PerspectiveFrustum) {
    const aspect = viewer.canvas.clientWidth / Math.max(1, viewer.canvas.clientHeight);
    const fovy = Cesium.Math.toRadians(cam.fov || 90);
    // Cesium's fov is the horizontal one when the view is wider than tall.
    f.fov = aspect >= 1 ? 2 * Math.atan(Math.tan(fovy / 2) * aspect) : fovy;
    f.near = Math.max(0.05, Math.min(cam.near || 0.1, 0.5));
  }
}
