# 7. Product accuracy and safety

## Must-fix for any public launch

- **Disclaimer.** Nothing on the site says it's informational and not a substitute for official warnings or evacuation orders. Put it in the footer, and next to every score.
- **About page claims that aren't true.** It still describes HRRR wind models, NIFC fire perimeters and satellite hotspots, ShakeMap ground acceleration, a "Wind × (100 − RH)" index and flood crest thresholds. The backend uses none of them. Rewrite the data sources cards and the data dictionary table to match what's actually used (see `claude-docs/backend-doc.md`, section 5). The score explainer and architecture cards are already correct.
- **The home page "Live hazard alerts" card says "PLANNED... Coming after backend launches"**, but live alerts already work. Update it.
- **"Built on public data" card** says scores come from FEMA's National Risk Index. They don't: NRI provides the loss figures, and the score comes from declarations, live feeds and the model.

## Scoring choices to revisit

All of these are listed with alternatives in `claude-docs/human-review.md`.

- **Quiet days look reassuring.** 40% of the score is live and usually 0, so almost everywhere reads Low or Moderate until something happens. Consider showing long-term risk and current conditions as two numbers.
- **"0/100" reads as "safe".** Show "No recorded events since 2006" instead of a bare 0.
- **Declarations aren't physical risk.** FEMA NRI's expected losses are a better long-term measure and are already in the database. Consider using them for the historical part.
- **The wildfire model can lower scores** in quiet weeks (06).
- **Tier names.** "Low" on a safety site should be tested with real users. Many will read it as "nothing to do".

## Features people will ask for

- **Address search.** It's county-level today. Geocode an address and show the county, with a note that risk varies within it.
- **"What should I do?"** Each top hazard could link to official preparation guidance (Ready.gov, CAL FIRE, local emergency management).
- **Alert sign-up links.** Point people to their county's official alert systems (Wireless Emergency Alerts, local opt-in systems).
- **Alert history per county,** from the archive (03).
- **River flooding on the national map** (03).

## Accessibility and mobile

- Run the site through an accessibility audit. Things to check: the map has no keyboard or screen-reader equivalent (add a sortable table of counties), colour-only meaning in the hazard bars and map bands, contrast on the muted text, and focus order in the side panels.
- Check the map and side panels on a phone. Many people will check risk on mobile, often during an event.
- The light theme is locked, and fonts aren't applied as intended (`app/layout.tsx` creates them but doesn't add their classes).

## Code cleanup

- Unused `lucide-react`, `@types/leaflet` in `dependencies`, unused `StateRecord.row`/`col`, an unused `Link` import on `/about`.
- The 6 existing lint errors (React effect warnings and `any` types).
