# 2. Tracked hazards, the scoring model, and why it's wildfire-biased

## The six hazards

| Hazard | What drives its score |
|---|---|
| **Wildfire** | Past fire disasters in the county; Red Flag and fire weather warnings; forecast hours that are both very dry and very windy. Plus a dedicated weekly wildfire model (below) |
| **Earthquake** | Strong earthquakes recorded near the county since 2006; any notable earthquake nearby in the past week |
| **Flood** | Past flood disasters; active flood warnings; river gauges at or near flood stage |
| **Severe storm** | Past severe storm and winter storm disasters; storm and wind warnings; forecast damaging wind gusts |
| **Hurricane** | Past hurricane and tropical storm disasters; active hurricane and tropical storm warnings |
| **Tornado** | Past tornado disasters; active tornado watches and warnings |

Every US county is covered: 3,221 counties across the 50 states, Washington DC and Puerto Rico.

## How the score is built

The overall threat score is a 0 to 100 number with three ingredients:

| Share | Ingredient | What it captures | Changes |
|---|---|---|---|
| **40%** | **History** | How often this hazard has struck the county, compared with other counties. Based on federal disaster declarations since 2006 (and recorded earthquakes) | Rarely; it's a long-term record |
| **40%** | **Live conditions** | What's happening right now: active weather warnings, recent earthquakes, forecast extreme wind and fire weather, river levels | Minute to minute |
| **20%** | **Wildfire model** | This week's forecast chance that a large wildfire starts in the county | Every week |

How they fit together, in three steps:

**Step 1: Score each hazard separately, 50% history and 50% live.** Each of the six hazards gets its own 0 to 100 score:

- **Half history:** how the county ranks for that hazard since 2006, among counties that have had it.
- **Half live:** the strongest live signal for that hazard right now. On a quiet day this is usually 0.

A county with a long flood record and an active flood warning scores high for flood. The same county on a quiet day scores moderately, because only the history half counts.

**Step 2: Combine the six hazards, 60% worst and 40% top three.** This step works *across* hazards, not within one:

- **60%** comes from the single highest hazard score.
- **40%** comes from the average of the three highest hazard scores.

Leaning on the worst hazard keeps irrelevant hazards from diluting the one that matters. Hurricanes don't threaten Nevada, so a near-zero hurricane score shouldn't pull Nevada's score down, as a plain average of all six would. The top-three part still gives some credit for facing several serious hazards at once.

**Step 3: Add the wildfire model as the final 20%.** The overall score is 80% of the combined hazard score from step 2, plus 20% of the wildfire model score.

**Where 40/40/20 comes from:** history and live each make up half of every hazard score, and the combined hazard score is 80% of the total. So history and live each end up as 40% of the overall score, and the wildfire model is the remaining 20%.

The final number maps to a tier: **Low** (below 30), **Moderate** (30 to 49), **Elevated** (50 to 74) and **Critical** (75 and up).

**A worked example** for a county on a quiet day, with no active warnings:

| Step | Calculation | Result |
|---|---|---|
| 1. Hazard scores | Wildfire: 50% × 100 history + 50% × 0 live | 50 |
| | Earthquake: 50% × 90 + 50% × 0 | 45 |
| | Flood: 50% × 40 + 50% × 0 | 20 |
| | Hurricane, tornado, severe storm | Lower; not in the top three |
| 2. Combine hazards | 60% × 50 (worst) + 40% × (50 + 45 + 20) ÷ 3 (top three) = 30 + 15.3 | 45 |
| 3. Add wildfire model | 80% × 45 + 20% × 57 (this week's model score) = 36 + 11.4 | **47, Moderate** |

If a Red Flag Warning were issued, wildfire's live half would jump from 0 to 100. That takes wildfire to 100, the combined hazard score to 82 (60% × 100 + 40% × 55) and the overall score to 77, which is Critical.

States are scored from their counties, weighted by population, so a state's score reflects where people actually live.

**What isn't in the score:** FEMA's expected annual loss figures (dollars of damage per year) are shown separately on every county and state, because "how likely" and "how costly" are different questions.

## Why the score is wildfire-biased

Only wildfire has its own forward-looking model, and it makes up 20% of every overall score. So two counties with identical history and live conditions will score differently if one faces much higher wildfire odds this week. That's a deliberate choice:

- **Wildfire risk changes week to week more than most hazards.** A county's earthquake risk is about the same next week as this week. Wildfire risk swings sharply with heat, drought and wind, so a weekly forecast adds real information that history and live alerts don't.
- **Wildfire can be forecast days ahead.** The conditions that lead to large fires (dry vegetation, weeks without rain, hot and dry air) build up over days and weeks. That makes ignition risk predictable in a way that, for example, earthquakes aren't.
- **Live alerts arrive late.** A Red Flag Warning is issued a day or so ahead of dangerous fire weather. The model can flag a dangerous week earlier, based on how dry the season has been.
- **It's where fast-moving disasters meet growing communities.** More people are living at the edge of wildland, and recent fires have spread into towns within hours.
- **It's the hazard we could model well with public data.** Consistent national fire records and daily weather data let us train and test a model across the whole country (see the model writeup).

The bias is explained on the site's About page. Individual hazard scores, including the Wildfire bar, are left unbiased, so users can still compare hazards fairly.
