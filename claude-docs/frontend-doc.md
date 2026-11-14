# Risk Resource frontend: design and data contract

Audience: developers and coding agents working on the frontend or the backend that feeds it.

Snapshot: 2026-11-14, at commit `221a0c8` on `add-backend-connect-supabase`. Line references will drift. If this doc and the code disagree, the code wins, and this doc should be updated.

Related docs:

- [`backend-doc.md`](backend-doc.md): the API, scoring, the database and caching.
- [`human-review.md`](human-review.md): decisions that still need human review, including the site's wording.

## 1. Summary

Risk Resource is a prototype site for US natural disaster risk, with three routes: a landing page, an interactive risk map and a methodology page.

**Every page that renders gets its risk data from the FastAPI backend.** The backend must be running for scores and losses to appear. Without it, pages still load and show error or "unavailable" text. The browser never talks to Supabase directly.

The site shows two different kinds of number, and labels them differently:

| | Risk score | Expected annual loss |
|---|---|---|
| Shown as | 0 to 100, with a tier | Dollars, labelled "FEMA estimate" |
| Changes with live alerts and weather | Yes | No |
| Comes from | FEMA declarations, USGS, NWS, Open-Meteo, NWPS | FEMA National Risk Index, 11 of its 18 hazards |

## 2. Stack and commands

| Area | Details |
|---|---|
| Framework | Next.js 16.4.3 (App Router, Turbopack), React 19.3 |
| Language | TypeScript in strict mode, with the path alias `@/*` pointing at `frontend/*` |
| Styling | Tailwind CSS v4, through the `@tailwindcss/turbopack` loader in `next.config.ts` |
| Map | Leaflet 1.9 and react-leaflet 5 |

To run the whole site, start the backend first (see [`backend-doc.md`](backend-doc.md#2-running-it)), then from `frontend/`:

```bash
npm ci
npm run dev        # http://localhost:3000
npm run lint
npx tsc --noEmit
```

| Check at this snapshot | Result |
|---|---|
| `npx tsc --noEmit` | Passes |
| `npm run lint` | 2 errors (`react/no-unescaped-entities`), both in unused components: `CtaBanner.tsx` and `HeroSection.tsx` |
| `npm run build` | Not run at this snapshot |
| Tests and CI | None exist |

`tsc` writes `tsconfig.tsbuildinfo`, which isn't git-ignored. Delete it rather than committing it.

**Environment variables,** both optional, set in `frontend/.env.local`. The `NEXT_PUBLIC_` prefix means values ship to browsers and are fixed at build time.

| Variable | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `http://localhost:8000/api` | Backend base URL |
| `NEXT_PUBLIC_CARTO_API_KEY` | None | CARTO basemap. Falls back to OpenStreetMap tiles |

## 3. Structure

```
frontend/
  app/
    layout.tsx               Root layout and fonts
    page.tsx                 /       Landing page
    map/page.tsx             /map    Owns all map state and data fetching
    about/page.tsx           /about  Methodology, mostly static content
  components/
    common/                  Navigation, Footer
    home/
      HomeSearch.tsx         Search box and "Try:" chips; sends to /map?q=
      HeroScoreCard.tsx      Live county data for 4 preset places
      HazardMapShowcase.tsx  SVG state map coloured by real per-hazard scores
      FeaturesGrid.tsx       Static content
      HeroSection.tsx, MiniMapPreview.tsx, StatsSection.tsx, CtaBanner.tsx    Unused
    map/
      RiskLeafletMap.tsx     Leaflet map; fetches GeoJSON; loaded with ssr: false
      MapControls.tsx        View toggle, "Show" dropdown, hazard buttons, county search
      MapLegend.tsx          Colour bands for the current measure
      StateInspector.tsx, CountyInspector.tsx    Side panels
      ExpectedLossSection.tsx    FEMA loss section, shared by both side panels
      CartogramGrid.tsx      Unused
  lib/
    api.ts                   Every backend call
    types.ts                 API response types
    riskColors.ts            Colour bands, hazard list, hazard colours
    format.ts                Dollar and percent formatting
    nri.ts                   What the loss figures include and leave out
    mockRiskData.ts          Old mock data; only the unused CartogramGrid imports it
```

**Unused files:** `HeroSection`, `MiniMapPreview`, `StatsSection`, `CtaBanner` and `CartogramGrid` aren't imported by any page, and they still contain hard-coded sample data. `CartogramGrid` is the only importer of `mockRiskData.ts`. All six could be deleted.

### `/map` data flow

[`app/map/page.tsx`](../frontend/app/map/page.tsx) holds all the state, with no global store or data-fetching library:

| State | Type | Purpose |
|---|---|---|
| `viewMode` | `'states' \| 'counties'` | Which layer shows, and which map values to fetch |
| `measureChoice` | `'score' \| 'lossPerPerson' \| 'totalLoss' \| 'highLossPct'` | The "Show" dropdown |
| `hazard` | `HazardKey \| null` | The hazard buttons. `null` is "All hazards" |
| `selectedState`, `selectedCounty` | Records or `null` | What the side panel shows |
| `loading`, `error` | | Side panel request status |
| `mapValues` | Cache keyed by `level:metric:hazard` | Map colours already fetched, so switching back is instant |
| `mapError` | | Map colour request status |

Two values are derived rather than stored:

- **`measure`:** `highLossPct` only exists for states, so in county view it falls back to `lossPerPerson`.
- **`activeHazard`:** `highLossPct` is defined on all hazards together, so it ignores the hazard buttons.

`queryFor(measure, hazard)` turns those into the backend's `metric` and `hazard` parameters. For example, Score + Flood is `metric=flood`, while Loss per person + Flood is `metric=lossPerPerson&hazard=flood`.

**Stale responses:** each side panel request gets a number from `latestRequest`. Responses to older requests are ignored, so a slow response can't overwrite a newer click. Loading a county also loads its state if it differs from the current one, so "Back to <state>" is right.

**URL parameters,** read once on mount from `window.location.search`:

| Parameter | Effect |
|---|---|
| `?fips=06065` | Opens that county |
| `?q=Palm Springs, CA` | Searches, opens the best match. Falls back to California if nothing matches |
| None | Opens California |

### Calls by user action

| Action | Backend call | Then |
|---|---|---|
| Open `/map`, switch view, change "Show", or pick a hazard | `GET /map-values?level=&metric=&hazard=` (unless cached) | Recolours the map and legend |
| Open `/map`, or click a state | `GET /states/{code}` | `StateInspector` |
| Click a county, or a search result | `GET /counties/{fips}`, plus `GET /states/{code}` if the state changed | `CountyInspector` |
| Type in the map search | `GET /search?q=&limit=8`, 250 ms after the last keystroke | Results list. Enter opens the first |
| Arrive with `?q=` | `GET /search?q=&limit=1` | Opens the match |
| Open `/` | `GET /counties/06097` (Santa Rosa, the default preset) | `HeroScoreCard`. Other presets fetch on click, once each |
| Open `/` | 5 × `GET /map-values?level=state&metric=<hazard>` | `HazardMapShowcase` |
| Search or click a chip on `/` | None | Navigates to `/map?q=` |

The home score card's presets are Palm Springs (`06065`, Riverside County), Santa Rosa (`06097`, Sonoma), Fresno (`06019`) and San Diego (`06073`).

### External requests

The browser fetches both GeoJSON files when the map mounts. The home showcase fetches the state file again.

| Layer | Source | Size | Feature ID | Properties |
|---|---|---|---|---|
| States | [folium `us_states.json`](https://raw.githubusercontent.com/python-visualization/folium-example-data/main/us_states.json) | 88 KB, 50 features | `"CA"` | `name: "California"` |
| Counties | [plotly `geojson-counties-fips.json`](https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json) | 3.2 MB, 3,221 features | `"06065"` | `NAME: "Riverside"`, `LSAD`, `STATE`, `COUNTY` |

Both are unpinned files on third-party `main`/`master` branches. Consider self-hosting them.

### Colours and legends

All in [`lib/riskColors.ts`](../frontend/lib/riskColors.ts):

| Measure | Bands |
|---|---|
| Risk score | Fixed: `0–9`, `10–19`, `20–29`, `30–39`, `40+` (`SCORE_BANDS`) |
| Dollar and percent measures | Quintiles of the values currently shown (`quantileBands`), labelled with real amounts, e.g. `$447 – $737` |
| No value | Grey, "No data" |

**The score bands aren't the tiers.** Tiers break at 30, 50 and 75, but real scores mostly fall between 0 and 50, because half of each score is live and is 0 when nothing is happening. Tier-based colours made almost the whole map one or two colours. The side panels and tooltips still show the backend's tier names.

Quintile bands skip repeated cut points, so a measure where most areas are $0 (for example, hurricane loss) can show fewer than five bands. The home showcase uses `SCORE_BANDS` too.

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

export interface StateRecord {
  code: string;        // Matches the state GeoJSON feature ID, e.g. "CA"
  name: string;
  row?: number; col?: number;         // Only used by the unused CartogramGrid
  compositeScore: number;
  tier: Tier;
  countiesCount: number;
  population: string;  // Preformatted, e.g. "39,501,350", or "N/A"
  activeAlertCount?: number; // Absent when the NWS feed is unavailable
  primaryAlert?: string;     // Absent when there are no active alerts
  hazards: HazardItem[];     // Highest score first
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
  hazards: HazardItem[];
  expectedLoss?: CountyExpectedLoss; // Absent without NRI data, e.g. Connecticut
}

export interface MapValue {
  id: string;          // State code or FIPS, matching the GeoJSON feature ID
  value: number;       // Score (0 to 100), dollars, or a percent, depending on the metric
  tier?: Tier | null;  // Only for score metrics
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

### Rules the types don't express

- **Alerts have three states.** With alerts, the field holds their text. With none, it's absent, and the UI shows "No active alerts". If the NWS feed is down, it holds "NWS alert feed unavailable, so alert status is unknown", and `activeAlertCount` is absent, which the state panel shows as "Unavailable". Never treat an outage as "no alerts".
- **Join on IDs, never on names.** County GeoJSON names have no suffix, and 444 names are shared by more than one county ("Washington" appears 31 times).
- **FIPS codes are strings.** As numbers, `06065` would become `6065` and match nothing.
- **Hazards render in array order.** The UI doesn't sort them.
- **Dollar amounts are raw numbers.** Format them with `formatUsd` (`$447`, `$35.4M`, `$28.5B`).
- **A county's side panel score can differ from its map value,** because only the side panel includes weather and river gauges. See [`backend-doc.md`](backend-doc.md#why-a-countys-map-colour-can-differ-from-its-sidebar-score).

## 5. Working with the map

react-leaflet reads a GeoJSON layer's `data`, `style` and `onEachFeature` only when the layer is created. So `RiskLeafletMap` gives each layer a `key` built from `valuesKey` (`level:metric:hazard`), and changing it recreates the layer with the new colours and tooltips. Restyling happens only when the values or measure change.

Its props:

```ts
interface Props {
  viewMode: 'states' | 'counties';
  values?: Record<string, MapValue>;            // Undefined while loading
  valuesKey: string;                            // Changes when values change; recreates layers
  colorFor: (value: number | undefined) => string;
  describe: (value: MapValue) => string;        // Tooltip line, may contain HTML
  onSelectFeature?: (id: string, type: 'state' | 'county') => void;
}
```

Other things to know:

- Leaflet touches `window`, so anything importing it must stay behind `dynamic(..., { ssr: false })` in a client component.
- Overlays above the map need a z-index above Leaflet's panes. The search list uses `z-[1000]`, and the legend `z-[500]`.
- **The map's wrapper has `self-start`.** Without it, the wrapper stretches to the side panel's height (which grew with the loss section), and the legend, pinned with `absolute bottom-4 left-4`, drops below the map.

## 6. Error states

| Failure | What the user sees |
|---|---|
| Backend down, map values | Red banner: "Couldn't load map colours: ... Is the backend running?" Polygons show "Loading..." in tooltips |
| Backend down, side panel | Red banner: "Couldn't load CA: ... Is the backend running?", then "No data to show." if nothing loaded yet |
| Backend down, map search | "No matching counties" (errors aren't distinguished from no results) |
| Backend down, home score card | "Backend unavailable" |
| Backend down, home showcase | "Live scores unavailable"; states stay the base colour |
| County without NRI data | Loss section explains why; Connecticut gets a specific message about planning regions |
| GeoJSON fails to load | Only logged to the console. The "Loading ... Boundary Layers" overlay stays up |
| One upstream source down | Handled by the backend: scores still load, with "(live data unavailable)" in the affected warnings |

There's no retry button anywhere: reload the page.

## 7. Known issues

- **About page and footer still make claims that aren't true.** The NRI parts were corrected, but `/about` still describes HRRR wind models, NIFC fire perimeters, ShakeMap ground acceleration, a "Wind × (100 − RH)" index and flood crest thresholds that the backend doesn't use. The footer lists NIFC as a source. See [`human-review.md`](human-review.md).
- **DC and Puerto Rico** have no state polygons, so they're only reachable through the county view or search. The API does return them at state level.
- **The selected area isn't highlighted** on the map, and the map doesn't zoom to search results.
- **Map search can't tell an outage from no results.**
- **Unused files and dependencies:** see [section 3](#3-structure). `lucide-react` is unused, and `@types/leaflet` is in `dependencies` rather than `devDependencies`.
- **Duplicated values:** `lib/nri.ts` repeats the backend's NRI hazard mapping, and the "top 20%" and "11 of 18" text repeats backend constants. Update them if those change.

## 8. Guidance for coding agents

- Read this doc and `lib/types.ts` before changing anything that touches data.
- Call the backend only through `lib/api.ts`, keep colours in `lib/riskColors.ts`, and keep loss caveats in `lib/nri.ts`.
- Don't hardcode scores, losses, statuses or "live" labels. The site previously showed fake live indicators and sample values, which matters on a safety site.
- Keep risk scores and FEMA loss estimates visibly separate, and keep the "FEMA estimate" and excluded-hazard wording next to every dollar figure.
- `/about` makes public claims about the data. If you change sources or scoring, update it.
- To check the contract, write a real API response into a `.ts` file as `const x: CountyRecord = {...}` and run `tsc` on it.
- Add any decision a human might want to change to [`human-review.md`](human-review.md).
- Update this doc when you change types, routes or data flow.
