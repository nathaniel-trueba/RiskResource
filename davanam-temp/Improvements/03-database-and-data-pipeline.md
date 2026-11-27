# 3. Database and data pipeline

## Supabase free-plan risks

- **Projects pause after about a week without activity.** A paused project means the API can't start (it reads reference data at startup). Hourly Lambda writes probably count as activity, but don't rely on it. Either check the dashboard before anything important, or upgrade (Pro is $25/month), or keep a cheap scheduled read running against it.
- **500 MB database limit.** The alert archive is the only growing table: about 150-250 MB a year with slim rows. Check its size monthly: `SELECT pg_size_pretty(pg_total_relation_size('public.nws_alert_archive'));`. If it creeps up, lower `retention_days` in `archive_settings`.
- **No point-in-time recovery on free.** See backups below.

## Migrations

Today `db/schema.sql` only creates missing tables, and one-off changes live in `db/migrations/` as SQL files you run by hand. That works for one person, not for a team or for production.

- **Use a migration tool.** The Supabase CLI (`supabase migration new`, `supabase db push`) or a plain numbered-SQL runner that records applied migrations in a table. Either way, every schema change becomes a file that runs once, in order, everywhere.
- **Run migrations in CI or deploy, not at app startup.** Today the API runs `schema.sql` on startup when a table is missing. That's convenient, but it means any developer's laptop can change the shared schema.

## Backups

- Schedule `pg_dump` of the database to S3 weekly (a small Lambda or GitHub Action). The reference data can be rebuilt from `data/reference.json`, but the alert archive can't be rebuilt from anywhere. NWS doesn't keep old alerts.
- Test a restore once.

## Keeping reference data fresh

The reference data (FEMA declarations, USGS quake history, Census population, NRI losses) is rebuilt only when someone runs `python -m scripts.init_db --refresh`.

- **Schedule it.** Monthly is plenty: FEMA declarations trickle in, and NRI releases about once a year. Run it from the same AWS setup as the wildfire job, against a staging copy first, then production.
- **One source of truth for NRI.** The Lambda's NRI task was removed so that `build_reference_data.py` is the only writer of the NRI tables. Keep it that way.
- **Record what's loaded.** `reference_meta` already stores when the snapshot was built. Show it on `/api/health` and in the site footer ("Data as of ...").

## The alert archive

- **Run every 15 minutes, not hourly.** Many tornado and severe thunderstorm warnings last under an hour, so hourly runs never see them. Set `ALERT_ARCHIVE_MAX_AGE_MINUTES=30` on the API to match.
- **Use it.** It's collected but not shown anywhere yet. Easy wins:
  - "Alerts in the past year" on each county page (`county_fips` has a GIN index, so `WHERE county_fips @> ARRAY['06065']` is fast).
  - Red Flag Warning days per county as a wildfire model feature (06).
  - A history section on the About page once it has a season of data.
- **Backfill if you need older history.** The Iowa Environmental Mesonet archives NWS warnings back many years. That could seed the archive, or give the model years of Red Flag history.

## The river gauge idea

Dropped for the demo, but it's the best feature the Lambda could unlock: NWPS's nationwide gauge list includes flood categories, and storing it every 15 minutes would put river flooding on the national map, which the API can only do per county today. It needs a gauges table again, matching gauges to counties, and a staleness rule like the alert fallback.
