// Drone mode: spawns a quad on the 3D surface in front of the camera, flies it
// with LibFPV (or the basic fallback), streams collision around it and drives
// the Cesium camera from the drone's FPV / chase / line-of-sight cameras.
/* global Cesium */
import { EnuFrame, applyCamera } from "./enu.js";
import { CollisionGrid } from "./collision.js";
import { BasicDrone } from "./basic-drone.js";
import { loadLibFPV, FLAGS } from "./libfpv.js";
import { fpvKey } from "./keys.js";
import { OverlayRenderer } from "./overlay-gl.js";
import { OsdLayer, NoiseLayer, MotorAudio } from "./effects.js";
import { sampleGroundHeight, fmtDist } from "../globe.js";

const CAMS = ["fpv", "chase", "los"];
const CAM_LABEL = { fpv: "FPV", chase: "Chase", los: "Line of sight" };
const OUR_KEYS = { KeyC: "camera", KeyR: "respawn", KeyX: "exit" };

export class DroneMode {
  constructor(viewer, { toast, settings, saveSettings }) {
    this.viewer = viewer;
    this.toast = toast;
    this.settings = settings;
    this.saveSettings = saveSettings;
    this.active = false;
    this.engine = null;
    this.camIndex = 0;
    this.ui = document.getElementById("drone-ui");
    this.hud = {
      engine: document.getElementById("hud-engine"),
      cam: document.getElementById("hud-cam"),
      status: document.getElementById("hud-status"),
    };
    this.osd = new OsdLayer(document.getElementById("drone-osd"));
    this.noise = new NoiseLayer(document.getElementById("drone-noise"));
    this.overlayCanvas = document.getElementById("drone-overlay");
    this.overlay = null;
    this._onKeyDown = (e) => this._key(e, true);
    this._onKeyUp = (e) => this._key(e, false);
    this._onPreUpdate = () => this._update();
    this._wireButtons();
    this._wireOverlayMouse();
  }

  async _engine() {
    if (this.engine) return this.engine;
    try {
      this.engine = await loadLibFPV();
      console.info("LibFPV", this.engine.version);
    } catch (e) {
      console.warn("LibFPV WebAssembly not available, using the basic drone:", e);
      this.engine = new BasicDrone();
      this.toast("LibFPV build not found yet, so you're flying the basic drone. CI adds the real one.", 6000);
    }
    if (this.engine.hasOverlay) {
      try {
        this.overlay = new OverlayRenderer(this.overlayCanvas, this.engine);
        this.engine.overlaySetAction(1, "Respawn at the start point");
        this.engine.overlaySetAction(2, "Exit drone mode");
      } catch (e) { console.warn("overlay disabled", e); }
    }
    this.audio = new MotorAudio(this.engine);
    return this.engine;
  }

  async enter() {
    if (this.active) return;
    const viewer = this.viewer, scene = viewer.scene, camera = viewer.camera;
    if (camera.positionCartographic.height > 60000) {
      this.toast("Zoom in closer to the ground first (search a place, then press Drone).");
      return;
    }
    const canvas = scene.canvas;
    const screen = new Cesium.Cartesian2(canvas.clientWidth / 2, canvas.clientHeight * 0.62);
    let hit;
    if (viewer._efTileset && scene.pickPositionSupported) {
      hit = scene.pickPosition(screen); // 3D tiles: depth pick hits buildings too
    } else {
      const ray = camera.getPickRay(screen);
      if (ray) hit = scene.globe.pick(ray, scene); // exact on the plain globe
    }
    if (!hit) hit = camera.pickEllipsoid(screen, scene.globe.ellipsoid);
    if (!hit) { this.toast("Point the view at the ground first."); return; }

    this.toast("Preparing the drone…", 1500);
    const engine = await this._engine();
    this._createModel();
    const carto = Cesium.Cartographic.fromCartesian(hit);
    const h = await sampleGroundHeight(viewer, carto, this.modelEntities);
    const origin = Cesium.Cartesian3.fromRadians(carto.longitude, carto.latitude, h);
    this.frame = new EnuFrame(origin);

    this.collision = new CollisionGrid(viewer, this.frame, engine, { exclude: this.modelEntities });
    this.collision.loadFlat(0);
    if (engine.setHeightSampler) engine.setHeightSampler((x, y) => this.collision.heightAt(x, y));
    this.yaw = camera.heading; // drone faces where you were looking
    engine.spawn(0, 0, 0.02, this.yaw);
    this.collision.refreshAround(0, 0);

    // Hand the camera over to the drone.
    this.saved = {
      position: camera.position.clone(), direction: camera.direction.clone(), up: camera.up.clone(),
      fov: camera.frustum.fov, near: camera.frustum.near,
    };
    scene.screenSpaceCameraController.enableInputs = false;
    this.active = true;
    this.last = performance.now();
    this.hudTimer = 0;
    document.body.classList.add("drone");
    this.ui.hidden = false;
    document.getElementById("drone-help").hidden = !!this.settings.helpSeen;
    this.hud.engine.textContent = engine.name;
    this._setCam(0);
    window.addEventListener("keydown", this._onKeyDown, true);
    window.addEventListener("keyup", this._onKeyUp, true);
    scene.preUpdate.addEventListener(this._onPreUpdate);
    this.audio.start();
  }

  exit() {
    if (!this.active) return;
    const viewer = this.viewer, scene = viewer.scene, camera = viewer.camera;
    this.active = false;
    scene.preUpdate.removeEventListener(this._onPreUpdate);
    window.removeEventListener("keydown", this._onKeyDown, true);
    window.removeEventListener("keyup", this._onKeyUp, true);
    this.audio?.stop();
    this.engine?.despawn();
    if (this.engine?.overlaySetOpen) this.engine.overlaySetOpen(false);
    this._removeModel();
    this.osd.clear();
    this.noise.update(0, 0);
    this.overlayCanvas.classList.remove("active");
    this.ui.hidden = true;
    document.body.classList.remove("drone");
    scene.screenSpaceCameraController.enableInputs = true;
    if (this.saved) {
      camera.frustum.fov = this.saved.fov;
      camera.frustum.near = this.saved.near;
      camera.setView({ destination: this.saved.position, orientation: { direction: this.saved.direction, up: this.saved.up } });
    }
  }

  respawn() {
    if (!this.active) return;
    this.engine.spawn(0, 0, this.collision.heightAt(0, 0) + 0.02, this.yaw);
    this.engine.repair?.();
    this.toast("Respawned at the start point", 1500);
  }

  _setCam(i) {
    this.camIndex = (i + CAMS.length) % CAMS.length;
    this.hud.cam.textContent = CAM_LABEL[CAMS[this.camIndex]];
  }

  _update() {
    if (!this.active) return;
    const now = performance.now();
    const dt = Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    const engine = this.engine;
    const s = engine.tick(dt);

    if (this.collision.needsRefresh(s.pos[0], s.pos[1])) this.collision.refreshAround(s.pos[0], s.pos[1]);

    const camName = CAMS[this.camIndex];
    applyCamera(this.viewer, this.frame, s.cams[camName]);
    this._updateModel(s, camName !== "fpv");

    const fpv = camName === "fpv";
    const osdOff = (s.flags & FLAGS.OSD_DISABLED) !== 0;
    this.osd.update(engine, s, fpv && engine.real && !osdOff);
    this.noise.update(fpv ? s.noise : 0, fpv ? s.breakup : 0);

    if (this.overlay) {
      const open = engine.overlayOpen();
      this.overlayCanvas.classList.toggle("active", open);
      const w = window.innerWidth, h = window.innerHeight, dpr = window.devicePixelRatio || 1;
      if (open || this._overlayWasOpen) {
        engine.overlayDisplay(w, h, 1);
        this.overlay.render(dt, w, h, dpr);
      }
      this._overlayWasOpen = open;
      let a;
      while ((a = engine.overlayPollAction())) {
        if (a === 1) this.respawn();
        if (a === 2) { this.exit(); return; }
      }
    }

    if (s.impacts && s.impactSpeed > 4) this.toast(`Impact at ${s.impactSpeed.toFixed(1)} m/s`, 1200);

    this.hudTimer -= dt;
    if (this.hudTimer <= 0) {
      this.hudTimer = 0.25;
      const inp = engine.inputStatus();
      const armed = (s.flags & FLAGS.ARMED) !== 0;
      const crashed = (s.flags & FLAGS.CRASHED) !== 0;
      const lines = [
        `${armed ? "ARMED" : "disarmed"}${crashed ? " · CRASHED (R to respawn)" : ""} · ${s.speedKmh.toFixed(0)} km/h · ${s.alt >= 0 ? fmtDist(s.alt) + " AGL" : ""}`,
        `Input: ${inp.source}${inp.device ? " (" + inp.device + ")" : ""}${inp.needsSetup ? " - press F8 to set it up" : ""}`,
      ];
      if (engine.real && s.battery.volts) lines.push(`Battery ${s.battery.volts.toFixed(2)} V (${s.battery.cell.toFixed(2)} V/cell) · ${Math.round(s.battery.mah)} mAh`);
      if (!armed && s.armingText) lines.push(`Won't arm: ${s.armingText}`);
      this.hud.status.innerHTML = lines.map((l) => `<div>${l.replace(/</g, "&lt;")}</div>`).join("");
    }
  }

  _key(e, down) {
    if (!this.active) return;
    const engine = this.engine;
    const overlayInput = engine.overlayWantsInput?.();
    if (down && !overlayInput && OUR_KEYS[e.code] && !e.repeat) {
      const act = OUR_KEYS[e.code];
      if (act === "camera") this._setCam(this.camIndex + 1);
      if (act === "respawn") this.respawn();
      if (act === "exit") this.exit();
      e.preventDefault();
      e.stopPropagation();
      return;
    }
    const code = fpvKey(e);
    if (code) {
      if (!e.repeat) engine.key(code, down);
      e.preventDefault();
      e.stopPropagation();
    }
    if (down && overlayInput && e.key.length === 1 && !e.ctrlKey && !e.metaKey) engine.overlayText?.(e.key);
  }

  _wireButtons() {
    document.getElementById("drone-cam").addEventListener("click", () => this._setCam(this.camIndex + 1));
    document.getElementById("drone-reset").addEventListener("click", () => this.respawn());
    document.getElementById("drone-exit").addEventListener("click", () => this.exit());
    document.getElementById("drone-help-close").addEventListener("click", () => {
      document.getElementById("drone-help").hidden = true;
      this.settings.helpSeen = true;
      this.saveSettings(this.settings);
    });
  }

  _wireOverlayMouse() {
    const c = this.overlayCanvas;
    c.addEventListener("pointermove", (e) => this.engine?.overlayMouseMove?.(e.clientX, e.clientY));
    c.addEventListener("pointerdown", (e) => { this.engine?.overlayMouseButton?.(e.button, true); e.preventDefault(); });
    c.addEventListener("pointerup", (e) => this.engine?.overlayMouseButton?.(e.button, false));
    c.addEventListener("wheel", (e) => { this.engine?.overlayWheel?.(-e.deltaX / 100, -e.deltaY / 100); e.preventDefault(); }, { passive: false });
    c.addEventListener("contextmenu", (e) => e.preventDefault());
  }

  // ---- a simple quad model for chase / line-of-sight views ----
  _createModel() {
    if (this.modelEntities) return;
    const ents = this.viewer.entities;
    const dark = Cesium.Color.fromCssColorString("#1b1f27");
    const accent = Cesium.Color.fromCssColorString("#ff7a1a");
    this._pose = { pos: new Cesium.Cartesian3(), q: new Cesium.Quaternion() };
    const pose = this._pose;
    const body = ents.add({
      position: new Cesium.CallbackProperty(() => pose.pos, false),
      orientation: new Cesium.CallbackProperty(() => pose.q, false),
      box: { dimensions: new Cesium.Cartesian3(0.09, 0.14, 0.04), material: accent },
      show: false,
    });
    const arms = [[0.09, 0.09], [-0.09, 0.09], [0.09, -0.09], [-0.09, -0.09]];
    this._propPos = arms.map(() => new Cesium.Cartesian3());
    const props = arms.map((_, i) => ents.add({
      position: new Cesium.CallbackProperty(() => this._propPos[i], false),
      orientation: new Cesium.CallbackProperty(() => pose.q, false),
      cylinder: { length: 0.012, topRadius: 0.065, bottomRadius: 0.065, material: dark.withAlpha(0.75) },
      show: false,
    }));
    this._arms = arms;
    this.modelEntities = [body, ...props];
  }
  _updateModel(s, visible) {
    if (!this.modelEntities) return;
    for (const e of this.modelEntities) e.show = visible;
    if (!visible) return;
    this.frame.toWorld(s.pos, this._pose.pos);
    this.frame.orientation(s.rot, this._pose.q);
    const rot = Cesium.Matrix3.fromQuaternion(this._pose.q);
    this._arms.forEach(([x, y], i) => {
      const off = Cesium.Matrix3.multiplyByVector(rot, new Cesium.Cartesian3(x, y, 0.025), new Cesium.Cartesian3());
      Cesium.Cartesian3.add(this._pose.pos, off, this._propPos[i]);
    });
  }
  _removeModel() {
    if (!this.modelEntities) return;
    for (const e of this.modelEntities) this.viewer.entities.remove(e);
    this.modelEntities = null;
  }
}
