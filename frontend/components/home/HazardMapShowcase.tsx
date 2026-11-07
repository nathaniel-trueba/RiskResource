'use client';

import React, { useState, useEffect } from 'react';

type HazardType = 'Flood' | 'Wildfire' | 'Earthquake' | 'Hurricane' | 'Tornado';

interface HazardInfo {
  name: HazardType;
  color: string;
  description: string;
  activeStates: Record<string, string>;
}

const HAZARD_CONFIG: Record<HazardType, HazardInfo> = {
  Flood: {
    name: 'Flood',
    color: '#4a72b2',
    description:
      'Riverine and flash flooding follow the Gulf Coast, Florida and the Mississippi and Ohio river valleys.',
    activeStates: {
      Louisiana: '#c45138',
      Mississippi: '#c45138',
      Florida: '#e08f52',
      Illinois: '#e08f52',
      Arkansas: '#eab676',
      Missouri: '#eab676',
      Kentucky: '#eab676',
      Tennessee: '#eab676',
      Texas: '#f1d69d',
      Oklahoma: '#f1d69d',
      Iowa: '#f1d69d',
      Indiana: '#f1d69d',
      Ohio: '#f1d69d',
      Georgia: '#f1d69d',
      Alabama: '#f1d69d',
      'North Carolina': '#f1d69d',
      'South Carolina': '#f1d69d',
    },
  },
  Wildfire: {
    name: 'Wildfire',
    color: '#e65100',
    description:
      'High fuel loads, drought, and seasonal Santa Ana or Diablo wind corridors elevate risk across the West.',
    activeStates: {
      California: '#c45138',
      Oregon: '#e08f52',
      Washington: '#e08f52',
      Idaho: '#e08f52',
      Nevada: '#eab676',
      Arizona: '#eab676',
      'New Mexico': '#eab676',
      Utah: '#eab676',
      Colorado: '#f1d69d',
      Montana: '#f1d69d',
      Wyoming: '#f1d69d',
      Hawaii: '#e08f52',
    },
  },
  Earthquake: {
    name: 'Earthquake',
    color: '#c49a45',
    description:
      'Fault systems along the Pacific plate boundary, Cascadia Subduction Zone, and New Madrid Seismic Zone carry high risk.',
    activeStates: {
      California: '#c45138',
      Alaska: '#c45138',
      Washington: '#e08f52',
      Oregon: '#e08f52',
      Nevada: '#eab676',
      Utah: '#eab676',
      Hawaii: '#eab676',
      Missouri: '#f1d69d',
      Tennessee: '#f1d69d',
    },
  },
  Hurricane: {
    name: 'Hurricane',
    color: '#2a9d8f',
    description:
      'Coastal counties from Texas to the Carolinas carry most of the risk, with Florida highest.',
    activeStates: {
      Florida: '#8f2d20',
      Louisiana: '#c45138',
      'South Carolina': '#e08f52',
      Texas: '#f0c67a',
      Mississippi: '#f0c67a',
      Georgia: '#f0c67a',
      'North Carolina': '#f0c67a',
      'New Jersey': '#f0c67a',
      Connecticut: '#f0c67a',
      'Rhode Island': '#f0c67a',
      Massachusetts: '#f0c67a',
    },
  },
  Tornado: {
    name: 'Tornado',
    color: '#7b52ab',
    description:
      'Severe supercells colliding over Tornado Alley and Dixie Alley drive intense tornado frequencies.',
    activeStates: {
      Oklahoma: '#c45138',
      Kansas: '#c45138',
      Texas: '#e08f52',
      Nebraska: '#e08f52',
      Iowa: '#eab676',
      Missouri: '#eab676',
      Mississippi: '#eab676',
      Alabama: '#eab676',
      Arkansas: '#f1d69d',
      Tennessee: '#f1d69d',
      Illinois: '#f1d69d',
      Indiana: '#f1d69d',
    },
  },
};

const HAZARDS: HazardType[] = ['Wildfire', 'Earthquake', 'Flood', 'Hurricane', 'Tornado'];

// Albers USA composite projection (lon/lat to SVG x, y)
function projectPoint([lon, lat]: [number, number], stateName: string): [number, number] {
  // Alaska inset (scaled down, bottom-left)
  if (stateName === 'Alaska') {
    const x = (lon + 152) * 4.5 + 160;
    const y = (64 - lat) * 7.5 + 440;
    return [x, y];
  }

  // Hawaii inset (just right of Alaska)
  if (stateName === 'Hawaii') {
    const x = (lon + 160) * 12 + 270;
    const y = (22 - lat) * 14 + 480;
    return [x, y];
  }

  // Lower 48
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

function geoJsonToPath(geometry: any, stateName: string): string {
  if (!geometry) return '';

  const parseRing = (ring: any[]) =>
    ring
      .map((coord, i) => {
        const [x, y] = projectPoint(coord, stateName);
        return `${i === 0 ? 'M' : 'L'}${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ') + 'Z';

  if (geometry.type === 'Polygon') {
    return geometry.coordinates.map(parseRing).join(' ');
  }
  if (geometry.type === 'MultiPolygon') {
    return geometry.coordinates.map((poly: any[]) => poly.map(parseRing).join(' ')).join(' ');
  }
  return '';
}

export default function HazardMapShowcase() {
  const [activeHazard, setActiveHazard] = useState<HazardType>('Flood');
  const [isPaused, setIsPaused] = useState<boolean>(false);
  const [features, setFeatures] = useState<any[]>([]);
  const [loading, setLoading] = useState<boolean>(true);

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
  }, [isPaused]);

  const current = HAZARD_CONFIG[activeHazard];
  const defaultBaseColor = '#f9efcf';

  return (
    <div className="bg-[#1d1914] border border-white/10 rounded-3xl p-4 sm:p-6 lg:p-8 shadow-2xl overflow-hidden">
      <div className="grid grid-cols-1 lg:grid-cols-[minmax(0,1fr)_340px] gap-6 lg:gap-10 items-center">

        {/* Map */}
        <div className="flex items-center justify-center">
          {loading ? (
            <div className="flex flex-col items-center justify-center gap-3 h-[420px]">
              <div className="w-6 h-6 border-2 border-amber-400 border-t-transparent rounded-full animate-spin" />
              <span className="text-xs font-mono text-gray-500">Loading US geographic boundaries...</span>
            </div>
          ) : (
            <svg viewBox="70 15 720 525" className="w-full h-auto select-none">
              {features.map((feature, idx) => {
                const name = feature.properties?.name || '';
                const fill = current.activeStates[name] || defaultBaseColor;
                const pathData = geoJsonToPath(feature.geometry, name);

                return (
                  <path
                    key={feature.id || name || idx}
                    d={pathData}
                    fill={fill}
                    stroke="#1d1914"
                    strokeWidth="1"
                    strokeLinejoin="round"
                    className="transition-colors duration-700 ease-in-out cursor-pointer hover:opacity-90"
                  >
                    <title>{name}</title>
                  </path>
                );
              })}
            </svg>
          )}
        </div>

        {/* Selector panel */}
        <div className="flex flex-col space-y-6">
          <div>
            <span className="text-xs font-mono uppercase tracking-widest text-[#e29b4d] block mb-2">
              NOW SHOWING
            </span>
            <h3 className="font-display text-4xl font-extrabold text-white tracking-tight">
              {current.name}
            </h3>
            <p className="text-base text-gray-400 mt-3 leading-relaxed min-h-[96px]">
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
                  onClick={() => {
                    setActiveHazard(hazard);
                    setIsPaused(true);
                  }}
                  className={`px-4 py-2 rounded-full text-sm flex items-center gap-2 border transition-colors cursor-pointer ${
                    active
                      ? 'bg-[#efe8dd] text-black font-semibold border-transparent'
                      : 'bg-transparent text-gray-200 border-white/10 hover:border-white/30'
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
            <div className="h-[3px] w-full bg-white/10 mb-4 rounded-full overflow-hidden">
              {!isPaused && (
                <div
                  key={activeHazard}
                  className="h-full bg-amber-400"
                  style={{ animation: 'cycleProgress 4.5s linear infinite' }}
                />
              )}
            </div>
            <button
              type="button"
              onClick={() => setIsPaused(!isPaused)}
              className="px-5 py-2 rounded-xl border border-white/10 bg-white/5 hover:bg-white/10 text-sm font-mono text-gray-200 transition-colors cursor-pointer"
            >
              {isPaused ? 'Resume' : 'Pause'}
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}