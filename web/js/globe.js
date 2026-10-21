import { createFreeTerrainProvider, sampleFreeTerrain } from "./terrain.js";

// The globe: Cesium viewer, map source (Google Photorealistic 3D Tiles or free
// imagery), and the Google Earth-like camera feel.
/* global Cesium */

const ESRI_IMAGERY = "https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}";

export function createViewer(containerId) {
  const viewer = new Cesium.Viewer(containerId, {
    baseLayer: false,
    baseLayerPicker: false,
    geocoder: false,
    homeButton: false,
    sceneModePicker: false,
    navigationHelpButton: false,
    animation: false,
    timeline: false,
    fullscreenButton: false,
    infoBox: false,
    selectionIndicator: false,
    shadows: false,
    msaaSamples: 4,
    scene3DOnly: true, // no 2D/Columbus views: skips projecting building meshes
  });
  const scene = viewer.scene;
  scene.globe.baseColor = Cesium.Color.fromCssColorString("#1d2b44");
  scene.globe.enableLighting = true;
  scene.globe.showGroundAtmosphere = true;
  scene.globe.depthTestAgainstTerrain = true;
  scene.skyAtmosphere.show = true;
  scene.fog.enabled = true;
  scene.highDynamicRange = false;
  viewer.clock.shouldAnimate = true;
  viewer.clock.multiplier = 1;
  viewer.clock.currentTime = Cesium.JulianDate.now();

  // Google Earth-ish controls: smooth inertia, tilt with right-drag / ctrl-drag.
  const ctl = scene.screenSpaceCameraController;
  ctl.inertiaSpin = 0.9;
  ctl.inertiaTranslate = 0.9;
  ctl.inertiaZoom = 0.8;
  ctl.minimumZoomDistance = 2;
  ctl.enableCollisionDetection = true;

  // Start from space, like Google Earth.
  viewer.camera.setView({
    destination: Cesium.Cartesian3.fromDegrees(-40, 25, 22000000),
  });
  return viewer;
}

// Loads the chosen map source. Returns { mode, tileset }.
export async function applyMapSource(viewer, mode, settings) {
  const scene = viewer.scene;
  if (viewer._efTileset) {
    scene.primitives.remove(viewer._efTileset);
    viewer._efTileset = null;
  }
  viewer.imageryLayers.removeAll();

  if (mode === "google") {
    Cesium.GoogleMaps.defaultApiKey = settings.apiKey;
    const tileset = await Cesium.createGooglePhotorealistic3DTileset(
      { key: settings.apiKey, onlyUsingWithGoogleGeocoder: true },
      {
        maximumScreenSpaceError: settings.highDetail ? 8 : 16,
        skipLevelOfDetail: true,
        enableCollision: true,
        showCreditsOnScreen: true,
      },
    );
    scene.primitives.add(tileset);
    // The photorealistic tileset covers the whole planet; the plain globe would
    // z-fight with it, so it is hidden (Google's recommended setup).
    scene.globe.show = false;
    viewer._efTileset = tileset;
    return { mode, tileset };
  }

  // Free mode: Esri World Imagery, optionally draped over free 3D terrain.
  scene.globe.show = true;
  setFreeTerrain(viewer, settings.terrain !== false);
  const provider = new Cesium.UrlTemplateImageryProvider({
    url: ESRI_IMAGERY,
    maximumLevel: 19,
    credit: new Cesium.Credit("Imagery © Esri, Maxar, Earthstar Geographics, and the GIS User Community", true),
  });
  viewer.imageryLayers.addImageryProvider(provider);
  return { mode, tileset: null };
}

let freeTerrain = null;
// Free 3D terrain on/off (only matters in free mode; Google's tiles carry their own).
export function setFreeTerrain(viewer, on) {
  if (on) {
    freeTerrain = freeTerrain || createFreeTerrainProvider();
    viewer.scene.terrainProvider = freeTerrain;
  } else {
    viewer.scene.terrainProvider = new Cesium.EllipsoidTerrainProvider();
  }
  viewer._efTerrainOn = on;
}

// Flies Google Earth-style to a place: a high arc, then a settled oblique view
// once the ground under it has loaded (so the camera never ends up underground).
export async function swoopTo(viewer, place) {
  const camera = viewer.camera;
  let center, radius;
  if (place.destination instanceof Cesium.Rectangle) {
    const r = place.destination;
    center = Cesium.Rectangle.center(r);
    const sw = Cesium.Cartesian3.fromRadians(r.west, r.south);
    const ne = Cesium.Cartesian3.fromRadians(r.east, r.north);
    radius = Cesium.Cartesian3.distance(sw, ne) / 2;
  } else {
    center = Cesium.Cartographic.fromCartesian(place.destination);
    radius = 400;
  }
  radius = Cesium.Math.clamp(radius, 150, 1500000);
  const range = radius * 2.2;
  const pitch = range > 400000 ? -Cesium.Math.PI_OVER_TWO : Cesium.Math.toRadians(-38);

  const ground = Cesium.Cartesian3.fromRadians(center.longitude, center.latitude, 0);
  await new Promise((resolve) =>
    camera.flyToBoundingSphere(new Cesium.BoundingSphere(ground, radius), {
      offset: new Cesium.HeadingPitchRange(0, pitch, range * 1.6),
      duration: undefined, // Cesium picks a duration from the distance
      complete: resolve,
      cancel: resolve,
    }),
  );
  // Second, short settle onto the real surface height.
  const h = await sampleGroundHeight(viewer, center);
  if (h !== undefined && Math.abs(h) > 5) {
    const target = Cesium.Cartesian3.fromRadians(center.longitude, center.latitude, h);
    camera.flyToBoundingSphere(new Cesium.BoundingSphere(target, radius), {
      offset: new Cesium.HeadingPitchRange(0, pitch, range),
      duration: 1.2,
    });
  }
}

// Height of the visible surface (3D tiles or globe) at a cartographic point.
export async function sampleGroundHeight(viewer, carto, exclude) {
  const scene = viewer.scene;
  try {
    if (scene.sampleHeightSupported && viewer._efTileset) {
      const [p] = await scene.sampleHeightMostDetailed([carto.clone()], exclude);
      if (p && p.height !== undefined) return p.height;
    }
  } catch (_) { /* fall through */ }
  // No terrain (free mode): the surface is the WGS84 ellipsoid itself.
  if (scene.terrainProvider instanceof Cesium.EllipsoidTerrainProvider) return 0;
  if (scene.terrainProvider instanceof Cesium.CustomHeightmapTerrainProvider) {
    try {
      const [h] = await sampleFreeTerrain(scene.terrainProvider, [carto]);
      if (h !== undefined) return h;
    } catch (_) { /* fall through */ }
  }
  const h = scene.globe.getHeight(carto);
  return h === undefined ? 0 : h;
}

export function flyHome(viewer) {
  viewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(-40, 25, 22000000), duration: 2.5 });
}

// Shows "lat, lon · eye alt" under the cursor like Google Earth's status bar.
export function wireCoords(viewer) {
  const el = document.getElementById("coords");
  const handler = new Cesium.ScreenSpaceEventHandler(viewer.scene.canvas);
  let last = 0;
  handler.setInputAction((m) => {
    const now = performance.now();
    if (now - last < 80) return;
    last = now;
    const scene = viewer.scene;
    let cart = scene.pickPositionSupported ? scene.pickPosition(m.endPosition) : undefined;
    if (!cart) cart = viewer.camera.pickEllipsoid(m.endPosition, scene.globe.ellipsoid);
    const eye = viewer.camera.positionCartographic.height;
    if (!cart) { el.textContent = `Eye alt ${fmtDist(eye)}`; return; }
    const c = Cesium.Cartographic.fromCartesian(cart);
    el.textContent = `${Cesium.Math.toDegrees(c.latitude).toFixed(5)}°, ${Cesium.Math.toDegrees(c.longitude).toFixed(5)}° · elev ${fmtDist(c.height)} · eye alt ${fmtDist(eye)}`;
  }, Cesium.ScreenSpaceEventType.MOUSE_MOVE);
}

export function fmtDist(m) {
  if (!isFinite(m)) return "–";
  return Math.abs(m) >= 10000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m)} m`;
}
