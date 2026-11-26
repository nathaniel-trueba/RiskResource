# 7. The alert archive (AWS Lambda)

## What it does

A small AWS Lambda function runs on a schedule (every 15 minutes recommended), triggered by Amazon EventBridge. Each run, it:

1. **Asks the National Weather Service for every active alert in the US:** warnings, watches and advisories, from Red Flag Warnings to flood and tornado warnings.
2. **Keeps only alerts that cover a US county.** About half of all active alerts are marine (for example, small craft advisories at sea) and never reach a county, so they're skipped.
3. **Saves the useful details of each alert** to our Supabase database: what it is, how severe, its headline, which counties it covers, and when it was issued, starts and ends.
4. **Notes the time of the run,** so the website knows how fresh the stored copy is.
5. **Deletes alerts older than one year,** so the archive stays a rolling 12 months.

It calls one outside API: the **National Weather Service active alerts API** (api.weather.gov). Everything else it needs (the list of counties, its settings) comes from our own database.

## Why it matters

**1. It builds a history that doesn't exist anywhere else in the app.** The National Weather Service only tells you what's active *right now*. Once an alert expires, it's gone from the live feed. The archive keeps a rolling year of every county-level alert, so we can answer questions like:

- "How many flood warnings did this county get in the past year?"
- "How many Red Flag (extreme fire weather) days did this county have last summer?"
- "Which counties had the most severe weather warnings this year?"

That's a more local, more recent history than the federal disaster declarations the score uses today, and it could later feed the score or the wildfire model.

**2. It keeps warnings visible when the weather service is unreachable.** If our backend can't reach the National Weather Service (an outage, a network problem, or our server waking up from sleep during one), the site doesn't go blank on alerts. It shows the warnings from the Lambda's most recent run, clearly labelled, for example *"Flood Warning until noon (as of 14:15 UTC; live NWS feed unavailable)"*. On a safety site, a slightly delayed warning beats no warning at all.

What it can't do: if our own website or backend is down, nothing from our system reaches users, including the archive. Covering that case would need something separate, such as a static status page.

**3. It does this cheaply.** It runs within AWS's free tier and stores a year of alerts within Supabase's free database plan (estimated at about 150 to 250 MB a year), because it stores only useful fields, not the full raw responses.

## How the one-year retention works

The retention period is a single setting in the database, so it can be changed without touching code:

| Where | Table `archive_settings`, row `nws_alert_archive` |
|---|---|
| Setting | `retention_days`, set to **365** |
| How to change it | Open Supabase → Table Editor → `archive_settings`, and edit the number (1 to 3,650) |
| What happens | At the end of every run, the Lambda deletes alerts issued more than that many days ago |

The same row also records `last_run_at`, the time of the Lambda's last successful run. That's how the website knows whether the stored alerts are recent enough to show: if the Lambda stopped running, the website stops using its copy rather than showing old warnings as current.

**One thing to note:** the history starts from the first run. The National Weather Service doesn't offer past alerts, so the archive can't be backfilled. It fills up over its first year.

## How it fits with the rest of the system

```
EventBridge (every 15 min) ──▶ Lambda ──▶ NWS alerts API
                                  │
                                  ▼
                     Supabase: nws_alert_archive (rolling 1 year)
                                  ▲
                                  │ only if NWS is unreachable
                        Backend API ──▶ Website
```

- **The backend still calls the National Weather Service directly** for live alerts. The archive adds history and a backup; it doesn't replace the live feed.
- **The backend and Supabase stay the source of truth** for everything else (counties, disaster history, FEMA loss estimates). The Lambda only writes its own archive.

## Keeping costs at zero

- **Lambda:** a run takes a few seconds, so even every 15 minutes (about 2,900 runs a month) is far inside the free tier.
- **CloudWatch logs:** each run writes a short summary log. Logs are set to delete themselves after 30 days, so they can't pile up.
- **Supabase:** about 150 to 250 MB for a full year of alerts, inside the 500 MB free plan alongside our other data.
