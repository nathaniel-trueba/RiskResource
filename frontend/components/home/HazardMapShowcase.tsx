// frontend/components/home/HazardMapShowcase.tsx
'use client';

import React, { useState, useEffect } from 'react';
import { fetchHomeSnapshot, MapMetric } from '@/lib/api';
import { MAP_BASE_COLOR, MAP_FILL_OPACITY, NO_DATA_COLOR, scoreColor } from '@/lib/riskColors';
import { MapValue, SnapshotLayer } from '@/lib/types';
import { useTheme } from '@/components/common/ThemeProvider';
import type { Feature, Geometry, Position } from 'geojson';

type HazardType = 'Flood' | 'Wildfire' | 'Earthquake' | 'Severe Storm' | 'Hurricane' | 'Tornado';

interface HazardInfo {
  name: HazardType;
  color: string;
  description: string;
  metric: MapMetric;
  // Rough regional scores, shown only when the backend can't be reached. Coloured
  // with the same score bands as real scores; unlisted states count as 0.
  fallbackStates: Record<string, number>;
}

const HAZARD_CONFIG: Record<HazardType, HazardInfo> = {
  Flood: {
    name: 'Flood',
    metric: 'flood',
    color: '#4a72b2',
    description:
      'Heavy rainfall, snowmelt, and storm surge concentrate flood risk along the Gulf Coast, Florida, and the Mississippi and Ohio river basins.',
    fallbackStates: {
      Louisiana: 60,
      Florida: 60,
      Mississippi: 45,
      Arkansas: 45,
      Missouri: 45,
      Illinois: 45,
      Texas: 35,
      Iowa: 35,
      Kentucky: 35,
      Tennessee: 35,
      Indiana: 35,
      Ohio: 35,
      'North Carolina': 35,
      'South Carolina': 35,
      Alabama: 20,
      Georgia: 20,
      Virginia: 20,
      'New Jersey': 20,
      'West Virginia': 20,
      California: 20,
    },
  },
  Wildfire: {
    name: 'Wildfire',
    metric: 'wildfire',
    color: '#e65100',
    description:
      'Dry summers, dense forest fuels, and seasonal downslope winds drive severe wildfire exposure across California, the Pacific Northwest, and the Mountain West.',
    fallbackStates: {
      California: 60,
      Oregon: 45,
      Washington: 45,
      Idaho: 45,
      Arizona: 45,
      'New Mexico': 35,
      Nevada: 35,
      Utah: 35,
      Colorado: 35,
      Montana: 35,
      Wyoming: 20,
      Texas: 20,
      Oklahoma: 20,
      Hawaii: 35,
    },
  },
  Earthquake: {
    name: 'Earthquake',
    metric: 'earthquake',
    color: '#c49a45',
    description:
      'Tectonic plate boundaries along the West Coast, Alaska, and New Madrid fault zones account for the highest seismic hazard.',
    fallbackStates: {
      California: 60,
      Alaska: 60,
      Washington: 45,
      Oregon: 45,
      Nevada: 35,
      Utah: 35,
      Hawaii: 35,
      Idaho: 20,
      Montana: 20,
      Wyoming: 20,
      Missouri: 20,
      Arkansas: 20,
      Tennessee: 20,
    },
  },
  Hurricane: {
    name: 'Hurricane',
    metric: 'hurricane',
    color: '#2a9d8f',
    description:
      'Tropical cyclones bring destructive winds, storm surge, and inland flooding from the Texas Gulf Coast across Florida and up the Eastern Seaboard.',
    fallbackStates: {
      Florida: 60,
      Louisiana: 60,
      Texas: 45,
      'North Carolina': 45,
      'South Carolina': 45,
      Mississippi: 35,
      Alabama: 35,
      Georgia: 35,
      Virginia: 35,
      Maryland: 20,
      Delaware: 20,
      'New Jersey': 20,
      'New York': 20,
      Massachusetts: 20,
    },
  },
  Tornado: {
    name: 'Tornado',
    metric: 'tornado',
    color: '#7b52ab',
    description:
      'Warm, humid Gulf air clashing with cool, dry air masses fuels frequent severe thunderstorms across the Great Plains, Midwest, and Deep South.',
    fallbackStates: {
      Oklahoma: 60,
      Kansas: 60,
      Texas: 60,
      Mississippi: 45,
      Alabama: 45,
      Arkansas: 45,
      Missouri: 45,
      Iowa: 45,
      Nebraska: 45,
      Illinois: 35,
      Indiana: 35,
      Tennessee: 35,
      Louisiana: 35,
      Kentucky: 20,
      Georgia: 20,
      'South Dakota': 20,
      Minnesota: 20,
      Ohio: 20,
    },
  },
  'Severe Storm': {
    name: 'Severe Storm',
    metric: 'severeStorm',
    color: '#6b7f99',
    description:
      'Damaging winds, hail, lightning, ice storms, and heavy winter weather strike the Plains, the Ohio and Mississippi valleys, and the Northeast.',
    fallbackStates: {
      Oklahoma: 60,
      'New Hampshire': 45,
      Nebraska: 45,
      Vermont: 45,
      Kentucky: 45,
      Missouri: 45,
      Kansas: 35,
      Massachusetts: 35,
      Tennessee: 35,
      Arkansas: 35,
      'Rhode Island': 35,
      Iowa: 35,
      Connecticut: 35,
      Maine: 35,
      'New Jersey': 35,
      'North Dakota': 35,
      Washington: 35,
      'West Virginia': 35,
    },
  },
};

const HAZARDS: HazardType[] = ['Wildfire', 'Earthquake', 'Flood', 'Severe Storm', 'Hurricane', 'Tornado'];

// Albers USA composite projection (lon/lat to SVG x, y)
function projectPoint([lon, lat]: [number, number], stateName: string): [number, number] {
  if (stateName === 'Alaska') {
    const x = (lon + 152) * 4.5 + 160;
    const y = (64 - lat) * 7.5 + 440;
    return [x, y];
  }

  if (stateName === 'Hawaii') {
    const x = (lon + 160) * 12 + 270;
    const y = (22 - lat) * 14 + 480;
    return [x, y];
  }

  const rad = Math.PI / 180;
  const lambda0 = -96 * rad;
  const phi0 = 37.5 * rad;
  const phi1 = 29.5 * rad;
  const phi2 = 45.5 * rad;

  const n = 0.5 * (Math.sin(phi1) + Math.sin(phi2));
  const c = Math.cos(phi1) ** 2 + 2 * n * Math.sin(phi1);
  const rho0 = Math.sqrt(Math.max(0, c - 2 * n * Math.sin(phi0))) / n;

  const l = lon * rad - lambda0;
  const p = lat * rad;
  const rho = Math.sqrt(Math.max(0, c - 2 * n * Math.sin(p))) / n;
  const theta = n * l;

  const x = rho * Math.sin(theta);
  const y = rho0 - rho * Math.cos(theta);

  const scale = 880;
  return [460 + x * scale, 240 - y * scale];
}

function geoJsonToPath(geometry: Geometry | null, stateName: string): string {
  if (!geometry) return '';

  const parseRing = (ring: Position[]) =>
    ring
      .map((coord, i) => {
        const [x, y] = projectPoint([coord[0], coord[1]], stateName);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ') + 'Z';

  if (geometry.type === 'Polygon') {
    return geometry.coordinates.map(parseRing).join(' ');
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.map((poly) => poly.map(parseRing).join(' ')).join(' ');
  }
  return '';
}

/** "2026-11-23" -> "11/23/26", without time-zone shifts. */
function formatShortDate(isoDate: string): string {
  const [year, month, day] = isoDate.split('-');
  return `${month}/${day}/${year.slice(2)}`;
}

/** The card's footer for one hazard's snapshot. */
function snapshotLabel(layer: SnapshotLayer): string {
  const date = formatShortDate(layer.asOf);
  return layer.kind === 'week' ? `Week of ${date}` : `Snapshot of scores for ${date}`;
}

interface HazardSnapshot {
  label: string;
  values: Record<string, MapValue>;
}

export default function HazardMapShowcase() {
  const [activeHazard, setActiveHazard] = useState<HazardType>('Flood');
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [features, setFeatures] = useState<Feature[]>([]);
  const [loading, setLoading] = useState<boolean>(true);
  const [snapshot, setSnapshot] = useState<Partial<Record<HazardType, HazardSnapshot>>>({});

  const { theme } = useTheme();
  const isDark = theme === 'dark';

  // Fixed state scores (backend/data/snapshot/), so the colours don't change with
  // today's conditions. If the backend can't be reached, the regional highlights
  // in HAZARD_CONFIG are shown instead, without a date.
  useEffect(() => {
    fetchHomeSnapshot()
      .then((data) => {
        const byHazard: Partial<Record<HazardType, HazardSnapshot>> = {};
        for (const hazard of HAZARDS) {
          const layer = data.hazards[HAZARD_CONFIG[hazard].metric];
          if (layer) {
            byHazard[hazard] = {
              label: snapshotLabel(layer),
              values: Object.fromEntries(layer.values.map((v) => [v.id, v])),
            };
          }
        }
        setSnapshot(byHazard);
      })
      .catch(() => {
        // Fallback regional highlights will be used automatically
      });
  }, []);

  // Fetch US state boundaries
  useEffect(() => {
    fetch('https://raw.githubusercontent.com/python-visualization/folium-example-data/main/us_states.json')
      .then((res) => res.json())
      .then((data) => {
        setFeatures(data.features || []);
        setLoading(false);
      })
      .catch((err) => {
        console.error('Failed to load geographic boundaries:', err);
        setLoading(false);
      });
  }, []);

  // Auto-cycle through hazards
  useEffect(() => {
    if (isPaused) return;
    const interval = setInterval(() => {
      setActiveHazard((prev) => {
        const nextIdx = (HAZARDS.indexOf(prev) + 1) % HAZARDS.length;
        return HAZARDS[nextIdx];
      });
    }, 4500);
    return () => clearInterval(interval);
  }, [isPaused, activeHazard]);

  const current = HAZARD_CONFIG[activeHazard];
  const strokeColor = isDark ? '#1d1914' : '#ffffff';

  return (
    <div className="bg-white border border-[#e5e0d5] shadow-md dark:bg-[#1d1914] dark:border-white/10 dark:shadow-2xl rounded-3xl p-4 sm:p-6 lg:p-8 overflow-hidden transition-colors">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6 lg:gap-10 items-center">
        {/* Map */}
        <div className="flex items-center justify-center">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 h-[420px]">
              <div className="w-6 h-6 border-2 border-amber-500 dark:border-amber-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs font-mono text-gray-500">
                Loading US geographic boundaries...
              </span>
            </div>
          ) : (
            <svg viewBox="70 15 720 525" className="w-full h-auto select-none">
              {features.map((feature, idx) => {
                const name = feature.properties?.name || '';
                const layer = snapshot[activeHazard];
                const value = layer?.values[String(feature.id)];
                // Same colours as the risk map: its score bands, and its grey for
                // a state with no score. Without the snapshot (backend down), the
                // regional fallback scores are coloured on the same bands.
                const fill = layer
                  ? value
                    ? scoreColor(value.value)
                    : NO_DATA_COLOR
                  : scoreColor(current.fallbackStates[name] ?? 0);
                const pathData = geoJsonToPath(feature.geometry, name);

                return (
                  <g key={feature.id || name || idx}>
                  {/* Light base, like the risk map's basemap, so the 70% fill
                      looks the same as there in both themes */}
                  <path d={pathData} fill={MAP_BASE_COLOR} stroke="none" />
                  <path
                    d={pathData}
                    fill={fill}
                    fillOpacity={MAP_FILL_OPACITY}
                    stroke={strokeColor}
                    strokeWidth="1.2"
                    strokeLinejoin="round"
                    className="transition-colors duration-700 ease-in-out cursor-pointer hover:opacity-90"
                  >
                    <title>{name}</title>
                  </path>
                  </g>
                );
              })}
            </svg>
          )}
        </div>

        {/* Selector panel */}
        <div className="flex flex-col space-y-6">
          <div>
            <h3 className="font-display text-4xl font-extrabold text-gray-950 dark:text-white tracking-tight">
              {current.name}
            </h3>
            <p className="text-base text-gray-600 dark:text-gray-400 mt-3 leading-relaxed min-h-[112px]">
              {current.description}
            </p>
          </div>

          <div className="flex flex-wrap gap-2.5">
            {HAZARDS.map((hazard) => {
              const active = activeHazard === hazard;
              return (
                <button
                  key={hazard}
                  type="button"
                  onClick={() => setActiveHazard(hazard)}
                  className={`px-4 py-2 rounded-full text-sm flex items-center gap-2 border transition-colors cursor-pointer ${
                    active
                      ? 'bg-gray-900 text-white font-semibold border-transparent dark:bg-[#efe8dd] dark:text-black'
                      : 'bg-[#f5f2eb] text-gray-700 border-[#e5e0d5] hover:border-gray-400 dark:bg-transparent dark:text-gray-200 dark:border-white/10 dark:hover:border-white/30'
                  }`}
                >
                  <span
                    className="w-2.5 h-2.5 rounded-full shrink-0"
                    style={{ backgroundColor: HAZARD_CONFIG[hazard].color }}
                  />
                  {hazard}
                </button>
              );
            })}
          </div>

          <div>
            <div className="h-[3px] w-full bg-gray-200 dark:bg-white/10 mb-4 rounded-full overflow-hidden">
              {!isPaused && (
                <div
                  key={`${activeHazard}-${isPaused}`}
                  className="h-full bg-amber-600 dark:bg-amber-400"
                  style={{ animation: 'cycleProgress 4.5s linear forwards' }}
                />
              )}
            </div>
            <button
              type="button"
              onClick={() => setIsPaused((prev) => !prev)}
              className="px-5 py-2 rounded-xl border border-[#e5e0d5] bg-[#f5f2eb] hover:bg-gray-200/70 text-gray-800 dark:border-white/10 dark:bg-white/5 dark:hover:bg-white/10 text-sm font-mono dark:text-gray-200 transition-colors cursor-pointer"
            >
              {isPaused ? 'Resume' : 'Pause'}
            </button>
          </div>
        </div>
      </div>

      {snapshot[activeHazard] && (
        <p className="mt-4 text-right text-[11px] font-mono text-gray-500 dark:text-gray-400">
          {snapshot[activeHazard]?.label}
        </p>
      )}
    </div>
  );
}
