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


-- Upstream API cache -----------------------------------------------------------
-- Tables for storing live upstream responses. The API doesn't use them yet: live
-- feeds are cached in memory (app/core/cache.py).

CREATE TABLE IF NOT EXISTS public.api_config (
  name           text PRIMARY KEY,
  base_url       text NOT NULL,
  default_params jsonb NOT NULL DEFAULT '{}'::jsonb,
  headers        jsonb NOT NULL DEFAULT '{}'::jsonb,
  enabled        boolean NOT NULL DEFAULT true,
  updated_at     timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.locations (
  id         bigint PRIMARY KEY,
  name       text NOT NULL,
  country    text,
  admin1     text,
  latitude   double precision NOT NULL,
  longitude  double precision NOT NULL,
  timezone   text,
  population bigint,
  fetched_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.weather_observations (
  location_id    bigint NOT NULL REFERENCES public.locations (id),
  observed_at    timestamptz NOT NULL,
  temperature_2m double precision,
  wind_speed_10m double precision,
  fetched_at     timestamptz DEFAULT now(),
  PRIMARY KEY (location_id, observed_at)
);

CREATE TABLE IF NOT EXISTS public.earthquakes (
  id         text PRIMARY KEY,
  magnitude  double precision,
  place      text,
  event_time timestamptz,
  updated_at timestamptz,
  latitude   double precision,
  longitude  double precision,
  depth_km   double precision,
  tsunami    boolean,
  url        text,
  raw        jsonb,
  fetched_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.weather_alerts (
  id          text PRIMARY KEY,
  event       text,
  severity    text,
  urgency     text,
  certainty   text,
  status      text,
  headline    text,
  description text,
  area_desc   text,
  sent        timestamptz,
  effective   timestamptz,
  expires     timestamptz,
  raw         jsonb,
  fetched_at  timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.gauges (
  lid        text PRIMARY KEY,
  name       text,
  state      text,
  latitude   double precision,
  longitude  double precision,
  raw        jsonb,
  fetched_at timestamptz DEFAULT now()
);


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
ALTER TABLE public.locations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weather_observations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.earthquakes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.weather_alerts ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.gauges ENABLE ROW LEVEL SECURITY;
