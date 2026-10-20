# Earth Flyer

Fly an FPV drone anywhere on Earth. Earth Flyer is a Google Earth-style
globe built with [CesiumJS](https://cesium.com/platform/cesiumjs/) on
**Google Photorealistic 3D Tiles**, with a real flight model from
[LibFPV](https://github.com/hammerill/libfpv): Betaflight firmware in the
loop, your radio or gamepad, the Betaflight OSD and motor sound.

It runs as a web page and as a desktop app for Windows, macOS and Linux,
both from the same code.

## Features

- **Globe:** Google Photorealistic 3D Tiles with your own API key, or free
  Esri satellite imagery with no key, draped over **free 3D terrain**
  (AWS Terrain Tiles). The **Terrain** button or `T` turns the terrain on
  and off.
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

1. Get a Google API key: [docs/GOOGLE_API_KEY.md](docs/GOOGLE_API_KEY.md).
   This is optional, but the 3D cities need it.
2. Run it:
   - **Web:** open the GitHub Pages site once the **Build** workflow has
     deployed it.
   - **Desktop:** download the installer for your OS from the latest
     workflow run (Actions → Build → Artifacts) or from Releases.
3. Click ⚙ **Settings**, paste your key, then click **Save**.

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
emcmake cmake -S native -B build/wasm && cmake --build build/wasm -j
```

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
- Free 3D terrain: [Mapzen Terrain Tiles on AWS](https://registry.opendata.aws/terrain-tiles/)
  (SRTM, GMTED, NED, ETOPO1 and other public sources).
- [CesiumJS](https://github.com/CesiumGS/cesium) (Apache-2.0) and
  [LibFPV](https://github.com/hammerill/libfpv) / Betaflight (GPL-3.0).

Earth Flyer isn't affiliated with Google. It doesn't use Google Earth's
private servers; it uses only the public Maps Platform APIs with your own
key.
