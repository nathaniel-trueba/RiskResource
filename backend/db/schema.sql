-- The whole database schema. app/db.py runs this file only when one of the tables
-- below is missing, and every statement is a no-op for objects that already
-- exist, so it never touches existing tables or data.
--
-- Only the backend uses these tables, connecting as the postgres role, which
-- bypasses row level security. RLS is enabled with no policies so Supabase's
-- public Data API (anon and authenticated keys) can't read or write them.
--
-- To add a table: append a CREATE TABLE IF NOT EXISTS public.<name> statement
-- and its ENABLE ROW LEVEL SECURITY line. It's created on the next startup.


-- Reference data -------------------------------------------------------------
-- Static data the API loads at startup, seeded automatically when empty.

CREATE TABLE IF NOT EXISTS public.hazards (
  code  text PRIMARY KEY,  -- Matches app.domain.hazards.Hazard values, e.g. "severeStorm"
  label text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.states (
  code char(2) PRIMARY KEY,  -- Postal code, e.g. "CA"
  name text NOT NULL
);

CREATE TABLE IF NOT EXISTS public.counties (
  fips        char(5) PRIMARY KEY,
  state_code  char(2) NOT NULL REFERENCES public.states (code) ON DELETE CASCADE,
  name        text NOT NULL,  -- With suffix, e.g. "Riverside County"
  bare_name   text NOT NULL,  -- e.g. "Riverside"
  latitude    double precision NOT NULL,  -- Centroid of the largest polygon
  longitude   double precision NOT NULL,
  bbox_west   double precision NOT NULL,
  bbox_south  double precision NOT NULL,
  bbox_east   double precision NOT NULL,
  bbox_north  double precision NOT NULL,
  population  bigint
);
CREATE INDEX IF NOT EXISTS counties_state_code_idx ON public.counties (state_code);

-- One row per county and hazard. event_count is distinct FEMA declarations, or
-- nearby earthquakes for the earthquake hazard. baseline_score is the county's
-- percentile rank among counties that have had that hazard at all.
CREATE TABLE IF NOT EXISTS public.county_hazard_baselines (
  county_fips    char(5) NOT NULL REFERENCES public.counties (fips) ON DELETE CASCADE,
  hazard         text NOT NULL REFERENCES public.hazards (code) ON DELETE CASCADE,
  event_count    integer NOT NULL CHECK (event_count >= 0),
  baseline_score smallint NOT NULL CHECK (baseline_score BETWEEN 0 AND 100),
  PRIMARY KEY (county_fips, hazard)
);

-- Distinct FEMA declarations statewide. Earthquake has no row: its baseline
-- comes from the USGS catalog, per county.
CREATE TABLE IF NOT EXISTS public.state_hazard_declarations (
  state_code        char(2) NOT NULL REFERENCES public.states (code) ON DELETE CASCADE,
  hazard            text NOT NULL REFERENCES public.hazards (code) ON DELETE CASCADE,
  declaration_count integer NOT NULL CHECK (declaration_count >= 0),
  PRIMARY KEY (state_code, hazard)
);

-- A single row describing how the baseline was built. Its presence is what
-- marks the reference data as seeded.
CREATE TABLE IF NOT EXISTS public.reference_meta (
  id                  boolean PRIMARY KEY DEFAULT true CHECK (id),
  generated_at        timestamptz NOT NULL,
  seeded_at           timestamptz NOT NULL DEFAULT now(),
  baseline_since_year integer NOT NULL,
  quake_min_magnitude double precision NOT NULL,
  quake_radius_miles  double precision NOT NULL
);


-- Expected annual loss (FEMA National Risk Index) ---------------------------
-- Static data from the NRI, seeded with the reference data. Losses are dollars
-- per year from the 11 NRI hazards that match ours (see NRI_HAZARDS in
-- app/domain/hazards.py), including FEMA's dollar value for deaths and injuries.

-- A single row describing the NRI data.
CREATE TABLE IF NOT EXISTS public.nri_meta (
  id                     boolean PRIMARY KEY DEFAULT true CHECK (id),
  version                text NOT NULL,  -- e.g. "December 2025"
  high_loss_percentile   smallint NOT NULL CHECK (high_loss_percentile BETWEEN 0 AND 100),
  high_loss_per_person   double precision NOT NULL  -- Dollars per person per year at that percentile
);

-- Counties with NRI data. Connecticut's former counties have none: NRI reports
-- its planning regions instead.
CREATE TABLE IF NOT EXISTS public.nri_county_profiles (
  county_fips                 char(5) PRIMARY KEY REFERENCES public.counties (fips) ON DELETE CASCADE,
  population                  bigint NOT NULL CHECK (population >= 0),  -- NRI's population
  social_vulnerability        text,  -- NRI rating, e.g. "Relatively High". Null if unavailable
  community_resilience        text,
  loss_per_person_percentile  smallint CHECK (loss_per_person_percentile BETWEEN 0 AND 100)
);

CREATE TABLE IF NOT EXISTS public.nri_county_losses (
  county_fips           char(5) NOT NULL REFERENCES public.nri_county_profiles (county_fips) ON DELETE CASCADE,
  hazard                text NOT NULL REFERENCES public.hazards (code) ON DELETE CASCADE,
  expected_annual_loss  double precision NOT NULL CHECK (expected_annual_loss >= 0),
  PRIMARY KEY (county_fips, hazard)
);

-- States, computed from all of NRI's counties in the state, including
-- Connecticut's planning regions.
CREATE TABLE IF NOT EXISTS public.nri_state_profiles (
  state_code             char(2) PRIMARY KEY REFERENCES public.states (code) ON DELETE CASCADE,
  population             bigint NOT NULL CHECK (population >= 0),
  high_loss_population   bigint NOT NULL CHECK (high_loss_population >= 0)  -- Living in high-loss counties
);

CREATE TABLE IF NOT EXISTS public.nri_state_losses (
  state_code            char(2) NOT NULL REFERENCES public.nri_state_profiles (state_code) ON DELETE CASCADE,
  hazard                text NOT NULL REFERENCES public.hazards (code) ON DELETE CASCADE,
  expected_annual_loss  double precision NOT NULL CHECK (expected_annual_loss >= 0),
  PRIMARY KEY (state_code, hazard)
);


-- NWS alert archive -----------------------------------------------------------
-- Written by the AWS Lambda (aws/lambda_function.py) on a schedule. Two uses:
--   1. A history of NWS alerts per county, which NWS's API doesn't keep (it only
--      serves alerts that are active now).
--   2. A fallback for the API: if it can't reach NWS, it shows the alerts from
--      the Lambda's last run, labelled with that time (services/alert_archive.py).
-- Only alerts that cover at least one county are stored, without the raw
-- response, so a year fits comfortably in Supabase's free 500 MB.

-- Where the Lambda calls upstream APIs. Only the nws_alerts row is used.
CREATE TABLE IF NOT EXISTS public.api_config (
  name           text PRIMARY KEY,
  base_url       text NOT NULL,
  default_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  headers        jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled        boolean NOT NULL DEFAULT true,
  updated_at     timestamptz DEFAULT now()
);
-- NWS rejects requests without a User-Agent. Existing rows are left alone.
INSERT INTO public.api_config (name, base_url, default_params, headers)
VALUES (
  'nws_alerts',
  'https://api.weather.gov/alerts/active',
  '{}'::jsonb,
  '{"User-Agent": "UCSD-Risk-Resource-NotForProfit", "Accept": "application/geo+json"}'::jsonb
)
ON CONFLICT (name) DO NOTHING;

CREATE TABLE IF NOT EXISTS public.nws_alert_archive (
  id            text PRIMARY KEY,           -- NWS alert ID. Each update has its own ID
  event         text NOT NULL,              -- e.g. "Red Flag Warning"
  severity      text,                       -- Extreme, Severe, Moderate, Minor, Unknown
  urgency       text,
  certainty     text,
  message_type  text,                       -- Alert or Update
  headline      text,
  area_desc     text,                       -- NWS's plain-language list of areas
  county_fips   text[] NOT NULL CHECK (cardinality(county_fips) > 0),
  sent          timestamptz NOT NULL,       -- When NWS issued it. Retention is measured from this
  effective     timestamptz,
  expires       timestamptz,                -- When this message stops being current
  ends          timestamptz,                -- When the hazard itself is expected to end
  first_seen_at timestamptz NOT NULL,       -- First Lambda run that saw it
  last_seen_at  timestamptz NOT NULL        -- Latest Lambda run that saw it active
);
CREATE INDEX IF NOT EXISTS nws_alert_archive_sent_idx ON public.nws_alert_archive (sent);
CREATE INDEX IF NOT EXISTS nws_alert_archive_last_seen_idx ON public.nws_alert_archive (last_seen_at);
CREATE INDEX IF NOT EXISTS nws_alert_archive_county_idx ON public.nws_alert_archive USING gin (county_fips);

-- One row per archive. Edit retention_days in Supabase's Table Editor to change
-- how long alerts are kept; the Lambda deletes older ones at the end of each run.
-- last_run_at is the Lambda's last successful run, which the API's fallback uses
-- to tell "no alerts" from "the Lambda stopped".
CREATE TABLE IF NOT EXISTS public.archive_settings (
  table_name     text PRIMARY KEY,
  retention_days integer NOT NULL CHECK (retention_days BETWEEN 1 AND 3650),
  last_run_at    timestamptz,
  updated_at     timestamptz DEFAULT now()
);
INSERT INTO public.archive_settings (table_name, retention_days)
VALUES ('nws_alert_archive', 365)
ON CONFLICT (table_name) DO NOTHING;


-- Row level security (a no-op on tables that already have it) --------------------

ALTER TABLE public.hazards ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.states ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.counties ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.county_hazard_baselines ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.state_hazard_declarations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.reference_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nri_meta ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nri_county_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nri_county_losses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nri_state_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nri_state_losses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.api_config ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.nws_alert_archive ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.archive_settings ENABLE ROW LEVEL SECURITY;
