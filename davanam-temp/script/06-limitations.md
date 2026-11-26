# 6. Limitations

## The score itself

- **The weights are design choices, not validated science.** The 40/40/20 split, the tier cutoffs and the score each alert type gets were chosen by the team for a clear, explainable demo. No hazard expert has reviewed them, and the overall score hasn't been checked against real outcomes (only the wildfire model has been tested).
- **Quiet days can look reassuring.** Because 40% of the score is live conditions, which are usually zero, most counties read Low or Moderate on a calm day. A high-risk county can look calm until a warning is issued.
- **Disaster declarations measure federal response, not physical risk.** A county's history comes from FEMA declarations, which depend on how big an event was and how it was filed. For example, many tornadoes are filed as "severe storms".
- **A 0 doesn't mean safe.** A county with no recorded events since 2006 scores 0 for that hazard, but a 20-year window misses rare, severe events. The New Madrid fault zone, for example, has had major historical earthquakes.
- **The wildfire bias is intentional, but it's a bias.** Counties with high wildfire odds score higher overall than counties facing equally serious non-fire risks.
- **Expected losses aren't part of the score,** so a county can be "Low" risk and still be in FEMA's top 20% for expected losses. The site shows both, but they can appear to disagree.

## The wildfire model

- **Live predictions run on forecasts.** The model was trained and tested on observed weather. This week's weather comes from a forecast with different error patterns, especially for wind and humidity. Its live accuracy hasn't been measured yet.
- **It predicts large fires only.** It's trained on fires of roughly 500 to 1,000+ acres, so it says nothing about the many smaller fires that can still damage homes.
- **Fire history stops at 2024.** National large-fire records are published about a year late, and the model needs retraining to learn from newer fires.
- **County-level is coarse.** A large county like Riverside, CA spans desert, mountains and suburbs, and the model gives it one number.
- **Ignition, not spread.** It estimates whether a large fire starts in the county, not whether a fire will reach a particular neighborhood.

## Data and coverage

- **Weather is checked at one point per county,** its center, which can be far from where people live. Riverside County's center is in the desert.
- **Earthquake and river checks use approximate county boxes,** so they can pick up events just outside a county.
- **Some places have gaps:** Connecticut has no county-level loss data (FEMA reports it by planning region), Puerto Rico has no Census population figures, and tribal lands' disaster declarations can't be assigned to a county.
- **Missing hazards:** heat waves, drought, landslides and winter weather aren't scored as separate hazards, though some have large real-world impact.

## Engineering and operations

- **The weekly wildfire job is run by hand today.** Until it's scheduled in the cloud, someone has to run it each week. If it's missed, scores quietly fall back to history and live conditions only.
- **The cloud migration has a time limit to solve.** The weekly job takes about 30 minutes, longer than AWS Lambda's 15-minute limit, so it needs a container service or a split into smaller pieces.
- **Shared free API limits.** All visitors share the same public API limits. The design caches heavily, but a large traffic spike could still hit them.
- **The alert archive starts empty.** NWS doesn't publish past alerts, so the archive only covers the time since the Lambda started, and the backup is only as fresh as its last run (up to 15 minutes old).
- **No automated tests** yet. The project was built at hackathon speed.

## Safety

- **Informational only.** Risk Resource isn't a substitute for official warnings or evacuation orders. The site doesn't yet show a disclaimer saying so, and adding one is a priority before any public launch.
