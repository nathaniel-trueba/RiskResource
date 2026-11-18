"""The hazard vocabulary and the tables that map source data onto it.

To change which alerts or FEMA incident types count toward a hazard, edit the
tables here. Nothing else needs to change.
"""

from enum import StrEnum


class Hazard(StrEnum):
    WILDFIRE = "wildfire"
    EARTHQUAKE = "earthquake"
    FLOOD = "flood"
    SEVERE_STORM = "severeStorm"
    HURRICANE = "hurricane"
    TORNADO = "tornado"

    @property
    def label(self) -> str:
        """Return the hazard's display name, e.g. "Severe Storm".

        Returns:
            The human-readable label.
        Called by: general utility, wherever a hazard is shown or seeded.
        """
        return _LABELS[self]


_LABELS = {
    Hazard.WILDFIRE: "Wildfire",
    Hazard.EARTHQUAKE: "Earthquake",
    Hazard.FLOOD: "Flood",
    Hazard.SEVERE_STORM: "Severe Storm",
    Hazard.HURRICANE: "Hurricane",
    Hazard.TORNADO: "Tornado",
}

# OpenFEMA `incidentType` to hazard. Used only by scripts/build_reference_data.py.
# Earthquake is absent on purpose: its baseline comes from the USGS catalog, since
# FEMA has too few earthquake declarations to rank counties. Types not listed here,
# such as "Biological" (COVID-19), don't count toward any hazard.
FEMA_INCIDENT_HAZARDS = {
    "Fire": Hazard.WILDFIRE,
    "Flood": Hazard.FLOOD,
    "Dam/Levee Break": Hazard.FLOOD,
    "Mud/Landslide": Hazard.FLOOD,
    "Coastal Storm": Hazard.FLOOD,
    "Severe Storm": Hazard.SEVERE_STORM,
    "Straight-Line Winds": Hazard.SEVERE_STORM,
    "Winter Storm": Hazard.SEVERE_STORM,
    "Severe Ice Storm": Hazard.SEVERE_STORM,
    "Snowstorm": Hazard.SEVERE_STORM,
    "Hurricane": Hazard.HURRICANE,
    "Typhoon": Hazard.HURRICANE,
    "Tropical Storm": Hazard.HURRICANE,
    "Tropical Depression": Hazard.HURRICANE,
    "Tornado": Hazard.TORNADO,
}

# FEMA National Risk Index hazard code to hazard, for expected annual loss. Used only
# by scripts/build_reference_data.py. NRI models 18 hazards; these 11 match ours.
NRI_HAZARDS = {
    "WFIR": Hazard.WILDFIRE,
    "ERQK": Hazard.EARTHQUAKE,
    "IFLD": Hazard.FLOOD,  # Inland flooding
    "CFLD": Hazard.FLOOD,  # Coastal flooding
    "SWND": Hazard.SEVERE_STORM,  # Strong wind
    "HAIL": Hazard.SEVERE_STORM,
    "LTNG": Hazard.SEVERE_STORM,  # Lightning
    "ISTM": Hazard.SEVERE_STORM,  # Ice storm
    "WNTW": Hazard.SEVERE_STORM,  # Winter weather
    "HRCN": Hazard.HURRICANE,
    "TRND": Hazard.TORNADO,
}

# NRI hazards with no matching hazard here. Their losses are left out of every
# expected loss figure, and the frontend lists them so users know.
NRI_EXCLUDED_HAZARDS = {
    "AVLN": "Avalanche",
    "CWAV": "Cold wave",
    "DRGT": "Drought",
    "HWAV": "Heat wave",
    "LNDS": "Landslide",
    "TSUN": "Tsunami",
    "VLCN": "Volcanic activity",
}

# NWS alert `event` to (hazard, live score from 0 to 100). Other events, such as
# Frost Advisory, can still appear as a county's active alert but add no score.
ALERT_RULES: dict[str, tuple[Hazard, int]] = {
    "Red Flag Warning": (Hazard.WILDFIRE, 100),
    "Fire Warning": (Hazard.WILDFIRE, 100),
    "Fire Weather Watch": (Hazard.WILDFIRE, 60),
    "Flash Flood Warning": (Hazard.FLOOD, 100),
    "Flood Warning": (Hazard.FLOOD, 85),
    "Coastal Flood Warning": (Hazard.FLOOD, 75),
    "Flash Flood Watch": (Hazard.FLOOD, 60),
    "Flood Watch": (Hazard.FLOOD, 55),
    "Coastal Flood Watch": (Hazard.FLOOD, 50),
    "Flood Advisory": (Hazard.FLOOD, 35),
    "Coastal Flood Advisory": (Hazard.FLOOD, 30),
    "Coastal Flood Statement": (Hazard.FLOOD, 20),
    "Extreme Wind Warning": (Hazard.SEVERE_STORM, 100),
    "Severe Thunderstorm Warning": (Hazard.SEVERE_STORM, 90),
    "High Wind Warning": (Hazard.SEVERE_STORM, 75),
    "Blizzard Warning": (Hazard.SEVERE_STORM, 70),
    "Ice Storm Warning": (Hazard.SEVERE_STORM, 70),
    "Winter Storm Warning": (Hazard.SEVERE_STORM, 60),
    "Severe Thunderstorm Watch": (Hazard.SEVERE_STORM, 55),
    "High Wind Watch": (Hazard.SEVERE_STORM, 50),
    "Winter Storm Watch": (Hazard.SEVERE_STORM, 40),
    "Wind Advisory": (Hazard.SEVERE_STORM, 35),
    "Winter Weather Advisory": (Hazard.SEVERE_STORM, 25),
    "Hurricane Warning": (Hazard.HURRICANE, 100),
    "Storm Surge Warning": (Hazard.HURRICANE, 90),
    "Tropical Storm Warning": (Hazard.HURRICANE, 75),
    "Hurricane Watch": (Hazard.HURRICANE, 70),
    "Storm Surge Watch": (Hazard.HURRICANE, 60),
    "Tropical Storm Watch": (Hazard.HURRICANE, 50),
    "Tornado Warning": (Hazard.TORNADO, 100),
    "Tornado Watch": (Hazard.TORNADO, 65),
}
