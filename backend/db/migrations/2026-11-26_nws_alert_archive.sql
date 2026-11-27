-- One-time migration: slim NWS alert archive with one-year retention.
--
-- Run once against the shared Supabase database, in the SQL Editor (paste and
-- Run) or with: psql "$DATABASE_URL" -f db/migrations/2026-11-26_nws_alert_archive.sql
-- It runs in one transaction, so it either all applies or none of it does, and
-- it's safe to run again.
--
-- What it does:
--   1. Creates nws_alert_archive and archive_settings (also in db/schema.sql).
--   2. Copies the last year of alerts the Lambda already stored in weather_alerts
--      into the slim format, keeping only alerts that cover a county.
--   3. Removes api_config rows for every API except nws_alerts, and adds the
--      nws_alerts row if it's missing.
--   4. Drops the tables only the old Lambda tasks wrote, which nothing reads:
--      weather_alerts, earthquakes, gauges, weather_observations, locations.
--      Step 2 keeps the alert history first. The other tables' data is discarded.
--
-- Deploy the new aws/lambda_function.py right after this. The old one writes to
-- the dropped tables and would fail until it's replaced.

BEGIN;

-- 1. New tables -----------------------------------------------------------------

CREATE TABLE IF NOT EXISTS public.nws_alert_archive (
  id            text PRIMARY KEY,
  event         text NOT NULL,
  severity      text,
  urgency       text,
  certainty     text,
  message_type  text,
  headline      text,
  area_desc     text,
  county_fips   text[] NOT NULL CHECK (cardinality(county_fips) > 0),
  sent          timestamptz NOT NULL,
  effective     timestamptz,
  expires       timestamptz,
  ends          timestamptz,
  first_seen_at timestamptz NOT NULL,
  last_seen_at  timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS nws_alert_archive_sent_idx ON public.nws_alert_archive (sent);
CREATE INDEX IF NOT EXISTS nws_alert_archive_last_seen_idx ON public.nws_alert_archive (last_seen_at);
CREATE INDEX IF NOT EXISTS nws_alert_archive_county_idx ON public.nws_alert_archive USING gin (county_fips);

CREATE TABLE IF NOT EXISTS public.archive_settings (
  table_name     text PRIMARY KEY,
  retention_days integer NOT NULL CHECK (retention_days BETWEEN 1 AND 3650),
  last_run_at    timestamptz,
  updated_at     timestamptz DEFAULT now()
);
INSERT INTO public.archive_settings (table_name, retention_days)
VALUES ('nws_alert_archive', 365)
ON CONFLICT (table_name) DO NOTHING;

ALTER TABLE public.nws_alert_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archive_settings ENABLE ROW LEVEL SECURITY;

-- 2. Keep the history already collected -------------------------------------------

DO $$
BEGIN
  IF to_regclass('public.weather_alerts') IS NOT NULL THEN
    INSERT INTO public.nws_alert_archive (
      id, event, severity, urgency, certainty, message_type, headline, area_desc,
      county_fips, sent, effective, expires, ends, first_seen_at, last_seen_at
    )
    SELECT
      w.id,
      w.event,
      w.severity,
      w.urgency,
      w.certainty,
      w.raw -> 'properties' ->> 'messageType',
      w.headline,
      w.area_desc,
      f.fips,
      w.sent,
      w.effective,
      w.expires,
      (w.raw -> 'properties' ->> 'ends')::timestamptz,
      w.fetched_at,
      w.fetched_at
    FROM public.weather_alerts w
    CROSS JOIN LATERAL (
      -- SAME codes are "0" + the 5-digit FIPS. Marine zones match no county.
      SELECT array_agg(DISTINCT c.fips::text ORDER BY c.fips::text) AS fips
      FROM jsonb_array_elements_text(
        coalesce(w.raw -> 'properties' -> 'geocode' -> 'SAME', '[]'::jsonb)
      ) AS same(code)
      JOIN public.counties c ON c.fips = substr(same.code, 2, 5)
    ) f
    WHERE f.fips IS NOT NULL
      AND w.event IS NOT NULL
      AND w.sent IS NOT NULL
      AND w.sent >= now() - interval '365 days'
    ON CONFLICT (id) DO NOTHING;
  END IF;
END $$;

-- 3. The Lambda now only calls NWS --------------------------------------------------

DELETE FROM public.api_config WHERE name <> 'nws_alerts';

-- The Lambda's NWS request settings. NWS rejects requests without a User-Agent.
-- Query parameters default to status=actual&message_type=alert,update in the
-- Lambda; anything in default_params overrides them. Existing rows are left alone.
INSERT INTO public.api_config (name, base_url, default_params, headers)
VALUES (
  'nws_alerts',
  'https://api.weather.gov/alerts/active',
  '{}'::jsonb,
  '{"User-Agent": "UCSD-Risk-Resource-NotForProfit", "Accept": "application/geo+json"}'::jsonb
)
ON CONFLICT (name) DO NOTHING;


-- 4. Tables nothing writes or reads any more ------------------------------------------

DROP TABLE IF EXISTS public.weather_alerts;
DROP TABLE IF EXISTS public.earthquakes;
DROP TABLE IF EXISTS public.gauges;
DROP TABLE IF EXISTS public.weather_observations;
DROP TABLE IF EXISTS public.locations;

COMMIT;

-- Check afterwards:
--   SELECT count(*), min(sent), max(sent) FROM public.nws_alert_archive;
--   SELECT * FROM public.archive_settings;
--   SELECT name, enabled FROM public.api_config;
