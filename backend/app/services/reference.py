"""Loads the static reference data from the database, seeded by app/db.py."""

from collections import defaultdict
from dataclasses import dataclass

import psycopg

from app.domain.hazards import Hazard


@dataclass(frozen=True)
class County:
    fips: str
    name: str  # Includes the suffix, e.g. "Riverside County"
    bare_name: str  # e.g. "Riverside"
    state_code: str
    latitude: float
    longitude: float
    bbox: tuple[float, float, float, float]  # (west, south, east, north)
    population: int | None
    baseline_scores: dict[Hazard, int]  # Percentile rank among counties, 0 to 100
    baseline_counts: dict[Hazard, int]  # Declarations, or nearby quakes for earthquake


@dataclass(frozen=True)
class State:
    code: str
    name: str
    county_fips: tuple[str, ...]
    population: int | None
    declarations: dict[Hazard, int]  # Distinct declarations statewide
    max_quake_count: int  # Highest county earthquake count in this state


@dataclass(frozen=True)
class CountyLosses:
    """A county's expected annual loss from the FEMA National Risk Index."""

    population: int  # NRI's population, which its per-person figures use
    by_hazard: dict[Hazard, float]  # Dollars per year, tracked NRI hazards only
    loss_per_person_percentile: int | None  # Rank among all NRI counties, 0 to 100
    social_vulnerability: str | None  # NRI rating, e.g. "Relatively High"
    community_resilience: str | None

    @property
    def total(self) -> float:
        """Return the expected annual loss summed over hazards, in dollars per year."""
        return sum(self.by_hazard.values())

    @property
    def per_person(self) -> float | None:
        """Return the total divided by population, or None if population is 0."""
        return self.total / self.population if self.population else None


@dataclass(frozen=True)
class StateLosses:
    """A state's expected annual loss, from every NRI county in the state."""

    population: int
    high_loss_population: int  # Residents of counties at or above the high-loss threshold
    by_hazard: dict[Hazard, float]

    @property
    def total(self) -> float:
        """Return the expected annual loss summed over hazards, in dollars per year."""
        return sum(self.by_hazard.values())

    @property
    def per_person(self) -> float | None:
        """Return the total divided by population, or None if population is 0."""
        return self.total / self.population if self.population else None

    @property
    def high_loss_pct(self) -> float | None:
        """Return the percent of residents living in high-loss counties."""
        return 100 * self.high_loss_population / self.population if self.population else None


class ReferenceNotSeededError(RuntimeError):
    pass


class ReferenceData:
    def __init__(self, raw: dict) -> None:
        """Parse raw reference data into County and State objects.

        Args:
            raw: Data in the reference.json format, as load_raw returns.
        Called by: ReferenceData.from_database.
        """
        self.meta: dict = raw["meta"]
        self.counties: dict[str, County] = {
            fips: _parse_county(fips, county) for fips, county in raw["counties"].items()
        }
        self.states: dict[str, State] = {
            code: self._build_state(code, state) for code, state in raw["states"].items()
        }
        nri = raw["nri"]
        # {"version", "highLossPercentile", "highLossPerPersonThreshold"}
        self.nri_meta: dict = nri["meta"]
        # Counties and states without NRI data (e.g. Connecticut's counties) are absent.
        self.county_losses: dict[str, CountyLosses] = {
            fips: CountyLosses(
                population=c["population"],
                by_hazard={Hazard(h): v for h, v in c["losses"].items()},
                loss_per_person_percentile=c["lossPerPersonPercentile"],
                social_vulnerability=c["socialVulnerability"],
                community_resilience=c["communityResilience"],
            )
            for fips, c in nri["counties"].items()
        }
        self.state_losses: dict[str, StateLosses] = {
            code: StateLosses(
                population=s["population"],
                high_loss_population=s["highLossPopulation"],
                by_hazard={Hazard(h): v for h, v in s["losses"].items()},
            )
            for code, s in nri["states"].items()
        }

    @classmethod
    def from_database(cls, conn: psycopg.Connection) -> "ReferenceData":
        """Load the reference data from the seeded database tables.

        Args:
            conn: Open connection.
        Returns:
            The parsed ReferenceData.
        Raises:
            ReferenceNotSeededError: If the tables are empty.
        Called by: main.lifespan (load_reference).
        """
        return cls(load_raw(conn))

    def _build_state(self, code: str, raw: dict) -> State:
        """Build a State, deriving its counties, population and max quake count.

        Args:
            code: Two-letter state code.
            raw: The state's entry in the raw "states" data.
        Returns:
            The State. Expects self.counties to be loaded already.
        Called by: ReferenceData.__init__.
        """
        counties = [c for c in self.counties.values() if c.state_code == code]
        populations = [c.population for c in counties if c.population is not None]
        return State(
            code=code,
            name=raw["name"],
            county_fips=tuple(c.fips for c in counties),
            population=sum(populations) if populations else None,
            declarations={Hazard(k): v for k, v in raw["declarations"].items()},
            max_quake_count=max(
                (c.baseline_counts[Hazard.EARTHQUAKE] for c in counties), default=0
            ),
        )


def load_raw(conn: psycopg.Connection) -> dict:
    """Read the seeded tables into the reference.json format.

    Args:
        conn: Open connection.
    Returns:
        {"meta": ..., "states": ..., "counties": ..., "nri": ...}, with counties in FIPS order.
    Raises:
        ReferenceNotSeededError: If reference_meta is empty.
    Called by: ReferenceData.from_database.
    """
    with conn.cursor() as cur:
        cur.execute(
            "SELECT generated_at, baseline_since_year, quake_min_magnitude, quake_radius_miles"
            " FROM public.reference_meta"
        )
        meta_row = cur.fetchone()
        if meta_row is None:
            raise ReferenceNotSeededError(
                "The reference tables are empty. Seed them with: python -m scripts.init_db --reseed"
            )
        generated_at, since, magnitude, radius = meta_row

        states: dict[str, dict] = {}
        cur.execute("SELECT code, name FROM public.states")
        for code, name in cur:
            states[code] = {"name": name, "declarations": {}}
        cur.execute(
            "SELECT state_code, hazard, declaration_count FROM public.state_hazard_declarations"
        )
        for code, hazard, count in cur:
            states[code]["declarations"][hazard] = count

        counts: dict[str, dict[str, int]] = defaultdict(dict)
        scores: dict[str, dict[str, int]] = defaultdict(dict)
        cur.execute(
            "SELECT county_fips, hazard, event_count, baseline_score"
            " FROM public.county_hazard_baselines"
        )
        for fips, hazard, count, score in cur:
            counts[fips][hazard] = count
            scores[fips][hazard] = score

        counties: dict[str, dict] = {}
        cur.execute(
            "SELECT fips, state_code, name, bare_name, latitude, longitude,"
            " bbox_west, bbox_south, bbox_east, bbox_north, population"
            " FROM public.counties ORDER BY fips"
        )
        for fips, state, name, bare, lat, lon, west, south, east, north, population in cur:
            counties[fips] = {
                "name": name,
                "bareName": bare,
                "state": state,
                "lat": lat,
                "lon": lon,
                "bbox": [west, south, east, north],
                "population": population,
                "counts": counts[fips],
                "baseline": scores[fips],
            }

        nri = _load_nri(cur)

    return {
        "meta": {
            "generatedAt": generated_at.isoformat(timespec="seconds"),
            "baselineSinceYear": since,
            # Whole numbers print without ".0" in the baseline text, e.g. "within 60 mi".
            "quakeMinMagnitude": _number(magnitude),
            "quakeRadiusMiles": _number(radius),
        },
        "states": states,
        "counties": counties,
        "nri": nri,
    }


def _load_nri(cur: psycopg.Cursor) -> dict:
    """Read the NRI expected loss tables into the reference.json "nri" format.

    Args:
        cur: Cursor on an open connection.
    Returns:
        {"meta": ..., "counties": {fips: profile}, "states": {code: profile}}.
    Called by: load_raw.
    """
    cur.execute("SELECT version, high_loss_percentile, high_loss_per_person FROM public.nri_meta")
    version, percentile, threshold = cur.fetchone()

    counties: dict[str, dict] = {}
    cur.execute(
        "SELECT county_fips, population, social_vulnerability, community_resilience,"
        " loss_per_person_percentile FROM public.nri_county_profiles"
    )
    for fips, population, vulnerability, resilience, loss_percentile in cur:
        counties[fips] = {
            "population": population,
            "socialVulnerability": vulnerability,
            "communityResilience": resilience,
            "lossPerPersonPercentile": loss_percentile,
            "losses": {},
        }
    cur.execute("SELECT county_fips, hazard, expected_annual_loss FROM public.nri_county_losses")
    for fips, hazard, amount in cur:
        counties[fips]["losses"][hazard] = amount

    states: dict[str, dict] = {}
    cur.execute("SELECT state_code, population, high_loss_population FROM public.nri_state_profiles")
    for code, population, high_loss in cur:
        states[code] = {"population": population, "highLossPopulation": high_loss, "losses": {}}
    cur.execute("SELECT state_code, hazard, expected_annual_loss FROM public.nri_state_losses")
    for code, hazard, amount in cur:
        states[code]["losses"][hazard] = amount

    return {
        "meta": {
            "version": version,
            "highLossPercentile": percentile,
            "highLossPerPersonThreshold": threshold,
        },
        "counties": counties,
        "states": states,
    }


def _number(value: float) -> float | int:
    """Return a whole-number float as an int, so text shows "60" rather than "60.0".

    Args:
        value: A number read from a double precision column.
    Returns:
        int if the value is whole, else the value unchanged.
    Called by: load_raw.
    """
    return int(value) if float(value).is_integer() else value


def _parse_county(fips: str, raw: dict) -> County:
    """Convert one raw county entry into a County.

    Args:
        fips: Five-digit county FIPS code.
        raw: The county's entry in the raw "counties" data.
    Returns:
        The County.
    Called by: ReferenceData.__init__.
    """
    return County(
        fips=fips,
        name=raw["name"],
        bare_name=raw["bareName"],
        state_code=raw["state"],
        latitude=raw["lat"],
        longitude=raw["lon"],
        bbox=tuple(raw["bbox"]),
        population=raw["population"],
        baseline_scores={Hazard(k): v for k, v in raw["baseline"].items()},
        baseline_counts={Hazard(k): v for k, v in raw["counts"].items()},
    )
