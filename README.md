# Earth Flyer

Fly an FPV drone anywhere on Earth. Earth Flyer is a Google Earth-style
globe built with [CesiumJS](https://cesium.com/platform/cesiumjs/) on
**Google Photorealistic 3D Tiles**, with a real flight model from
[LibFPV](https://github.com/hammerill/libfpv): Betaflight firmware in the
loop, your radio or gamepad, the Betaflight OSD and motor sound.

It runs as a web page and as a desktop app for Windows, macOS and Linux,
both from the same code.

## Features

- **Google 3D cities without a Google key:** paste a free **Cesium ion token**
  ([guide](docs/CESIUM_ION_TOKEN.md)) and Earth Flyer streams Google
  Photorealistic 3D Tiles through Cesium ion (1,000 loads a month free).
- **Globe:** Google Photorealistic 3D Tiles with your own API key, or free
  Esri satellite imagery with no key, draped over **free 3D terrain**
  (AWS Terrain Tiles). The **Terrain** button or `T` turns the terrain on
  and off.
- **Free 3D buildings (no key):** OpenStreetMap buildings from OpenFreeMap,
  extruded on the terrain. Choose from the **Buildings** menu:
  - **3D over 2D map:** plain buildings standing on the satellite map.
  - **2D over 3D buildings** (default): the satellite photo is projected onto
    the buildings. Roofs show the real roof; walls show either the roof-edge
    pixels stretched down or the building's roof colour, shaded.
  The drone collides with buildings, and spawns on a roof if you start over one.
- **Search and fly-to:** a Google Earth-style swoop to any place or to
  `lat, lon` coordinates. Search uses Google in Google mode (a condition of
  the 3D tiles terms) and OpenStreetMap Nominatim otherwise.
- **Sun and sky:** day/night lighting, a time-of-day slider, atmosphere,
  stars, sun, moon and fog.
- **Drone mode:** press **Drone** (or `D`) to spawn a quad on the surface in
  front of you. You get FPV, chase and line-of-sight cameras, collisions with
  buildings and terrain sampled from the 3D tiles, and LibFPV's F8 overlay
  for the radio setup wizard, rates and quad presets.

## Getting started

1. Optional, for Google's 3D cities: get a free Cesium ion token
   ([docs/CESIUM_ION_TOKEN.md](docs/CESIUM_ION_TOKEN.md)), or a Google API
   key ([docs/GOOGLE_API_KEY.md](docs/GOOGLE_API_KEY.md)). Without either,
   you get free imagery, terrain and OpenStreetMap buildings.
2. Run it:
   - **Web:** open the GitHub Pages site once the **Build** workflow has
     deployed it.
   - **Desktop:** download the installer for your OS from the latest
     workflow run (Actions → Build → Artifacts) or from Releases.
3. Click ⚙ **Settings**, paste your token or key, choose the map source,
   then click **Save**.

### Controls

| Where | Input | Action |
| --- | --- | --- |
| Globe | Left-drag / right-drag / wheel | Pan / tilt and zoom / zoom |
| Globe | `D` | Drone mode |
| Globe | `T` | 3D terrain on/off (free mode) |
| Drone | Radio or gamepad | Fly (move a stick once so the browser sees it) |
| Anywhere | `F8` or ⚙ Settings → **Open drone setup** | LibFPV setup menu: radio/gamepad wizard and mapping, rates, modes, quad presets, OSD |
| Drone | `W`/`S`, `A`/`D`, arrow keys, `Enter` | Keyboard fallback: throttle, yaw, pitch/roll, arm |
| Drone | `C` / `R` / `X` | Change camera / respawn / exit |
| Settings | **Drone controls** | Realistic video signal on/off (default off: no range limit, no static), infinite battery (default on), world scale 0.1×–10× |
| Settings | **Drone controls → Keyboard keys** | Rebind every keyboard flying key and the camera/respawn/exit keys |
| Desktop | `F11` / `F12` | Fullscreen / developer tools |

## Developing

```sh
git clone --recursive https://github.com/MonikaWiafu/earth-flyer.git
cd earth-flyer
scripts/fetch-cesium.sh              # CesiumJS into web/vendor/cesium
python3 -m http.server -d web 8080   # open http://localhost:8080
```

Without the WebAssembly build, drone mode uses a simple built-in quad. To
build LibFPV for the browser you need [Emscripten](https://emscripten.org)
4.0 or newer:

```sh
git -C third_party/libfpv apply ../../patches/libfpv-earthflyer.patch   # infinite battery, unlimited video range
emcmake cmake -S native -B build/wasm && cmake --build build/wasm -j
```

`patches/libfpv-earthflyer.patch` adds two small options to LibFPV:
`fpv_battery_set_infinite` keeps the pack full every simulation step (voltage
still sags under load), and `fpv_video_set_unlimited_range` keeps the video
link clean at any distance. `native/test_glue.c` checks both against the real
library.

Desktop: `cd desktop && npm install && npm start` runs it.
`npm run dist` packages it.

CI (`.github/workflows/build.yml`) builds the WebAssembly module, runs a
native test of the drone coordinate conventions, deploys the site to GitHub
Pages, and packages Windows (`.exe` installer and portable), macOS
(`.dmg`) and Linux (`.AppImage`, `.deb`). Pushing a tag such as `v0.1.0`
attaches the installers to a release.

### Layout

```
web/            the app (static files)
  js/           globe, search, sky, settings
  js/drone/     drone mode: LibFPV bridge, collision, cameras, OSD, overlay
  wasm/         built by CI: earthflyer_fpv.js/.wasm (LibFPV + Betaflight)
native/         C bridge from LibFPV to the page, plus its native test
desktop/        Electron shell
third_party/    libfpv (git submodule)
```

### How the drone fits on a globe

The drone flies in a local east-north-up frame, measured in metres, centred
on its spawn point. LibFPV is told *right = east, up = up, forward =
north*, so Betaflight's GPS, compass and home arrow agree with the map.
`native/test_glue.c` checks this against the real library. Around the drone,
the visible surface (including buildings) is sampled on a 160 m grid and
handed to LibFPV as its collision mesh. The grid follows the drone as it
flies.

## License and credits

GPL-3.0-or-later, because LibFPV is GPL-3.0. This covers the app's code
only; the map data has its own terms:

- Google Photorealistic 3D Tiles and Geocoding: © Google, under the
  [Google Maps Platform Terms](https://cloud.google.com/maps-platform/terms).
- Free mode imagery: © Esri, Maxar, Earthstar Geographics. Search ©
  OpenStreetMap contributors (Nominatim).
- Free 3D buildings: [OpenFreeMap](https://openfreemap.org) vector tiles,
  © [OpenMapTiles](https://www.openmaptiles.org/), data ©
  [OpenStreetMap contributors](https://www.openstreetmap.org/copyright) (ODbL).
- Free 3D terrain: [Mapzen Terrain Tiles on AWS](https://registry.opendata.aws/terrain-tiles/)
  (SRTM, GMTED, NED, ETOPO1 and other public sources).
- [CesiumJS](https://github.com/CesiumGS/cesium) (Apache-2.0) and
  [LibFPV](https://github.com/hammerill/libfpv) / Betaflight (GPL-3.0).

Earth Flyer isn't affiliated with Google. It doesn't use Google Earth's
private servers; it uses only the public Maps Platform APIs with your own
key.
