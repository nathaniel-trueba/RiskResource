# Risk Resource frontend: design and data contract

Audience: developers and coding agents working on the frontend or the backend that feeds it.

Last checked against the code on 2026-11-27 (`main` at `39e2ecf`). Line references will drift. If this doc and the code disagree, the code wins, and this doc should be updated.

Related docs:

- [`backend-doc.md`](backend-doc.md): the API, scoring, the database and caching.
- [`apis-usage.md`](apis-usage.md): every external API, including the ones the browser calls directly for address search.
- [`wildfire-model.md`](wildfire-model.md): the wildfire model behind 20% of the overall score.

## 1. Summary

Risk Resource is a Next.js site for US natural disaster risk, deployed on Vercel. It has three routes: a landing page, an interactive risk map and a methodology page. It has a light and a dark theme.

**Risk data always comes from the FastAPI backend.** Without it, pages still load and show error or "unavailable" text. The browser never talks to Supabase.

**Address search is the exception: it runs in the browser.** Street addresses are suggested by Photon, turned into a county by the FCC's Census Area API, and only then sent to the backend as a county FIPS code ([section 3](#address-search)). The backend's own search only knows county names, cities and ZIP codes.

The site shows two different kinds of number, and labels them differently:

| | Risk score | Expected annual loss |
|---|---|---|
| Shown as | 0 to 100, with a tier | Dollars, labelled "FEMA estimate" |
| Changes with live alerts and weather | Yes | No |
| Comes from | FEMA declarations, USGS, NWS, Open-Meteo, NWPS, the wildfire model | FEMA National Risk Index, 11 of its 18 hazards |

## 2. Stack and commands

| Area | Details |
|---|---|
| Framework | Next.js ^16.4.6 (App Router, Turbopack), React 19.3. 16.4.3 had a known security vulnerability |
| Language | TypeScript in strict mode, with the path alias `@/*` pointing at `frontend/*` |
| Styling | Tailwind CSS v4, through the `@tailwindcss/turbopack` loader in `next.config.ts`. Dark mode uses the `dark` class on `<html>` |
| Fonts | Bricolage Grotesque, DM Sans and JetBrains Mono, from `next/font/google` in `app/layout.tsx` |
| Map | Leaflet 1.9 and react-leaflet 5 |
| Hosting | Vercel |

To run the whole site, start the backend first (see [`backend-doc.md`](backend-doc.md#2-running-it)), then from `frontend/`:

```bash
npm ci
npm run dev        # http://localhost:3000
npm run lint
npx tsc --noEmit
npm run build
```

| Check on 2026-11-27 | Result |
|---|---|
| `npx tsc --noEmit` | Passes |
| `npm run lint` | **15 errors, 4 warnings**, all style rules rather than bugs: `setState` called directly inside `useEffect` (8, React 19's `react-hooks/set-state-in-effect`), `any` in the Photon response parsing (7), and unused imports (4). See [section 7](#7-known-issues) |
| Tests and CI | None exist |

`tsc` writes `tsconfig.tsbuildinfo`, which is git-ignored.

**Environment variables,** both optional locally, set in `frontend/.env.local`. The `NEXT_PUBLIC_` prefix means values ship to browsers and are **fixed at build time**: after changing one on Vercel, redeploy.

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000/api` | Backend base URL. On Vercel, the Railway URL plus `/api` |
| `NEXT_PUBLIC_CARTO_API_KEY` | None | CARTO basemap. Falls back to OpenStreetMap tiles |

## 3. Structure

```
frontend/
  app/
    layout.tsx               Root layout: fonts, page metadata, ThemeProvider
    page.tsx                 /       Landing page
    map/page.tsx             /map    Owns all map state and data fetching
    about/page.tsx           /about  Methodology, data sources and live warning rules
  components/
    common/
      Navigation.tsx         Top bar: Home, Risk map, About, and the theme toggle
      Footer.tsx             API links, DS3 at UCSD, team members, and the disclaimer
      ThemeProvider.tsx      Light/dark theme; saved in localStorage, defaults to the OS setting
    home/
      HomeSearch.tsx         Address, city or ZIP search; sends to /map
      HeroScoreCard.tsx      Live score card for saved locations; users can add and remove them
      HazardMapShowcase.tsx  SVG state map that cycles through all 6 hazards, from GET /home-snapshot, in the risk map's colours
      FeaturesGrid.tsx       Static links into /map and /about
    about/
      ScoreExplainer.tsx     Sliders for history, live and wildfire model; shows the 40/40/20 formula. Client-side only
    map/
      RiskLeafletMap.tsx     Leaflet map; fetches GeoJSON; highlights the selection; zooms to a focus; loaded with ssr: false
      MapControls.tsx        View toggle, "Show" dropdown, hazard buttons, county and address search
      MapLegend.tsx          Colour bands for the current measure
      StateInspector.tsx, CountyInspector.tsx    Side panels, with the alerts dropdown
      ExpectedLossSection.tsx    FEMA loss panel, shown under the map for the selected state or county
      WildfireModelSection.tsx   The wildfire model's score and share of the overall score, in both side panels
  lib/
    api.ts                   Every backend call
    types.ts                 API response types
    riskColors.ts            Tiers and tier colours, map bands, hazard list, hazard colours
    format.ts                Dollar and percent formatting
    nri.ts                   What the loss figures include and leave out
    scoring.ts               The overall score's weights (SCORE_WEIGHTS) and the model's display text
```

**The overall score is 40% history, 40% live and 20% wildfire model** ([`backend-doc.md`](backend-doc.md#5-scoring-model)). [`lib/scoring.ts`](../frontend/lib/scoring.ts) holds those weights as `SCORE_WEIGHTS`, mirroring `OVERALL_*_WEIGHT` in `backend/app/domain/scoring.py`; **change them together**. The About page, `ScoreExplainer`, `WildfireModelSection` and the map legend note all read from it. `ScoreExplainer` simplifies to one hazard (`0.4 × history + 0.4 × live + 0.2 × model`) and says so; the real score blends history and live per hazard first, then combines hazards weighted toward the worst. Hazard bars, and the map filtered to one hazard, don't include the model.

### Address search

Three search boxes accept free text: the home page search, the map's search, and the "add location" box on the home score card. Each combines two lookups:

| Lookup | Called from | Finds |
|---|---|---|
| Backend `GET /search` | Map search, score card | County names, cities and ZIP codes ([`backend-doc.md`](backend-doc.md#apisearch)) |
| [Photon](https://photon.komoot.io/) | All three, as you type (3+ or 4+ characters), limited to a US bounding box | Street addresses and places, with coordinates |
| [FCC Census Area API](https://geo.fcc.gov/api/census/) | When an address is picked | The county FIPS for a latitude and longitude |
| [Nominatim](https://nominatim.openstreetmap.org/) | Home search only, when Enter is pressed with no Photon suggestion | One geocoded result for the typed text |

The home search sends the user to `/map?fips=...&lat=...&lng=...&name=...`. If the FCC lookup fails, it sends `lat`, `lng` and `name` without `fips`, and the map page asks the FCC API again. If nothing geocodes, it falls back to `/map?q=`, which the backend search resolves. None of these services needs a key. All of them are called straight from the visitor's browser, so their rate limits apply per visitor, not to the site as a whole.

### `/map` data flow

[`app/map/page.tsx`](../frontend/app/map/page.tsx) holds all the state, with no global store or data-fetching library:

| State | Type | Purpose |
|---|---|---|
| `viewMode` | `'states' \| 'counties'` | Which layer shows, and which map values to fetch |
| `measureChoice` | `'score' \| 'lossPerPerson' \| 'totalLoss' \| 'highLossPct'` | The "Show" dropdown |
| `hazard` | `HazardKey \| null` | The hazard buttons. `null` is "All hazards" |
| `selectedState`, `selectedCounty` | Records or `null` | What the side panel and loss panel show |
| `focus` | `MapFocus \| null` (`{ type: 'state' \| 'county', id }`) | What the map is zoomed to. `null` is the national view. See [section 5](#zooming) |
| `loading`, `error` | | Side panel request status |
| `mapValues` | Cache keyed by `level:metric:hazard` | Map colours already fetched, so switching back is instant |
| `mapError` | | Map colour request status |

Three values are derived rather than stored:

- **`measure`:** `highLossPct` only exists for states, so in county view it falls back to `lossPerPerson`.
- **`activeHazard`:** `highLossPct` is defined on all hazards together, so it ignores the hazard buttons.
- **`activeCounty`:** the selected county, but only in county view. The side panel and the loss panel under the map show it, or the selected state otherwise.

`queryFor(measure, hazard)` turns those into the backend's `metric` and `hazard` parameters. For example, Score + Flood is `metric=flood`, while Loss per person + Flood is `metric=lossPerPerson&hazard=flood`.

**Stale responses:** each side panel request gets a number from `latestRequest`. Responses to older requests are ignored, so a slow response can't overwrite a newer click. Loading a county also loads its state if it differs from the current one.

**URL parameters,** read once on mount from `window.location.search`:

| Parameter | Effect |
|---|---|
| `?fips=06065` | Opens that county and zooms to it. `lat`, `lng` and `name` may come along but aren't used |
| `?lat=...&lng=...` (no `fips`) | Looks up the county with the FCC API, opens it and zooms to it. Falls back to California |
| `?q=Palm Springs, CA` | Backend search, opens the best match and zooms to it. Falls back to California, unzoomed |
| None | Opens California, unzoomed |

### Calls by user action

| Action | Call | Then |
|---|---|---|
| Open `/map`, switch view, change "Show", or pick a hazard | `GET /map-values?level=&metric=&hazard=` (unless cached) | Recolours the map and legend |
| Open `/map`, or click a state | `GET /states/{code}` | `StateInspector`, and the state's loss panel under the map |
| Click a county | `GET /counties/{fips}`, plus `GET /states/{code}` if the state changed | `CountyInspector` and the county's loss panel. The map doesn't move |
| Pick a county in the map search | Same as clicking a county | Same, and the map zooms to the county |
| Click an empty part of the map | None | Clears the selection and zooms out |
| Click "Zoom Into Counties" | None | County layer, zoomed to the state |
| Click the States toggle, the Counties toggle, or "Back to <state>" | None (map values may load) | Zooms back to the national view |
| Type in the map search | `GET /search?q=&limit=8` and Photon, 250 ms after the last keystroke | County and address results |
| Pick an address in the map search | FCC Census Area API, then `GET /counties/{fips}` | Opens that county and zooms to it |
| Open `/` | `GET /home-snapshot` | `HazardMapShowcase` |
| Open `/` | `GET /counties/{fips}` for the selected saved location (Santa Rosa, `06097`, by default) | `HeroScoreCard`. Other locations fetch on click, once each |
| Search on `/` | Photon as you type; FCC (and Nominatim on Enter) when submitted | Navigates to `/map` |

The score card's default locations are Palm Springs (`06065`, Riverside County), Santa Rosa (`06097`, Sonoma), Fresno (`06019`) and San Diego (`06073`). Users can add locations (by county, city, ZIP or address), remove them, or reset to the defaults. The list and the selected one are saved in `localStorage` (`risk-resource:locations`, `risk-resource:active-location-id`).

### External requests

Besides the address search services above, the browser fetches map data directly:

| What | Source | Size | Feature ID |
|---|---|---|---|
| State boundaries | [folium `us_states.json`](https://raw.githubusercontent.com/python-visualization/folium-example-data/main/us_states.json) | 88 KB, 50 features | `"CA"` |
| County boundaries | [plotly `geojson-counties-fips.json`](https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json) | 3.2 MB, 3,221 features | `"06065"` |
| Basemap tiles | CARTO `light_all` with `NEXT_PUBLIC_CARTO_API_KEY`, otherwise OpenStreetMap | | |

The map fetches both GeoJSON files when it mounts; the home showcase fetches the state file again. Both are unpinned files on third-party `main`/`master` branches.

### Colours and legends

All in [`lib/riskColors.ts`](../frontend/lib/riskColors.ts):

| Measure | Bands |
|---|---|
| Risk score | Fixed, nested inside the tiers: Low `0–14`, `15–29`; Moderate `30–39`, `40–49`; Elevated `50–74`; Critical `75–100` (`SCORE_BANDS`) |
| Dollar and percent measures | Quintiles of the values currently shown (`quantileBands`), labelled with real amounts, e.g. `$447 – $737` |
| No value | Grey, "No data" |

**Tiers come from the backend.** `TIER_FLOORS` in `riskColors.ts` mirrors `TIER_FLOORS` in `backend/app/domain/scoring.py` (30, 50, 75); **change them together**. Badges, hazard bars, the wildfire model bar, the /about tier strip and the score explainer all colour by tier with `TIER_STYLES`, using the API's `tier` where there is one. Map bands split Low and Moderate into two shades each, because real scores mostly fall between 0 and 50 (40% of each score is live and is 0 when nothing is happening), but every tier boundary is a band boundary, so a map colour never contradicts the tier in its tooltip.

Quintile bands skip repeated cut points, so a measure where most areas are $0 (for example, hurricane loss) can show fewer than five bands.

**The home showcase matches the risk map.** It colours states with `scoreColor` (the same `SCORE_BANDS`), uses `NO_DATA_COLOR` for a state with no score, and draws fills at `MAP_FILL_OPACITY` (the map's 0.7 for states) over `MAP_BASE_COLOR`, a near-white base standing in for the map's light basemap, so a score looks the same on both pages in either theme. Its scores are the same state hazard scores the map shows with that hazard selected, saved on one day.

Hazard accent colours (`HAZARD_COLORS`) are keyed by the backend's hazard labels, such as `"Severe Storm"`.

### Expected loss wording

[`lib/nri.ts`](../frontend/lib/nri.ts) holds what the loss figures do and don't include. It mirrors `NRI_HAZARDS` and `NRI_EXCLUDED_HAZARDS` in `backend/app/domain/hazards.py`; **change them together**. `ExpectedLossSection`, the About page and the legend notes use it. Wherever a dollar figure appears, the UI says it's:

- a FEMA estimate, not money actually lost,
- for 11 of NRI's 18 hazards, naming the 7 left out,
- including deaths and injuries at FEMA's dollar value.

"High-loss" is described as the top 20% of US counties for loss per person. The threshold amount comes from the API (`highLossThresholdPerPerson`), but the "20%" text is derived from `highLossPercentile` in `ExpectedLossSection` and hard-coded in the map legend note.

## 4. Data contract

The source of truth is [`frontend/lib/types.ts`](../frontend/lib/types.ts), which mirrors [`backend/app/schemas.py`](../backend/app/schemas.py). **Change them together.**

```ts
export type Tier = 'Low' | 'Moderate' | 'Elevated' | 'Critical';

export interface HazardItem {
  name: string;        // "Wildfire", "Severe Storm", ...
  score: number;       // Whole number, 0 to 100
  tier: Tier;
  warning: string;
}

export interface HazardLoss { name: string; amount: number; } // Dollars per year

export interface ExpectedLoss {
  total: number;                      // Dollars per year
  perPerson?: number;                 // Dollars per resident per year
  byHazard: HazardLoss[];             // Largest first
  highLossThresholdPerPerson: number; // e.g. 732.52
  highLossPercentile: number;         // e.g. 80
  source: string;                     // "FEMA National Risk Index, December 2025"
}
export interface CountyExpectedLoss extends ExpectedLoss {
  lossPerPersonPercentile?: number;   // Rank among all NRI counties, 0 to 100
  isHighLoss: boolean;
  socialVulnerability?: string;       // NRI rating, e.g. "Relatively High"
  communityResilience?: string;
}
export interface StateExpectedLoss extends ExpectedLoss {
  highLossPopulationPct?: number;     // % of residents in high-loss counties
}

// The wildfire model's 20% of the overall score
export interface WildfireModelInfo {
  score: number;        // 0 to 100, from the weekly probability on a log scale
  tier: Tier;
  probability?: number; // Chance a large wildfire starts this week, 0 to 1. Counties only
  weekStart: string;    // Monday of the forecast week, e.g. "2026-11-23"
}

export interface StateRecord {
  code: string;        // Matches the state GeoJSON feature ID, e.g. "CA"
  name: string;
  row?: number; col?: number;         // Unused leftovers: the API never sends these
  compositeScore: number;    // Overall: 40% history + 40% live + 20% wildfire model (hazards alone without the model)
  tier: Tier;
  countiesCount: number;
  population: string;  // Preformatted, e.g. "39,501,350", or "N/A"
  activeAlertCount?: number; // Absent when the NWS feed is unavailable
  primaryAlert?: string;     // Absent when there are no active alerts
  alerts?: string[];         // Every active alert type with its county count, primary first. Absent with none or during an NWS outage
  hazards: HazardItem[];     // Highest score first
  wildfireModel?: WildfireModelInfo; // Population-weighted; absent when the model file is missing or stale
  expectedLoss?: StateExpectedLoss;
}

export interface CountyRecord {
  name: string;        // Includes the suffix, e.g. "Orleans Parish"
  state: string;       // Full name, e.g. "California"
  stateCode?: string;  // e.g. "CA". Always sent by the API
  compositeScore: number;
  tier: Tier;
  fips?: string;       // Always sent by the API
  pop: string;         // Preformatted, or "N/A"
  activeAlert?: string; // Absent when there are no active alerts
  alerts?: string[];    // Every active alert headline, most important first. Absent with none or during an NWS outage
  hazards: HazardItem[];
  wildfireModel?: WildfireModelInfo; // Absent when the model is unavailable for the county
  expectedLoss?: CountyExpectedLoss; // Absent without NRI data, e.g. Connecticut
}

export interface MapValue {
  id: string;          // State code or FIPS, matching the GeoJSON feature ID
  value: number;       // Score (0 to 100), dollars, or a percent, depending on the metric
  tier?: Tier | null;  // Only for score metrics
}

// GET /api/home-snapshot: fixed state scores for the home page animation
export interface SnapshotLayer {
  kind: 'week' | 'day'; // Always 'day' now (scores saved on one day); 'week' is no longer produced
  asOf: string;         // YYYY-MM-DD
  values: MapValue[];   // One per state code
}
export interface HomeSnapshot {
  hazards: Record<string, SnapshotLayer>; // By hazard key, e.g. "wildfire"
}

export interface SearchResult {
  fips: string;
  name: string;
  state: string;
  stateCode: string;
  matchedPlace?: string; // Present when a city or ZIP led to this county
}
```

[`lib/api.ts`](../frontend/lib/api.ts) adds `HazardKey`, `LossMetric` and `MapMetric` for the map query. Its `fetchMapValues` returns a record keyed by ID rather than an array.

The side panels show `alerts` in a dropdown: the first alert as the headline, the rest behind "+N more". If `alerts` is absent they fall back to `activeAlert` or `primaryAlert`, which is how the NWS-outage text still shows.

### Rules the types don't express

- **Alerts have three states.** With alerts, the field holds their text. With none, it's absent, and the UI shows "No active alerts". If the NWS feed is down, it holds "NWS alert feed unavailable, so alert status is unknown", and `activeAlertCount` is absent, which the state panel shows as "Unavailable". Never treat an outage as "no alerts".
- **Join on IDs, never on names.** County GeoJSON names have no suffix, and 444 names are shared by more than one county ("Washington" appears 31 times).
- **FIPS codes are strings.** As numbers, `06065` would become `6065` and match nothing.
- **Hazards render in array order.** The UI doesn't sort them.
- **Dollar amounts are raw numbers.** Format them with `formatUsd` (`$447`, `$35.4M`, `$28.5B`).
- **A county's side panel score can differ from its map value,** because only the side panel includes weather and river gauges. See [`backend-doc.md`](backend-doc.md#why-a-countys-map-colour-can-differ-from-its-sidebar-score).

## 5. Working with the map

react-leaflet reads a GeoJSON layer's `data`, `style` and `onEachFeature` only when the layer is created. So `RiskLeafletMap` gives each layer a `key` built from `valuesKey` (`level:metric:hazard`) and `selectedId`, and changing either recreates the layer with the new colours, tooltips and selection outline. In county view, state borders are drawn on top so they stay visible.

Its props:

```ts
interface Props {
  viewMode: 'states' | 'counties';
  values?: Record<string, MapValue>;            // Undefined while loading
  valuesKey: string;                            // Changes when values change; recreates layers
  colorFor: (value: number | undefined) => string;
  describe: (value: MapValue) => string;        // Tooltip line, may contain HTML
  onSelectFeature?: (id: string, type: 'state' | 'county') => void;
  onClearSelection?: () => void;                // A click on the map background
  selectedId?: string | null;                   // State code or FIPS to outline
  focus?: MapFocus | null;                      // Area to zoom to; null is the national view
}
```

### Zooming

`RiskLeafletMap` exports `MapFocus` (`{ type: 'state' | 'county', id }`, where `id` is a postal code or FIPS). A `FocusOn` child component reads the map with react-leaflet's `useMap` and:

- **Focus set:** flies to the area's bounds, at most zoom 7 for a state and 8 for a county, so a small county still shows its surroundings. It skips the flight only when the map is already at about that zoom with the area in view, so a county inside the state you're zoomed to still zooms in.
- **Focus cleared:** flies back to the national view (`DEFAULT_CENTER`, `DEFAULT_ZOOM`), but only after a zoom-in, so the first load doesn't animate.
- **Boundaries still loading:** waits, and zooms once the GeoJSON arrives. A search can resolve before the 3.2 MB counties file does.

Bounds come from `boundsOf()`, not Leaflet's own `getBounds()`. It shifts positive longitudes west by 360°, because Alaska's Aleutian Islands cross the 180° line, which gave Alaska a box spanning the whole globe. Every US area is in the western hemisphere otherwise. The westernmost islands are drawn on the neighbouring copy of the world, so they're just off-screen after zooming.

What sets the focus is in `app/map/page.tsx`:

| Trigger | Focus |
|---|---|
| "Zoom Into Counties" | The selected state |
| First load with `?fips=`, `?lat=&lng=` or `?q=`, or picking a map search result (`loadCounty(..., zoom = true)`) | The county |
| States toggle, Counties toggle, county panel "Back" (`showAllStates`), clicking the map background (`handleClearSelection`) | `null` |
| Clicking an area on the map | Unchanged |

Other things to know:

- Leaflet touches `window`, so anything importing it must stay behind `dynamic(..., { ssr: false })` in a client component.
- Overlays above the map need a z-index above Leaflet's panes. The search list uses `z-[1000]`, and the legend `z-[500]`.
- **Layout:** the map and the loss panel share the left column, and the side panel is a fixed-width right column (`lg:w-88`), so a long side panel grows downward without pushing the loss panel. The legend is pinned to the map with `absolute bottom-4 left-4` inside the map's own `relative` wrapper.

## 6. Error states

| Failure | What the user sees |
|---|---|
| Backend down, map values | Red banner: "Couldn't load map colours: ... Is the backend running?" Polygons show "Loading..." in tooltips |
| Backend down, side panel | Red banner: "Couldn't load CA: ... Is the backend running?", then "No data to show." if nothing loaded yet |
| Backend down, map search | Only address results, or "No matching counties or addresses" |
| Address can't be matched to a county | "Could not match that address to a US county." (map) or "...that location..." (score card) |
| Photon, FCC or Nominatim down | Address suggestions don't appear; picking one shows "Address lookup failed. Try again." The home search falls back to `/map?q=` |
| Backend down, home score card | "Backend unavailable" |
| Backend down, home showcase | Rough regional scores per hazard (`fallbackStates` in `HazardMapShowcase.tsx`), coloured on the map's score bands, instead of real scores |
| County without NRI data | Loss panel explains why; Connecticut gets a specific message about planning regions |
| GeoJSON fails to load | Only logged to the console. The loading overlay stays up |
| One upstream source down | Handled by the backend: scores still load, with "(live data unavailable)" in the affected warnings |

There's no retry button anywhere: reload the page.

## 7. Known issues

- **Lint fails** with 15 errors and 4 warnings (section 2). `next build` doesn't run lint, so deploys aren't blocked. The `set-state-in-effect` errors are in effects that reset UI state (closing dropdowns, restoring `localStorage`, reading the URL); the `any`s are in Photon response parsing. Unused imports: `SCORE_WEIGHTS` in `HeroScoreCard` and `WildfireModelSection`, `EXPECTED_LOSS_NOTE` and `NRI_LINK` in `ExpectedLossSection`.
- **Dark mode is partial.** The map page's controls, legend, side panels and loss panel have no `dark:` styles, so they stay light in dark mode.
- **The home showcase's fallback is made up.** When the backend is down it shows rough regional scores from `fallbackStates`, with no "unavailable" label. The showcase also has no legend.
- **DC and Puerto Rico** have no state polygons, so they're only reachable through the county view or search. The API does return them at state level.
- **Addresses don't get a pin.** Picking an address zooms to its county but doesn't mark the address itself.
- **Map search can't tell a backend outage from no results.**
- **Address search depends on three free third-party services** (Photon, FCC, Nominatim) with no key, SLA or error reporting. Nominatim's usage policy asks for no more than one request a second and an identifying User-Agent, which a browser can't set.
- **Unused code and dependencies:** `lucide-react` is unused, `@types/leaflet` is in `dependencies` rather than `devDependencies`, and `StateRecord.row`/`col` are never sent.
- **Duplicated values:** `lib/nri.ts` repeats the backend's NRI hazard mapping, `lib/scoring.ts` repeats the 40/40/20 weights, `lib/riskColors.ts` repeats the tier cutoffs, and the About page repeats the model's log-scale examples (0.01% → 0, 1% → 67, 10% → 100). The "top 20%" and "11 of 18" text repeats backend constants. Update them if those change.

## 8. Guidance for coding agents

- Read this doc and `lib/types.ts` before changing anything that touches data.
- Call the backend only through `lib/api.ts`, keep tier and map colours in `lib/riskColors.ts`, and keep loss caveats in `lib/nri.ts`.
- Don't hardcode scores, losses, statuses or "live" labels. The site previously showed fake live indicators and sample values, which matters on a safety site.
- Keep risk scores and FEMA loss estimates visibly separate, and keep the "FEMA estimate" and excluded-hazard wording next to every dollar figure.
- `/about` makes public claims about the data, including `ScoreExplainer`'s formula. If you change sources or scoring, update it.
- To move the map, set `focus` in `app/map/page.tsx`. Don't call Leaflet's `fitBounds` with raw `getBounds()`, which breaks for Alaska.
- New components should include `dark:` styles.
- To check the contract, write a real API response into a `.ts` file as `const x: CountyRecord = {...}` and run `tsc` on it.
- Update this doc when you change types, routes, external calls or data flow.
