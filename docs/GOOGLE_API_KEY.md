# Getting a Google API key for Earth Flyer

Earth Flyer runs without a key: it then shows free satellite imagery on a flat
globe. A Google key unlocks **Photorealistic 3D Tiles** (the 3D cities you
know from Google Earth) and **Google search**. It takes about 10 minutes.

> Checked against Google's pages on 20 October 2026. Google changes its
> console and prices from time to time, so trust what the console shows if it
> differs from this guide.

## What it costs

| API | What Earth Flyer uses it for | Free each month | After that |
| --- | --- | --- | --- |
| Map Tiles API: Photorealistic 3D Tiles | The 3D world | 1,000 billable events | $6.00 per 1,000 |
| Geocoding API | The search box | 10,000 requests | $5.00 per 1,000 |

Google asks for a billing account (a card) even when you stay inside the free
amounts. New Google Cloud accounts may also get a $300 free-trial credit.

Google's **Maps Demo Key** (no card needed) does *not* include the Map Tiles
API, so it can't show the 3D cities. It is fine for search only.

Google's pricing page doesn't spell out exactly which requests count as one
3D Tiles event, so set the limits in step 6. They make a surprise bill
impossible.

## Steps

1. **Open the console.** Go to <https://console.cloud.google.com/> and sign
   in with your Google account.
2. **Create a project.** Use the project picker at the top, then *New
   project*. Name it `earth-flyer`.
3. **Add billing.** Open *Billing* in the menu and link a billing account to
   the project (add a card if asked).
4. **Enable two APIs.** Open *APIs & Services → Library*, then search for and
   **Enable** each of these:
   - **Map Tiles API**
   - **Geocoding API**
5. **Create the key.** Open *APIs & Services → Credentials → Create
   credentials → API key*, then copy the key (it starts with `AIza`).
6. **Lock it down** (important). Click the new key:
   - **API restrictions:** choose *Restrict key* and tick only **Map Tiles
     API** and **Geocoding API**.
   - **Application restrictions:**
     - Web version on GitHub Pages: choose *Websites* and add
       `https://monikawiafu.github.io/*`.
     - Desktop app: the app has no web address, so leave this on *None* and
       rely on the API restriction plus the caps below. Use a separate key for
       the desktop app if you also use the website.
   - **Daily caps:** open *APIs & Services → Map Tiles API → Quotas*, edit
     the per-day request limit and set a low number (for example 300). Do the
     same for the Geocoding API. Requests stop at the cap instead of costing
     money.
   - **Budget alert:** open *Billing → Budgets & alerts* and create a budget
     of $1 with email alerts.
7. **Paste it into Earth Flyer.** Click ⚙ **Settings**, paste the key, click
   **Test key** (both ticks should be ✓), choose *Google Photorealistic 3D*,
   then click **Save**.

The key is stored only in that browser or in the desktop app on that
computer. It is never written to the repository.

## Rules that come with Google's 3D tiles

- **Search must use Google's geocoder.** Earth Flyer switches its search box
  to Google automatically in Google mode.
- **Attributions must stay visible.** The Google logo and data credits
  appear bottom-right. Don't hide them.
- **EEA billing addresses:** Google says some Map Tiles content is no longer
  returned to developers with a billing address in the European Economic
  Area, and the EEA terms apply.

## Troubleshooting

| Test result | Likely cause |
| --- | --- |
| 3D tiles ✗, HTTP 403 | Map Tiles API not enabled, billing not linked, or the key's API restriction leaves it out |
| 3D tiles ✗, HTTP 400 | Key copied wrongly (extra spaces) |
| Search ✗, `REQUEST_DENIED` | Geocoding API not enabled, or the key's restriction leaves it out |
| Works on the desktop app but not the website (or the reverse) | The website restriction doesn't match `https://monikawiafu.github.io/*` |
| Map stops loading partway through the day | You reached your daily cap (step 6) |

Sources: [Map Tiles API setup](https://developers.google.com/maps/documentation/tile/get-api-key),
[Maps Platform pricing](https://developers.google.com/maps/billing-and-pricing/pricing),
[Maps Demo Key](https://developers.google.com/maps/demo-key).
