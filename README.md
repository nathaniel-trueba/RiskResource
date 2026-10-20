# Risk Resource

Natural disaster information is spread across many different agency websites and can be hard to access when they're needed. Risk Resource was built to help residents understand the natural disasters that could affect their home during any season and stay up-to-date with live monitoring and personalized steps to help stay prepared.

## What It Does

Risk Resource is planned as a website where a user enters a US address and sees:

- A risk score covering wildfire, flood, earthquake, and severe weather (whatever pertains to the location)
- A score for each hazard, with the factors driving it
- A map of the live data behind the score
- A plain-language explanation of the score
- Safety resources and recommended prevention for top hazards

The home page will display a map of current natural disasters across the US.

## Approach

Each hazard's sub-score will be built from two parts:

| Part | Based on | Examples |
|------|----------|----------|
| Baseline | Static, long-term data | FEMA National Risk Index, terrain, distance to faults and flood zones |
| Live | Real-time public feeds | Nearby active fires, river levels vs. flood stage, recent earthquakes, active weather alerts |

The composite score will be a weighted blend of the four sub-scores. Keeping the baseline and live parts separate is intended to make each score explainable.

The project will start with a rule-based score. The team will then train a machine learning model on historical data to estimate baseline risk, and will only use it if it performs better than the rules on held-out regions.

## Data

The team will build its own dataset by pulling from free public sources, including:

| Hazard | Planned sources |
|--------|-----------------|
| Location | US Census Geocoder |
| Wildfire | NASA FIRMS satellite detections, NIFC fire perimeters |
| Flood | USGS stream gauges, NOAA river forecasts, FEMA flood zone maps |
| Earthquake | USGS earthquake catalog and fault database |
| Severe weather | National Weather Service alerts |
| Weather conditions | Open-Meteo |
| All hazards | FEMA National Risk Index, OpenFEMA disaster declarations, GDACS |

## Planned Tech Stack

| Area | Tools |
|------|-------|
| Data and geospatial | Python, pandas, GeoPandas, PostGIS or DuckDB spatial |
| Modeling | scikit-learn, XGBoost, SHAP |
| Cloud | AWS (S3, Lambda, API Gateway, EventBridge, SageMaker, CloudWatch) |
| Frontend | Next.js, React, a web mapping library (MapLibre GL or Leaflet), Vercel |
| Explanations | Claude API |

## Suggested Repository Structure

```
RiskResource/
├── backend/
│   ├── ingest/          # fetchers for each data source
│   ├── features/        # per-hazard feature builders
│   ├── scoring/         # rule-based scoring
│   ├── tests/
│   └── requirements.txt
├── frontend/
│   ├── app/
│   ├── components/
│   ├── lib/
│   ├── public/
│   └── package.json
├── model/               # training code and model card
├── notebooks/           # EDA, scoring validation, model training
├── visuals/             # EDA plots and architecture flowchart
├── LICENSE
└── README.md
```

## Git and GitHub Workflow for DS3 Projects

Using Git and GitHub well is just as important as writing good code. A clean workflow makes collaboration easier and helps the project stay organized.

### 1. Use branches to separate work

Each person or feature should usually work in its own branch. This prevents people from overwriting each other's changes.

Common branch commands:

```bash
git branch
git checkout -b feature/my-task
git checkout main
git branch -d feature/my-task
```

What they mean:

- `git branch` shows existing branches
- `git checkout -b feature/my-task` creates and switches to a new branch
- `git checkout main` switches back to the main branch
- `git branch -d feature/my-task` deletes a branch after it is merged

### 2. Use pull requests to merge code into main

When work is complete, open a Pull Request (PR) from your branch into `main`. A PR is the place to review changes, discuss issues, and confirm everything is ready.

Important rule:

- Only project managers or mentors should approve pull requests.
- Students should contribute code, but approvals should be handled by the designated maintainers.

### 3. Basic Git commands and what they mean

```bash
git clone <repo-url>
git status
git add <file>
git add .
git commit -m "Describe your change"
git push origin <branch-name>
git log
git merge <branch-name>
git rebase <branch-name>
```

What they mean:

- `git clone` copies a repository from GitHub to your local machine
- `git status` shows which files changed and what branch you are on
- `git add` stages files for commit
- `git commit` saves staged changes with a message
- `git push` uploads your local commits to GitHub
- `git log` shows recent commit history
- `git merge` combines another branch into your current branch
- `git rebase` reapplies your commits on top of another branch and can help keep history cleaner

### 4. Recommended team habits

- Pull the latest changes before starting work
- Keep commits small and descriptive
- Avoid committing large data files or secrets
- Open a PR early for feedback, not only at the end
- Resolve merge conflicts carefully and communicate with the team

### 5. Example workflow

```bash
git checkout main
git pull origin main
git checkout -b feature/data-cleaning
git status
git add .
git commit -m "Add initial data cleaning script"
git push origin feature/data-cleaning
```

Then open a Pull Request on GitHub and wait for approval from the appropriate project manager or mentor.

## Notes for DS3 Projects

This template is intentionally simple so students can focus on the science instead of setup. As projects grow, teams can add:

- experiment tracking
- model checkpoints
- deployment scripts
- cloud infrastructure (AWS/GCP) in `infra/`
- frontend UI/UX code in `frontend/`
- CI checks
- docs pages

## Disclaimer **

Risk Resource is intended for informational purposes only and is not a substitute for official warnings or evacuation orders.
