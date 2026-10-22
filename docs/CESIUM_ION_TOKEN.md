# Getting a Cesium ion token (Google 3D cities, no Google key)

Cesium ion, from the company behind the CesiumJS engine that Earth Flyer runs
on, includes **Google Photorealistic 3D Tiles** in its free Community plan.
With a Cesium token, Earth Flyer shows Google's photorealistic 3D cities
(textured walls, trees, terrain) without a Google Cloud account or a Google
API key.

> Checked against Cesium's pages on 22 October 2026. Cesium's docs give the
> scope and option names below exactly, but not every button label, so
> labels in the dashboard may differ slightly.

## What's free

| Free Community plan | Monthly limit |
| --- | --- |
| Google Photorealistic 3D Tiles | 1,000 root tiles (roughly one per app launch, not one per building) |
| Streaming | 15 GB |
| Geocodes (search) | 50,000 |

The plan is for personal and non-commercial use. When you reach a limit,
loading stops until the next month. You aren't charged unless you upgrade.

## Steps

1. **Sign up** at <https://ion.cesium.com> with email, Google or GitHub.
   Choose the free **Community** plan if asked.
2. **Open the token page:** <https://ion.cesium.com/tokens>.
3. **Click "Create token".** Don't use the *Default* token: it can't be
   restricted, and Cesium says it is meant for development only.
4. **Fill it in:**
   - **Name:** `Earth Flyer`
   - **Scopes:** turn on only these two:
     - `assets:read` streams the 3D tiles.
     - `geocode` powers search. Google's terms require their geocoder
       alongside these tiles, and Cesium ion provides it.

     Leave every private scope off: `assets:list`, `assets:write`,
     `profile:read`, `tokens:read`, `tokens:write`.
   - **Resources:** *All assets* is fine. For extra safety, choose *Selected
     assets* and pick **Google Photorealistic 3D Tiles** if it's listed.
   - **Allowed URLs:**
     - Desktop app: leave this on all URLs, because the app has no web
       address.
     - Website only: choose *Selected URLs* and add
       `https://monikawiafu.github.io`. Use separate tokens if you use both.
5. **Click Create and copy the token.** It's a long string starting with
   `eyJ`. Keep it private.
6. **In Earth Flyer:** open ⚙ **Settings**, paste the token into **Cesium
   ion token**, and click **Test token**. Both *Google 3D tiles* and
   *search* should show ✓. Choose **Google 3D via Cesium ion**, then click
   **Save and reload map**.

The token is stored only in that browser or in the desktop app on that
computer. It is never written to the repository.

## Good to know

- **Free features are switched off in this mode.** Google's tiles already
  include terrain and buildings, so the Terrain and Buildings buttons are
  greyed out. Switch the map source back to *Free satellite imagery* to use
  them.
- **Search uses Google** through Cesium ion, as Google's terms require.
- **Credits stay visible.** The Google and Cesium credits appear
  bottom-right. Don't hide them.
- **Test token** makes one small request for the 3D tiles, which may count
  toward the 1,000 monthly root tiles.

## Troubleshooting

| Test result | Likely cause |
| --- | --- |
| 3D tiles ✗, HTTP 401 | Token copied wrongly, or it lacks the `assets:read` scope |
| 3D tiles ✗, HTTP 404 | The token's *Selected assets* list leaves out Google Photorealistic 3D Tiles |
| Search ✗, HTTP 401/403 | Token lacks the `geocode` scope |
| Works on the desktop app but not the website (or the reverse) | The token's *Allowed URLs* doesn't include that place |
| Map stops loading late in the month | You reached the free monthly limit |

Sources: [Cesium ion access tokens](https://cesium.com/learn/ion/cesium-ion-access-tokens/),
[Cesium ion pricing](https://cesium.com/platform/cesium-ion/pricing/),
[Photorealistic 3D Tiles in CesiumJS](https://cesium.com/learn/cesiumjs-learn/cesiumjs-photorealistic-3d-tiles/),
[Photorealistic 3D Tiles included in Cesium ion](https://community.cesium.com/t/photorealistic-3d-tiles-from-google-maps-platform-are-now-included-in-your-cesium-ion-account/27630).
