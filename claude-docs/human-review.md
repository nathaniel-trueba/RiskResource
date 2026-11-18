# Decisions for humans to review

These are choices Claude made on its own while building the backend, connecting the frontend, moving the data into Supabase, adding FEMA's expected-loss figures and resolving merges with `main`. It also lists issues found in later teammate changes when these docs were last updated. Nobody on the team has approved them, and some of them affect what people are told about their safety. Each can be changed, and the "Change it in" column says where.

Snapshot: 2026-11-18, matching `main` at `c25e614`. When you settle an item, delete it or mark it as decided.

## Review these first

These are the items most likely to mislead someone using the site.

| # | Issue | Why it matters | Suggested action |
|---|---|---|---|
| 1 | **The scoring model isn't validated.** Every weight, cutoff and alert score in section 1 was chosen for a demo. No hazard expert has reviewed them, and they haven't been checked against real outcomes. | A person could read "Moderate" or "Low" as advice about their home. | Have someone with domain knowledge review section 1. Keep the site labelled as a prototype until then. |
| 2 | **The About page still describes data the site doesn't use.** `/about` still claims HRRR wind models, NIFC fire perimeters, ShakeMap ground acceleration, a "Wind × (100 − RH)" index and flood crest thresholds. Only the NRI parts were corrected. The footer has been fixed. | This is the public description of the methodology, on a site that promises transparency. | Rewrite `/about`'s sources, "Real-Time Telemetry" card and data dictionary to match [`backend-doc.md`](backend-doc.md#5-scoring-model). |
| 3 | **The About page's score slider explains a different score.** `ScoreExplainer` (PR #18) sits under "How the score is built" and computes a score from expected loss × a vulnerability/resilience factor. The site's risk score is FEMA declarations plus live signals, and doesn't use losses, vulnerability or resilience at all. Its note says it's "simplified", but not that it's a different method. | Readers will take it as how their county's number was made. A county can be high-loss and still "Low" risk on this site. | Decide what the slider should teach: rebuild it on the real model (baseline and live halves, then 60% worst + 40% top three), or relabel it as how FEMA's NRI rates risk, separate from this site's score. |
| 4 | **The site has no disclaimer.** Nothing on any page says the site is informational and not a substitute for official warnings or evacuation orders. Only the repo README says so. | It's a safety site, and scores can read as advice (items 5 and 6). | Add the README's disclaimer to the footer, and near the scores. |
| 5 | **"0/100" looks like "no risk".** A hazard scores 0 if the place has no recent history of it and nothing is active. | Absence from a record since 2006 isn't proof of safety. The New Madrid fault zone, for example, has major historical quakes that a 20-year window can't capture. | Consider wording such as "No recorded events since 2006", or hiding the number at 0. |
| 6 | **"Low" and "Moderate" may reassure too much.** On a quiet day almost every county is Low or Moderate, because half of each score is live and no hazard can exceed 50 without an active signal. | A high-risk county looks calm until an alert is issued. | Decide whether long-term risk and current conditions should be two separate numbers. FEMA's NRI losses are now available as a long-term measure (item 7). |
| 7 | **The score still uses declarations, not the NRI.** The NRI is now in the database, but only as separate dollar figures. Scores still come from FEMA declarations, which measure federal response rather than physical risk. FEMA has few "Tornado" declarations, probably because many are filed under "Severe Storm". | The site shows two long-term measures that can disagree: a county can be "Low" risk and also a high-loss county. | Decide whether NRI should replace or inform the score's baseline, or whether the two should stay separate and be explained. |
| 8 | **Loss figures include a dollar value for deaths and injuries.** NRI's total counts expected deaths and injuries at FEMA's dollar value: $40.7B of the national $153.8B. | "Expected annual loss" reads like property damage. The UI says lives are included, but the headline number doesn't separate them. | Decide whether to show property and crop loss only, or show the two parts separately (NRI has `_EALB`, `_EALA` and `_EALPE` fields). |

## 1. Scoring

All of this is in `backend/app/domain/`. Changing a FEMA mapping also needs a rebuild: `python -m scripts.init_db --refresh`, which writes to the shared database.

| Decision | What was chosen | Why | Alternatives | Change it in |
|---|---|---|---|---|
| Baseline vs live split | 50% / 50% | The original `/about` page said this | Weight long-term risk more heavily; show two numbers | `BASELINE_WEIGHT`, `LIVE_WEIGHT` in `scoring.py` |
| Composite formula | 60% highest hazard + 40% mean of top three | An average would let irrelevant hazards hide the real one | Maximum only; population or damage weighting | `composite_score` in `scoring.py` |
| Tier cutoffs | Critical 75+, Elevated 50+, Moderate 30+, Low below 30 | Aligned with the site's existing bar colours | FEMA's five ratings; percentile-based tiers | `TIER_FLOORS` in `scoring.py`. The side panels' bar and badge colours repeat 75 and 50 |
| Tier names | Low, Moderate, Elevated, Critical | Already in the frontend's types | FEMA's "Very Low" to "Very High" | Same as above, plus `frontend/lib/types.ts` |
| Hazard list | Wildfire, Earthquake, Flood, Severe Storm, Hurricane, Tornado | The frontend's filters plus Severe Storm from its mock data. Heat, drought and winter aren't separate hazards | Add heat or drought, which have large real-world impact | `Hazard` in `hazards.py` |
| Baseline method | Percentile rank among counties that have had the hazard; never-affected counties score 0 | Ranking against all counties made one tornado declaration score 93 | Rates per year; rates per person or area; NRI | `add_percentile_scores` in `scripts/build_reference_data.py` |
| History window | Since 2006 | `/about` described a 20-year baseline | Longer windows, especially for earthquakes | `BASELINE_SINCE_YEAR` in the same script |
| FEMA incident mapping | E.g. Winter Storm counts as Severe Storm; Mud/Landslide and Coastal Storm count as Flood; Tropical Storm counts as Hurricane | Closest available fit | Separate winter hazard | `FEMA_INCIDENT_HAZARDS` in `hazards.py` |
| FEMA exclusions | Emergency declarations (`EM`) and COVID-19 excluded | Many `EM` declarations cover evacuees from other states | Include them | `load_declarations` in the same script |
| Tribal lands | Count toward a state's total but no county | FEMA gives them no county code | Map reservations onto their counties | `load_declarations` |
| Earthquake baseline | M4.5+ within 60 miles of the county, since 2006 | FEMA has too few earthquake declarations to rank counties | USGS seismic hazard maps, or NRI's earthquake loss | Constants in the same script |
| Alert scores | E.g. Red Flag Warning 100, Flood Warning 85, Wind Advisory 35 | A judgement call for each of 31 alert types | Expert-set values | `ALERT_RULES` in `hazards.py` |
| Live earthquake scores | M5.5+ within 20 mi scores 100, M4.5+ within 30 mi scores 75, M3+ within 30 mi scores 45, counted for 7 days | Distances and magnitudes came from `/about`; the scores and the 7 days were chosen | Decay over time; measure ground shaking instead | `quake_score` in `scoring.py`, `RECENT_DAYS` in `clients/usgs.py` |
| Weather scores | RH ≤ 15% and gusts ≥ 25 mph scores 80 for wildfire; gusts ≥ 40 / 58 mph score 70 / 100; below that scores 0 | Thresholds came from `/about`; the scores were chosen. Scoring nothing below advisory level keeps the map and side panel in step | Graduated scores | `scoring.py` |
| Gauge scores | Major 100, moderate 85, minor 70, action 40; the worse of observed and forecast | A judgement call | | `GAUGE_CATEGORY_SCORES` in `scoring.py` |
| Rain | Shown in text but never scored | No threshold existed in the original design | Add a flash flood rule | `_flood_signal` in `services/risk.py` |
| State scores | Population-weighted average of counties | Reflects where people live | Worst county; area weighting. Averages dilute local hazards | `_population_weighted` in `services/snapshot.py` |
| Puerto Rico weighting | Equal weight for each municipio | No Census population data | Use NRI's population, which covers Puerto Rico | Same function |

## 2. Expected annual loss (FEMA NRI)

All in `backend/scripts/build_reference_data.py` and `backend/app/domain/hazards.py`, and mirrored in `frontend/lib/nri.ts`. Changes need `python -m scripts.init_db --refresh`.

| Decision | What was chosen | Why | Alternatives | Change it in |
|---|---|---|---|---|
| Source | FEMA's official NRI Counties ArcGIS feature service, December 2025 | OpenFEMA's API doesn't serve the NRI | The downloadable CSV | `NRI_URL` |
| Which hazards count | The 11 NRI hazards that match ours; 7 left out of every figure | Requested: leave out hazards with no match | Include all 18 in the total, and only the matched ones per hazard | `NRI_HAZARDS`, `NRI_EXCLUDED_HAZARDS` |
| Landslide | **Left out of losses, but FEMA "Mud/Landslide" declarations count as Flood in the score** | NRI's landslide had no match in the agreed list | Count NRI landslide as Flood too, for consistency | `NRI_HAZARDS` |
| Severe Storm grouping | Strong wind, hail, lightning, ice storm and winter weather | Mirrors the FEMA mapping, where Winter Storm counts as Severe Storm | Leave winter weather and ice storm out | `NRI_HAZARDS` |
| What "loss" includes | NRI's `_EALT` total, including deaths and injuries at FEMA's dollar value | It's NRI's headline figure | Property and crops only. See "Review these first", item 8 | `load_nri` |
| Per-person population | NRI's population | It's what NRI's own estimates use | Census population, which the score uses | `load_nri` |
| High-loss county | Top 20% of all NRI counties for loss per person ($732.52+ per person per year) | A simple, explainable cutoff from the same data | NRI's own `EAL_RATNG` rating, which covers all 18 hazards | `HIGH_LOSS_PERCENTILE` |
| "% of residents in high-loss counties" | Replaced the original "% of people in high-risk counties" | There's no data for "high-risk" in that sense. The label was changed to say "high-loss" | Define high-risk from the score's tiers | `MapControls.tsx`, `load_nri` |
| Connecticut | No county-level losses; state totals include its 9 planning regions | Regions don't line up with the 8 old counties on our map | Split region losses onto counties by population or area; switch to a map with planning regions | `load_nri`, `ExpectedLossSection.tsx` |
| Valdez-Cordova, AK | Its two 2019 successors are added together; ratings dropped | Our map still has the old county | | `NRI_TO_OUR_FIPS` |
| Social vulnerability and resilience | Shown in the county panel only, labelled "NRI rating, all hazards". Not on the map | They're ratings for all 18 hazards, not our 11 | Add them to the map's "Show" options, which the original design listed | `ExpectedLossSection.tsx` |

## 3. Data sources

| Decision | What was chosen | Why | Alternatives |
|---|---|---|---|
| Sources added beyond the original `apis.md` | Census population files, Plotly county GeoJSON, Open-Meteo geocoding, FEMA NRI | None of the original APIs provide population, county names, place search or losses | Other geocoders, such as the Census geocoder. Now listed in `apis.md` |
| Population vintage | Census 2021 estimates, 2019 for gaps | Newer files replace Connecticut's counties, which wouldn't match the map | Update the map file and use newer data |
| Static data | Pre-computed into `data/reference.json`, seeded into Supabase | Demo reliability; the source calls are slow | Refresh on a schedule |
| Weather location | One point at each county's center | One call per county | Sample several points, or where people live. Riverside's center is in the desert |

`backend/data/reference.json` was rebuilt on 2026-11-14 and doesn't refresh on its own.

## 4. Database (Supabase)

| Decision | What was chosen | Why | Alternatives | Change it in |
|---|---|---|---|---|
| Plan and region | Free plan, US East | Hackathon budget; the project already existed. The team planned to discuss the region with the project owner | A region closer to users. It only affects startup time | Supabase dashboard |
| Connection | Session pooler as the `postgres` role; no API keys | Works on IPv4 networks, where the free plan's direct connection doesn't | A dedicated, less-privileged role | `DATABASE_URL` in `backend/.env` |
| Access | Backend only. RLS enabled on every table with no policies | Nothing public needs to read the database | Policies for read-only public access | `db/schema.sql` |
| When data is read | Once at startup, into memory | Requests stay fast, and the database isn't a per-request dependency | Query per request | `main.lifespan` |
| Automatic setup | Every startup creates missing tables, and reseeds if any reference table is empty | No manual setup step; new tables fill themselves | A manual `init_db` step only | `db.initialize` |
| Shared database | Everyone on the team uses the same database. `--refresh` and `--reseed` replace data for all of them | One project on the free plan | A project per developer, or a local Postgres | |
| Existing tables | `api_config`, `locations`, `weather_observations`, `earthquakes`, `weather_alerts`, `gauges` were left in place, empty and unused | They were already in the project. Ask the project owner before dropping them | Drop them, or use them to store live data across restarts | `db/schema.sql` |
| Inactivity pausing | Not handled | Free projects pause after about a week without activity, and then the API won't start | Visit the dashboard before demos; upgrade | |

## 5. Interface

All in `frontend/`.

| Decision | What was chosen | Why | Change it in |
|---|---|---|---|
| Map colours for scores | Fixed bands of 10 (`0–9` up to `40+`), not the tiers | Real scores mostly fall between 0 and 50, so tier colours made the map one or two colours. **The map's colours don't line up with the tier names** shown in the side panel | `SCORE_BANDS` in `lib/riskColors.ts` |
| Map colours for losses | Quintiles of the values shown, labelled with real amounts | Dollar values have no natural scale | `quantileBands` in `lib/riskColors.ts` |
| "Show" dropdown | Risk score, loss per person, total loss, % of residents in high-loss counties (states only) | Restores the original design's options with real data. Each FEMA option says "(FEMA)" | `MEASURES` in `components/map/MapControls.tsx` |
| Hazard buttons | Filter both scores and losses; added Severe Storm; disabled for the high-loss share | The share is defined on all hazards together | Same file |
| Default view | California opens first | It was the previous default | `DEFAULT_STATE_CODE` in `app/map/page.tsx` |
| Search result choice | Map search lists matches; Enter or a home-page search opens the best match. Same-named counties are ranked by population | Quick for the common case, but "Washington" opens the largest one | `MapControls.tsx`, `app/map/page.tsx` |
| Home score card | Live data for Palm Springs, Santa Rosa, Fresno and San Diego; badge says "Live data" | Replaced hard-coded sample scores | `PRESETS` in `components/home/HeroScoreCard.tsx` |
| Home showcase | Five hazards, coloured by real state scores. Severe Storm isn't one of them, and the hand-written hazard descriptions were kept | The section heading says "five hazards" | `components/home/HazardMapShowcase.tsx` |
| Threat Index tile | Shows the state's real tier, instead of the hard-coded "High (Live)" | That value wasn't real | `components/map/StateInspector.tsx` |
| County panel footer | "Scores: NWS & USGS live feeds · Losses: FEMA NRI", with a green "● Active" dot | The text was corrected, but the dot is still hard-coded | `components/map/CountyInspector.tsx` |
| DC and Puerto Rico | Available through the county view and search, not as state polygons | The state map file doesn't include them | `RiskLeafletMap.tsx` |
| Map zoom | "View county breakdown" zooms to the state; arriving from a home-page search zooms to the county (up to zoom 8). Map search and map clicks don't move the map; the States/Counties toggles and "Back" zoom out | The d3 map on `main` zoomed into states, and the Leaflet map that replaced it didn't | `focus` in `app/map/page.tsx`; `FOCUS_MAX_ZOOM` in `RiskLeafletMap.tsx` |
| Alaska bounds | Longitudes east of 0° are shifted west by 360° when zooming, so the Aleutians count as west of the 180° line | Otherwise Alaska's box spans the globe. The westernmost islands end up just off-screen | `boundsOf` in `RiskLeafletMap.tsx` |
| Map design | The Leaflet map was kept, and `main`'s d3 map design (PRs #9 and #15) was dropped in the merge | The d3 map ran on generated sample values ("Sample values, not FEMA data") and didn't call the backend | Port the d3 design onto `lib/api.ts` in a separate change, if the team prefers it |
| Theme | Light theme, locked | PR #15 added a toggle, then locked light mode | `app/layout.tsx`, `app/globals.css` |

## 6. Site wording

Claude changed these to match the data. Read them and correct anything you'd phrase differently.

| Location | Change |
|---|---|
| Home hero eyebrow | "FEMA National Risk Index · 3,232 Counties" became "FEMA · USGS · NWS Data · 3,221 Counties" |
| Home hero text | Now says "what FEMA estimates they cost each year, and how your community rates for resilience" |
| Home features | The map card lists the real "Show" options. The data card says losses come from the NRI and scores from FEMA declarations, USGS and NWS |
| `/about`, NRI card | Describes what NRI is used for: losses and ratings, for 11 of its 18 hazards, not the score |
| `/about`, new data source | OpenFEMA Disaster Declarations, which the score's baseline actually uses |
| `/about`, baseline card | Was "Derived from FEMA NRI 20-year historical incidence, fault line proximity, elevation slope ...", which was false. Now describes the declaration percentile and the USGS earthquake count |
| `/about`, new section | "Expected annual loss": what the dollars mean, the hazard mapping table, what's left out, Connecticut |
| Loss panels and legends | Every dollar figure is labelled a FEMA estimate, with the excluded hazards and the deaths-and-injuries caveat |
| Footer, data feeds | (Teammate change, PR #17.) Now links OpenFEMA, USGS, NWS, NOAA NWPS and Open-Meteo, and no longer lists NIFC. It doesn't list FEMA's NRI, which every loss figure comes from |

**Not yet corrected:** the rest of `/about`, and `ScoreExplainer`. See "Review these first", items 2 and 3. The footer's Team column is still four "Member N" placeholders linking to `#`.

## 7. Removed or changed in code

| Item | Note |
|---|---|
| `lossPerPerson`, `totalLoss`, `highRiskPct`, `highRiskCounties`, `risk`, `color` | Removed from `lib/types.ts`. They were never filled in. Replaced by `expectedLoss` |
| `CartogramGrid.tsx`, `lib/mockRiskData.ts`, `HeroSection.tsx`, `MiniMapPreview.tsx`, `StatsSection.tsx`, `CtaBanner.tsx` | Deleted. None was used, and all held sample data. `StateRecord.row` and `col`, used only by `CartogramGrid`, are still in `lib/types.ts` |
| `d3`, `topojson-client` | Dropped from `frontend/package.json` with `main`'s d3 map |
| Next.js | Upgraded from 16.4.3 to ^16.4.6, which fixes a known security vulnerability |
| `.gitignore` | Now ignores `.env`, `__pycache__/`, `*.pyc` and `.venv/`. The committed `.pyc` files were removed from git |

## 8. Not done

- **Backend hosting.** The frontend is deployed, but the backend isn't, so the deployed site shows no data. The repo owner is setting up a Render web service. The steps and the settings it needs are in [`backend-doc.md`](backend-doc.md#deploying). A free Render service sleeps after 15 idle minutes, so the first visit after that is slow; decide whether that's acceptable for demos.
- **Secrets on older branches.** Branches whose `.gitignore` predates the `.env` rule don't ignore `backend/.env`. Merge `main` into them before working there.
- **Boundary files.** The map loads its GeoJSON from third-party GitHub branches at runtime. They could move or change, so consider self-hosting them.
- **Fonts.** `app/layout.tsx` loads three Google fonts but doesn't apply them, so headings use system fonts. Add the fonts' `.variable` classes to `<html>`, or remove them.
