"""Builds the static reference data: counties, populations and hazard baselines.

Called by `python -m scripts.init_db --refresh`, which saves the result to
data/reference.json and reseeds the database. Building takes about a minute and
only needs re-running to refresh the baseline. The snapshot is committed so a new
database seeds in seconds without these slow upstream sources.
"""

import csv
import io
from collections import defaultdict
from datetime import UTC, datetime

import httpx
import numpy as np

from app.config import get_settings
from app.domain.geo import distance_to_boxes_miles
from app.domain.hazards import FEMA_INCIDENT_HAZARDS, NRI_HAZARDS, Hazard

BASELINE_SINCE_YEAR = 2006
QUAKE_MIN_MAGNITUDE = 4.5
QUAKE_RADIUS_MILES = 60

# FEMA's official National Risk Index county layer (ArcGIS feature service).
NRI_URL = (
    "https://services.arcgis.com/XG15cJAlne2vxtgt/arcgis/rest/services/"
    "National_Risk_Index_Counties/FeatureServer/0/query"
)
NRI_PAGE_SIZE = 2000  # The layer's maximum records per query
# A county is "high-loss" when its expected annual loss per person, from the
# hazards we track, is at or above this percentile among all NRI counties.
HIGH_LOSS_PERCENTILE = 80
# NRI uses current county codes. These map them onto the older codes in our county
# boundaries. Valdez-Cordova, Alaska, split into two areas in 2019, so both of its
# successors map to it and their losses and populations are added together.
NRI_TO_OUR_FIPS = {
    "02158": "02270",  # Kusilvak, formerly Wade Hampton
    "46102": "46113",  # Oglala Lakota, formerly Shannon
    "02063": "02261",  # Chugach, part of the former Valdez-Cordova
    "02066": "02261",  # Copper River, part of the former Valdez-Cordova
}
# Connecticut's NRI data is by planning region (codes 09110 to 09190), which don't
# line up with its 8 former counties. Those regions count toward the state's
# figures, and Connecticut's counties have no county-level loss data.

COUNTIES_GEOJSON_URL = (
    "https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json"
)
FEMA_URL = "https://www.fema.gov/api/open/v2/DisasterDeclarationsSummaries"
FEMA_PAGE_SIZE = 10000
USGS_URL = "https://earthquake.usgs.gov/fdsnws/event/1/query"
CENSUS_URLS = (
    # The newest file first. The older one fills in codes the newer one dropped.
    (
        "https://www2.census.gov/programs-surveys/popest/datasets/2020-2021/counties/totals/co-est2021-alldata.csv",
        "POPESTIMATE2021",
    ),
    (
        "https://www2.census.gov/programs-surveys/popest/datasets/2010-2019/counties/totals/co-est2019-alldata.csv",
        "POPESTIMATE2019",
    ),
)

# The GeoJSON still uses these retired codes for renamed counties.
FIPS_RENAMES = {
    "02270": "02158",  # Wade Hampton is now Kusilvak Census Area, Alaska
    "46113": "46102",  # Shannon is now Oglala Lakota County, South Dakota
}

LSAD_SUFFIXES = {
    "County": "County",
    "Parish": "Parish",
    "Borough": "Borough",
    "CA": "Census Area",
    "Cty&Bor": "City and Borough",
    "Muny": "Municipality",
    "Muno": "Municipio",
    "city": "city",
}

# State FIPS to (postal code, name). The frontend's map covers these 50 states,
# and its county layer also includes DC and Puerto Rico.
STATES = {
    "01": ("AL", "Alabama"), "02": ("AK", "Alaska"), "04": ("AZ", "Arizona"),
    "05": ("AR", "Arkansas"), "06": ("CA", "California"), "08": ("CO", "Colorado"),
    "09": ("CT", "Connecticut"), "10": ("DE", "Delaware"),
    "11": ("DC", "District of Columbia"), "12": ("FL", "Florida"), "13": ("GA", "Georgia"),
    "15": ("HI", "Hawaii"), "16": ("ID", "Idaho"), "17": ("IL", "Illinois"),
    "18": ("IN", "Indiana"), "19": ("IA", "Iowa"), "20": ("KS", "Kansas"),
    "21": ("KY", "Kentucky"), "22": ("LA", "Louisiana"), "23": ("ME", "Maine"),
    "24": ("MD", "Maryland"), "25": ("MA", "Massachusetts"), "26": ("MI", "Michigan"),
    "27": ("MN", "Minnesota"), "28": ("MS", "Mississippi"), "29": ("MO", "Missouri"),
    "30": ("MT", "Montana"), "31": ("NE", "Nebraska"), "32": ("NV", "Nevada"),
    "33": ("NH", "New Hampshire"), "34": ("NJ", "New Jersey"), "35": ("NM", "New Mexico"),
    "36": ("NY", "New York"), "37": ("NC", "North Carolina"), "38": ("ND", "North Dakota"),
    "39": ("OH", "Ohio"), "40": ("OK", "Oklahoma"), "41": ("OR", "Oregon"),
    "42": ("PA", "Pennsylvania"), "44": ("RI", "Rhode Island"), "45": ("SC", "South Carolina"),
    "46": ("SD", "South Dakota"), "47": ("TN", "Tennessee"), "48": ("TX", "Texas"),
    "49": ("UT", "Utah"), "50": ("VT", "Vermont"), "51": ("VA", "Virginia"),
    "53": ("WA", "Washington"), "54": ("WV", "West Virginia"), "55": ("WI", "Wisconsin"),
    "56": ("WY", "Wyoming"), "72": ("PR", "Puerto Rico"),
}


def build() -> dict:
    """Fetch every source and compute the reference data.

    Returns:
        Data in the reference.json format: {"meta": ..., "states": ..., "counties": ...}.
    Raises:
        httpx.HTTPError: If any source fails.
    Called by: scripts/init_db.main (--refresh), app/services/reference_refresh.py.
    """
    settings = get_settings()
    with httpx.Client(headers={"User-Agent": settings.user_agent}, timeout=120) as http:
        print("Fetching county boundaries...")
        counties = load_counties(http)
        print(f"  {len(counties)} counties")

        print("Fetching population estimates...")
        populations = load_populations(http)
        for fips, county in counties.items():
            county["population"] = populations.get(FIPS_RENAMES.get(fips, fips))
        missing = sorted(f for f, c in counties.items() if c["population"] is None)
        print(f"  no population for {len(missing)} counties ({missing[:3]}...)")

        print("Fetching FEMA declarations...")
        county_counts, state_counts = load_declarations(http, counties)

        print("Fetching USGS earthquake history...")
        quake_counts = load_quake_counts(http, counties)

        print("Fetching FEMA National Risk Index...")
        nri = load_nri(http, counties)

    for fips, county in counties.items():
        counts = {hazard.value: 0 for hazard in Hazard}
        for hazard, number in county_counts[fips].items():
            counts[hazard.value] = number
        counts[Hazard.EARTHQUAKE.value] = quake_counts[fips]
        county["counts"] = counts

    add_percentile_scores(counties)

    states = {
        code: {
            "name": name,
            "declarations": {
                hazard.value: state_counts[code][hazard]
                for hazard in Hazard
                if hazard is not Hazard.EARTHQUAKE
            },
        }
        for code, name in STATES.values()
    }
    return {
        "meta": {
            "generatedAt": datetime.now(UTC).isoformat(timespec="seconds"),
            "baselineSinceYear": BASELINE_SINCE_YEAR,
            "quakeMinMagnitude": QUAKE_MIN_MAGNITUDE,
            "quakeRadiusMiles": QUAKE_RADIUS_MILES,
        },
        "states": states,
        "counties": counties,
        "nri": nri,
    }


def load_counties(http: httpx.Client) -> dict[str, dict]:
    """Download county boundaries and derive each county's name, centroid and bbox.

    Args:
        http: Sync HTTP client.
    Returns:
        Raw county entries by FIPS, without population or hazard data yet.
    Called by: build.
    """
    response = http.get(COUNTIES_GEOJSON_URL)
    response.raise_for_status()
    counties = {}
    for feature in response.json()["features"]:
        properties = feature["properties"]
        code, state_name = STATES[properties["STATE"]]
        suffix = LSAD_SUFFIXES.get(properties["LSAD"], "")
        west, south, east, north, latitude, longitude = polygon_stats(feature["geometry"])
        counties[feature["id"]] = {
            "name": f"{properties['NAME']} {suffix}".strip(),
            "bareName": properties["NAME"],
            "state": code,
            "lat": round(latitude, 4),
            "lon": round(longitude, 4),
            "bbox": [round(west, 4), round(south, 4), round(east, 4), round(north, 4)],
        }
    return counties


def polygon_stats(geometry: dict) -> tuple[float, float, float, float, float, float]:
    """Return the bounding box and centroid of a county's largest polygon.

    Using the largest polygon keeps islands, such as Alaska's Aleutians crossing
    the 180th meridian, from stretching the box around the whole planet.

    Args:
        geometry: A GeoJSON Polygon or MultiPolygon.
    Returns:
        (west, south, east, north, centroid latitude, centroid longitude).
    Called by: load_counties.
    """
    if geometry["type"] == "Polygon":
        rings = [geometry["coordinates"][0]]
    else:
        rings = [polygon[0] for polygon in geometry["coordinates"]]
    largest = max((np.array(ring, dtype=float) for ring in rings), key=lambda r: abs(_area(r)))
    x, y = largest[:, 0], largest[:, 1]

    area = _area(largest)
    if area == 0:
        centroid_x, centroid_y = float(x.mean()), float(y.mean())
    else:
        cross = x[:-1] * y[1:] - x[1:] * y[:-1]
        centroid_x = float(((x[:-1] + x[1:]) * cross).sum() / (6 * area))
        centroid_y = float(((y[:-1] + y[1:]) * cross).sum() / (6 * area))
    return float(x.min()), float(y.min()), float(x.max()), float(y.max()), centroid_y, centroid_x


def _area(ring: np.ndarray) -> float:
    """Return a polygon ring's signed area (shoelace formula), in square degrees.

    Args:
        ring: Array of (longitude, latitude) points, closed.
    Returns:
        The signed area. Its sign depends on the winding direction.
    Called by: polygon_stats.
    """
    x, y = ring[:, 0], ring[:, 1]
    return float((x[:-1] * y[1:] - x[1:] * y[:-1]).sum() / 2)


def load_populations(http: httpx.Client) -> dict[str, int]:
    """Download Census county population estimates.

    Args:
        http: Sync HTTP client.
    Returns:
        Population by FIPS, preferring the newest file.
    Called by: build.
    """
    populations: dict[str, int] = {}
    for url, column in CENSUS_URLS:
        response = http.get(url)
        response.raise_for_status()
        for row in csv.DictReader(io.StringIO(response.content.decode("latin-1"))):
            if row["SUMLEV"] == "050":
                populations.setdefault(row["STATE"] + row["COUNTY"], int(row[column]))
    return populations


def load_declarations(
    http: httpx.Client, counties: dict[str, dict]
) -> tuple[dict[str, dict[Hazard, int]], dict[str, dict[Hazard, int]]]:
    """Count distinct disasters per county and state.

    FEMA's data has one row per designated area. A "Statewide" area counts for
    every county in that state. County code 000 alone doesn't mean statewide: it's
    mostly used for tribal lands. Emergency declarations (EM) are left out because
    many cover other states' evacuees rather than local damage.

    Args:
        http: Sync HTTP client.
        counties: Raw county entries by FIPS.
    Returns:
        (declaration counts per county and hazard, declaration counts per state and hazard).
    Called by: build.
    """
    rows = fetch_fema_rows(http)
    print(f"  {len(rows)} rows")

    counties_by_state: dict[str, list[str]] = defaultdict(list)
    for fips, county in counties.items():
        counties_by_state[county["state"]].append(fips)
    new_to_old = {new: old for old, new in FIPS_RENAMES.items()}

    county_disasters: dict[str, dict[Hazard, set[int]]] = defaultdict(lambda: defaultdict(set))
    state_disasters: dict[str, dict[Hazard, set[int]]] = defaultdict(lambda: defaultdict(set))
    for row in rows:
        hazard = FEMA_INCIDENT_HAZARDS.get(row["incidentType"])
        state = STATES.get(row["fipsStateCode"].zfill(2))
        if hazard is None or state is None or row["declarationType"] == "EM":
            continue
        code = state[0]
        number = row["disasterNumber"]
        state_disasters[code][hazard].add(number)

        county_code = row["fipsCountyCode"].zfill(3)
        if row["designatedArea"] == "Statewide":
            targets = counties_by_state[code]
        elif county_code == "000":
            targets = []  # A tribal area, which counts for the state but no specific county
        else:
            fips = row["fipsStateCode"].zfill(2) + county_code
            targets = [new_to_old.get(fips, fips)]
        for target in targets:
            if target in counties:
                county_disasters[target][hazard].add(number)

    return _count_sets(county_disasters, counties), _count_sets(
        state_disasters, {code: None for code, _ in STATES.values()}
    )


def _count_sets(sets_by_area: dict, areas: dict) -> dict[str, dict[Hazard, int]]:
    """Turn sets of disaster numbers into counts, filling 0 for missing areas.

    Args:
        sets_by_area: Disaster numbers by area and hazard.
        areas: Every area to include (only the keys are used).
    Returns:
        Count per area and hazard.
    Called by: load_declarations.
    """
    return {
        area: {hazard: len(sets_by_area[area][hazard]) for hazard in Hazard}
        for area in areas
    }


def fetch_fema_rows(http: httpx.Client) -> list[dict]:
    """Download every FEMA declaration row since BASELINE_SINCE_YEAR, page by page.

    Args:
        http: Sync HTTP client.
    Returns:
        The raw rows, with only the fields load_declarations uses.
    Called by: load_declarations.
    """
    rows: list[dict] = []
    while True:
        response = http.get(
            FEMA_URL,
            params={
                "$select": (
                    "disasterNumber,fipsStateCode,fipsCountyCode,designatedArea,"
                    "incidentType,declarationType"
                ),
                "$filter": f"declarationDate ge '{BASELINE_SINCE_YEAR}-01-01T00:00:00.000Z'",
                "$orderby": "id",
                "$top": FEMA_PAGE_SIZE,
                "$skip": len(rows),
            },
        )
        response.raise_for_status()
        page = response.json()["DisasterDeclarationsSummaries"]
        rows.extend(page)
        if len(page) < FEMA_PAGE_SIZE:
            return rows


def load_quake_counts(http: httpx.Client, counties: dict[str, dict]) -> dict[str, int]:
    """Count M4.5+ earthquakes within QUAKE_RADIUS_MILES of each county since 2006.

    Args:
        http: Sync HTTP client.
        counties: Raw county entries by FIPS, with bboxes.
    Returns:
        Earthquake count by FIPS.
    Called by: build.
    """
    response = http.get(
        USGS_URL,
        params={
            "format": "geojson",
            "eventtype": "earthquake",
            "starttime": f"{BASELINE_SINCE_YEAR}-01-01",
            "minmagnitude": QUAKE_MIN_MAGNITUDE,
            # A box around the US, including Alaska, Hawaii and Puerto Rico
            "minlatitude": 17,
            "maxlatitude": 72,
            "minlongitude": -180,
            "maxlongitude": -64,
        },
    )
    response.raise_for_status()
    coordinates = np.array(
        [f["geometry"]["coordinates"][:2] for f in response.json()["features"]], dtype=float
    )
    print(f"  {len(coordinates)} earthquakes")

    fips_list = list(counties)
    boxes = np.array([counties[f]["bbox"] for f in fips_list])
    totals = np.zeros(len(fips_list), dtype=int)
    for longitude, latitude in coordinates:
        totals += distance_to_boxes_miles(boxes, latitude, longitude) <= QUAKE_RADIUS_MILES
    return {fips: int(total) for fips, total in zip(fips_list, totals, strict=True)}


def load_nri(http: httpx.Client, counties: dict[str, dict]) -> dict:
    """Build expected annual loss data for counties and states from the NRI.

    Only the NRI hazards in NRI_HAZARDS count toward losses. NRI's expected annual
    loss is in dollars per year and covers building, agriculture and population
    losses, where population losses are deaths and injuries at FEMA's dollar value.

    Args:
        http: Sync HTTP client.
        counties: Raw county entries by FIPS, to match NRI counties against.
    Returns:
        {"meta": ..., "counties": {fips: profile}, "states": {code: profile}}, where a
        profile has "population" and "losses" (dollars per hazard), plus county
        ratings and percentile, or state high-loss population.
    Called by: build.
    """
    rows = fetch_nri_rows(http)
    our_states = {code for code, _ in STATES.values()}
    rows = [r for r in rows if r["STATEABBRV"] in our_states]  # Drops other territories
    print(f"  {len(rows)} NRI counties, version {rows[0]['NRI_VER']}")

    def tracked_losses(row: dict) -> dict[str, float]:
        """Sum one NRI row's per-hazard losses into our hazards.

        Args:
            row: One NRI county row.
        Returns:
            Dollars per year by hazard value, 0 where NRI has none.
        Called by: load_nri.
        """
        losses = {hazard.value: 0.0 for hazard in set(NRI_HAZARDS.values())}
        for code, hazard in NRI_HAZARDS.items():
            losses[hazard.value] += row[f"{code}_EALT"] or 0.0  # Null: hazard doesn't apply
        return losses

    # Percentiles and the high-loss threshold use NRI's own counties, so they don't
    # depend on how we map NRI codes onto our older county codes.
    per_person = np.array(
        [sum(tracked_losses(r).values()) / r["POPULATION"] for r in rows if r["POPULATION"]]
    )
    threshold = float(np.percentile(per_person, HIGH_LOSS_PERCENTILE))
    ranked = np.sort(per_person)

    def percentile_of(value: float) -> int:
        """Rank a loss per person among NRI counties. Ties take the middle of their range.

        Args:
            value: Dollars per person per year.
        Returns:
            The percentile, 0 to 100.
        Called by: load_nri.
        """
        lower = np.searchsorted(ranked, value, side="left")
        upper = np.searchsorted(ranked, value, side="right")
        return int(round(100 * (lower + upper) / 2 / len(ranked)))

    county_profiles: dict[str, dict] = {}
    state_profiles: dict[str, dict] = {
        code: {"population": 0, "highLossPopulation": 0, "losses": defaultdict(float)}
        for code in our_states
    }
    for row in rows:
        losses = tracked_losses(row)
        population = row["POPULATION"] or 0
        state = state_profiles[row["STATEABBRV"]]
        state["population"] += population
        if population and sum(losses.values()) / population >= threshold:
            state["highLossPopulation"] += population
        for hazard, amount in losses.items():
            state["losses"][hazard] += amount

        fips = NRI_TO_OUR_FIPS.get(row["STCOFIPS"], row["STCOFIPS"])
        if fips not in counties:
            continue  # A Connecticut planning region, or a county merged into another
        profile = county_profiles.setdefault(
            fips, {"population": 0, "losses": defaultdict(float), "sources": 0}
        )
        profile["population"] += population
        profile["sources"] += 1
        for hazard, amount in losses.items():
            profile["losses"][hazard] += amount
        profile["socialVulnerability"] = _rating(row["SOVI_RATNG"])
        profile["communityResilience"] = _rating(row["RESL_RATNG"])

    for profile in county_profiles.values():
        if profile.pop("sources") > 1:
            # Ratings are relative scores that can't be combined across merged areas.
            profile["socialVulnerability"] = profile["communityResilience"] = None
        total = sum(profile["losses"].values())
        profile["lossPerPersonPercentile"] = (
            percentile_of(total / profile["population"]) if profile["population"] else None
        )
        profile["losses"] = {h: round(v, 2) for h, v in profile["losses"].items()}
    for state in state_profiles.values():
        state["losses"] = {h: round(v, 2) for h, v in state["losses"].items()}

    missing = sorted(set(counties) - set(county_profiles))
    print(f"  no NRI county data for {len(missing)} counties: {missing}")
    return {
        "meta": {
            "version": rows[0]["NRI_VER"],
            "highLossPercentile": HIGH_LOSS_PERCENTILE,
            "highLossPerPersonThreshold": round(threshold, 2),
        },
        "counties": county_profiles,
        "states": state_profiles,
    }


def _rating(value: str | None) -> str | None:
    """Return an NRI rating, or None for "Data Unavailable" and similar.

    Args:
        value: An NRI *_RATNG field, e.g. "Relatively High".
    Returns:
        The rating, or None when NRI has none.
    Called by: load_nri.
    """
    if not value or value in ("Data Unavailable", "Not Applicable", "Insufficient Data"):
        return None
    return value


def fetch_nri_rows(http: httpx.Client) -> list[dict]:
    """Download every county row from the NRI feature service, page by page.

    Args:
        http: Sync HTTP client.
    Returns:
        One dict per NRI county, with only the fields load_nri uses.
    Raises:
        httpx.HTTPError: On a failed request.
        RuntimeError: If the service reports an error.
    Called by: load_nri.
    """
    fields = [
        "STCOFIPS", "STATEABBRV", "POPULATION", "NRI_VER", "SOVI_RATNG", "RESL_RATNG",
        *(f"{code}_EALT" for code in NRI_HAZARDS),
    ]
    rows: list[dict] = []
    while True:
        response = http.get(
            NRI_URL,
            params={
                "where": "1=1",
                "outFields": ",".join(fields),
                "returnGeometry": "false",
                "orderByFields": "OBJECTID",
                "resultOffset": len(rows),
                "resultRecordCount": NRI_PAGE_SIZE,
                "f": "json",
            },
        )
        response.raise_for_status()
        page = response.json()
        if "error" in page:  # ArcGIS reports errors with HTTP 200
            raise RuntimeError(f"NRI query failed: {page['error']}")
        rows.extend(feature["attributes"] for feature in page["features"])
        if not page.get("exceededTransferLimit"):
            return rows


def add_percentile_scores(counties: dict[str, dict]) -> None:
    """Score each hazard by percentile rank among counties that have had it at all.

    A county with no events scores 0. Excluding those counties from the ranking
    matters for rare hazards: 93% of counties have no tornado declarations, so
    ranking against all counties would put a single declaration at the 93rd
    percentile. Ties take the middle of their range.

    Args:
        counties: Raw county entries by FIPS, with "counts". Each gets a
            "baseline" dict of scores, in place.
    Returns:
        None.
    Called by: build.
    """
    fips_list = list(counties)
    for county in counties.values():
        county["baseline"] = {}
    for hazard in Hazard:
        counts = np.array([counties[f]["counts"][hazard.value] for f in fips_list])
        affected = np.sort(counts[counts > 0])
        lower = np.searchsorted(affected, counts, side="left")
        upper = np.searchsorted(affected, counts, side="right")
        ranks = 100 * (lower + upper) / 2 / max(len(affected), 1)
        scores = np.where(counts > 0, np.round(ranks), 0).astype(int)
        for fips, score in zip(fips_list, scores, strict=True):
            counties[fips]["baseline"][hazard.value] = int(score)

