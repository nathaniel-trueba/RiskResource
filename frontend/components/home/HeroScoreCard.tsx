// frontend/components/home/HeroScoreCard.tsx
'use client';

import React, { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { fetchCounty, searchCounties } from '@/lib/api';
import { scoreColor } from '@/lib/riskColors';
import { CountyRecord, SearchResult } from '@/lib/types';

interface SavedLocation {
  id: string;
  label: string;
  fips: string;
  area: string;
}

interface AddressSuggestion {
  id: string;
  label: string;
  sublabel: string;
  lat: number;
  lng: number;
}

const DEFAULT_LOCATIONS: SavedLocation[] = [
  { id: '06065-palm-springs', label: 'Palm Springs', fips: '06065', area: 'Palm Springs area' },
  { id: '06097-santa-rosa', label: 'Santa Rosa', fips: '06097', area: 'Santa Rosa area' },
  { id: '06019-fresno', label: 'Fresno', fips: '06019', area: 'Central Valley' },
  { id: '06073-san-diego', label: 'San Diego', fips: '06073', area: 'San Diego area' },
];

const LOCATIONS_STORAGE_KEY = 'risk-resource:locations';
const ACTIVE_ID_STORAGE_KEY = 'risk-resource:active-location-id';

export default function HeroScoreCard() {
  const [locations, setLocations] = useState<SavedLocation[]>(DEFAULT_LOCATIONS);
  const [selectedId, setSelectedId] = useState<string>('06097-santa-rosa');
  const [hydrated, setHydrated] = useState(false);

  // Inline location picker & autocomplete state
  const [addingLocation, setAddingLocation] = useState(false);
  const [locationQuery, setLocationQuery] = useState('');
  const [countySuggestions, setCountySuggestions] = useState<SearchResult[]>([]);
  const [addressSuggestions, setAddressSuggestions] = useState<AddressSuggestion[]>([]);
  const [searchingSuggestions, setSearchingSuggestions] = useState(false);
  const [savingLocation, setSavingLocation] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const latestQuery = useRef('');

  // Cached county records keyed by 5-digit FIPS
  const [counties, setCounties] = useState<Record<string, CountyRecord>>({});
  const [failed, setFailed] = useState<Record<string, boolean>>({});

  // Restore saved locations and active selection on revisit
  useEffect(() => {
    try {
      const rawList = window.localStorage.getItem(LOCATIONS_STORAGE_KEY);
      const rawActive = window.localStorage.getItem(ACTIVE_ID_STORAGE_KEY);

      if (rawList) {
        const parsed: SavedLocation[] = JSON.parse(rawList);
        if (Array.isArray(parsed) && parsed.length > 0) {
          setLocations(parsed);
          if (rawActive && parsed.some((item) => item.id === rawActive)) {
            setSelectedId(rawActive);
          } else {
            setSelectedId(parsed[0].id);
          }
        }
      } else if (rawActive && DEFAULT_LOCATIONS.some((item) => item.id === rawActive)) {
        setSelectedId(rawActive);
      }
    } catch {
      // Ignore storage errors
    } finally {
      setHydrated(true);
    }
  }, []);

  // Persist changes to localStorage
  useEffect(() => {
    if (!hydrated) return;
    try {
      window.localStorage.setItem(LOCATIONS_STORAGE_KEY, JSON.stringify(locations));
      window.localStorage.setItem(ACTIVE_ID_STORAGE_KEY, selectedId);
    } catch {
      // Ignore storage errors
    }
  }, [locations, selectedId, hydrated]);

  // Debounced live autocomplete for counties, cities, ZIPs, and street addresses
  useEffect(() => {
    const trimmed = locationQuery.trim();
    latestQuery.current = trimmed;
    setLocationError(null);

    if (!addingLocation || trimmed.length < 2) {
      setCountySuggestions([]);
      setAddressSuggestions([]);
      return;
    }

    const timer = setTimeout(() => {
      setSearchingSuggestions(true);

      const countyPromise = searchCounties(trimmed, 4).catch(() => [] as SearchResult[]);
      const addressPromise: Promise<AddressSuggestion[]> =
        trimmed.length >= 3
          ? fetch(
              `https://photon.komoot.io/api/?q=${encodeURIComponent(
                trimmed
              )}&bbox=-179.15,18.91,-66.95,71.39&limit=4`
            )
              .then((res) => (res.ok ? res.json() : null))
              .then((data) => {
                if (!data?.features) return [];
                return data.features
                  .filter((f: any) => {
                    const cc = f?.properties?.countrycode;
                    return !cc || cc === 'US';
                  })
                  .map((f: any, idx: number): AddressSuggestion => {
                    const [lng, lat] = f.geometry.coordinates;
                    const p = f.properties || {};
                    const streetLine =
                      [p.housenumber, p.street].filter(Boolean).join(' ') || p.name;
                    const locality = [p.city || p.town || p.village, p.state, p.postcode]
                      .filter(Boolean)
                      .join(', ');
                    return {
                      id: `${p.osm_id || idx}-${lat}-${lng}`,
                      label: streetLine || locality || trimmed,
                      sublabel: streetLine ? locality : 'US Location',
                      lat,
                      lng,
                    };
                  });
              })
              .catch(() => [])
          : Promise.resolve([]);

      Promise.all([countyPromise, addressPromise])
        .then(([foundCounties, foundAddresses]) => {
          if (latestQuery.current !== trimmed) return;
          setCountySuggestions(foundCounties);
          setAddressSuggestions(foundAddresses);
        })
        .finally(() => {
          if (latestQuery.current === trimmed) setSearchingSuggestions(false);
        });
    }, 250);

    return () => clearTimeout(timer);
  }, [locationQuery, addingLocation]);

  const activePill = locations.find((loc) => loc.id === selectedId) || locations[0];
  const county = counties[activePill.fips];

  useEffect(() => {
    if (county) return;
    const fips = activePill.fips;
    fetchCounty(fips)
      .then((record) => {
        setCounties((cached) => ({ ...cached, [fips]: record }));
        setFailed((cached) => ({ ...cached, [fips]: false }));
      })
      .catch(() => setFailed((cached) => ({ ...cached, [fips]: true })));
  }, [county, activePill.fips]);

  const addAndSelectLocation = (newLoc: Omit<SavedLocation, 'id'>) => {
    const id = `${newLoc.fips}-${newLoc.label.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`;
    const entry: SavedLocation = { ...newLoc, id };

    setLocations((prev) => {
      const existing = prev.find((item) => item.id === id);
      if (existing) return prev;
      return [entry, ...prev];
    });
    setSelectedId(id);
    setLocationQuery('');
    setCountySuggestions([]);
    setAddressSuggestions([]);
    setAddingLocation(false);
  };

  const deleteLocation = (e: React.MouseEvent, idToDelete: string) => {
    e.stopPropagation();
    if (locations.length <= 1) return;

    const nextList = locations.filter((item) => item.id !== idToDelete);
    setLocations(nextList);

    if (selectedId === idToDelete) {
      setSelectedId(nextList[0].id);
    }
  };

  const resetToDefaults = () => {
    setLocations(DEFAULT_LOCATIONS);
    setSelectedId(DEFAULT_LOCATIONS[1].id);
    setLocationQuery('');
    setLocationError(null);
    setAddingLocation(false);
  };

  const selectCountySuggestion = (item: SearchResult) => {
    const label = item.matchedPlace || item.name;
    addAndSelectLocation({
      label,
      fips: item.fips,
      area: `${item.name}, ${item.stateCode}`,
    });
  };

  const selectAddressSuggestion = async (addr: AddressSuggestion) => {
    setSavingLocation(true);
    setLocationError(null);
    try {
      const fccRes = await fetch(
        `https://geo.fcc.gov/api/census/area?lat=${addr.lat}&lon=${addr.lng}&format=json`
      );
      const fccData = await fccRes.json();
      const fips: string | undefined = fccData?.results?.[0]?.county_fips;

      if (!fips) {
        setLocationError('Could not match that location to a US county.');
        return;
      }

      addAndSelectLocation({
        label: addr.label,
        fips,
        area: addr.sublabel || `${addr.label} area`,
      });
    } catch {
      setLocationError('Lookup failed. Try again.');
    } finally {
      setSavingLocation(false);
    }
  };

  const handleSaveSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = locationQuery.trim();
    if (!trimmed) return;

    if (countySuggestions.length > 0) {
      selectCountySuggestion(countySuggestions[0]);
      return;
    }

    if (addressSuggestions.length > 0) {
      await selectAddressSuggestion(addressSuggestions[0]);
      return;
    }

    setSavingLocation(true);
    setLocationError(null);
    try {
      const geoRes = await fetch(
        `https://photon.komoot.io/api/?q=${encodeURIComponent(
          trimmed
        )}&bbox=-179.15,18.91,-66.95,71.39&limit=1`
      );
      const geoData = await geoRes.json();
      const feature = geoData?.features?.[0];

      if (!feature) {
        setLocationError('Location not found. Try a city, county, ZIP, or address.');
        return;
      }

      const [lng, lat] = feature.geometry.coordinates;
      const props = feature.properties || {};
      const cityLabel =
        props.city || props.town || props.village || props.name || trimmed.split(',')[0];
      const stateLabel = props.state || '';

      const fccRes = await fetch(
        `https://geo.fcc.gov/api/census/area?lat=${lat}&lon=${lng}&format=json`
      );
      const fccData = await fccRes.json();
      const fips: string | undefined = fccData?.results?.[0]?.county_fips;

      if (!fips) {
        setLocationError('Could not match that location to a US county.');
        return;
      }

      addAndSelectLocation({
        label: cityLabel,
        fips,
        area: stateLabel ? `${cityLabel}, ${stateLabel}` : `${cityLabel} area`,
      });
    } catch {
      setLocationError('Lookup failed. Check your connection and try again.');
    } finally {
      setSavingLocation(false);
    }
  };

  const hasModifiedList =
    locations.length !== DEFAULT_LOCATIONS.length ||
    locations.some((loc, idx) => loc.id !== DEFAULT_LOCATIONS[idx]?.id);

  const score = county?.compositeScore ?? 0;
  const status = failed[activePill.fips] ? 'Backend unavailable' : 'Loading...';
  const data = {
    name: county?.name ?? status,
    state: county?.state ?? '',
    area: activePill.area,
    score,
    rating: county ? `${county.tier} risk` : status,
    hazards: (county?.hazards ?? []).map((h) => ({
      name: h.name,
      score: h.score,
      color: scoreColor(h.score),
    })),
  };

  return (
    <div className="bg-white border border-[#e5e0d5] shadow-md dark:bg-[#1d1914] dark:border-white/10 dark:shadow-2xl rounded-3xl p-7 sm:p-8 relative transition-colors">
      {/* Location pills + Add location button */}
      <div className="flex flex-wrap items-center gap-2 mb-5">
        {locations.map((pill) => {
          const active = activePill.id === pill.id;
          return (
            <div
              key={pill.id}
              onClick={() => {
                setSelectedId(pill.id);
                setAddingLocation(false);
              }}
              role="button"
              tabIndex={0}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') {
                  e.preventDefault();
                  setSelectedId(pill.id);
                  setAddingLocation(false);
                }
              }}
              className={`group inline-flex items-center gap-1.5 pl-3.5 ${
                locations.length > 1 ? 'pr-2' : 'pr-3.5'
              } py-1.5 rounded-full text-xs border transition-colors cursor-pointer ${
                active
                  ? 'bg-gray-900 text-white font-semibold border-transparent dark:bg-[#efe8dd] dark:text-black'
                  : 'bg-[#f5f2eb] text-gray-600 hover:text-gray-900 border-[#e5e0d5] hover:border-gray-400 dark:bg-transparent dark:text-gray-400 dark:hover:text-white dark:border-white/10 dark:hover:border-white/30'
              }`}
            >
              <span>{pill.label}</span>
              {locations.length > 1 && (
                <button
                  type="button"
                  onClick={(e) => deleteLocation(e, pill.id)}
                  title={`Remove ${pill.label}`}
                  aria-label={`Remove ${pill.label}`}
                  className={`w-4 h-4 rounded-full inline-flex items-center justify-center text-[11px] leading-none transition-opacity cursor-pointer ${
                    active
                      ? 'text-white/70 hover:text-white hover:bg-white/15 dark:text-black/60 dark:hover:text-black dark:hover:bg-black/10'
                      : 'text-gray-400 hover:text-gray-900 hover:bg-black/5 dark:text-gray-500 dark:hover:text-white dark:hover:bg-white/10'
                  }`}
                >
                  ×
                </button>
              )}
            </div>
          );
        })}

        <button
          type="button"
          onClick={() => {
            setAddingLocation((prev) => !prev);
            setLocationError(null);
          }}
          className="px-3 py-1.5 rounded-full text-xs font-mono border border-dashed border-amber-600/50 text-amber-800 hover:bg-amber-50 dark:border-[#e29b4d]/40 dark:text-[#e29b4d] dark:hover:bg-[#e29b4d]/10 transition-colors cursor-pointer"
        >
          + Add location
        </button>
      </div>

      {/* Inline Location Search Picker */}
      {addingLocation && (
        <form
          onSubmit={handleSaveSubmit}
          className="mb-6 p-3.5 rounded-2xl bg-[#f5f2eb] border border-[#e5e0d5] dark:bg-white/5 dark:border-white/10 space-y-2.5"
        >
          <div className="flex items-center justify-between">
            <span className="text-[11px] font-mono uppercase tracking-wider text-gray-600 dark:text-gray-400">
              Add location
            </span>
            {hasModifiedList && (
              <button
                type="button"
                onClick={resetToDefaults}
                className="text-[11px] text-amber-800 dark:text-[#e29b4d] hover:underline cursor-pointer"
              >
                Reset defaults
              </button>
            )}
          </div>

          <div className="relative">
            <div className="flex items-center gap-2">
              <input
                type="text"
                value={locationQuery}
                onChange={(e) => setLocationQuery(e.target.value)}
                placeholder="Search city, county, ZIP, or address..."
                autoFocus
                className="w-full px-3 py-2 rounded-xl text-xs bg-white border border-gray-300 text-gray-900 placeholder:text-gray-400 dark:bg-[#14110e] dark:border-white/15 dark:text-white focus:outline-none focus:border-amber-500"
              />
              <button
                type="submit"
                disabled={savingLocation}
                className="px-4 py-2 rounded-xl bg-amber-600 hover:bg-amber-700 text-white dark:bg-[#e29b4d] dark:hover:bg-[#c98335] dark:text-black font-semibold text-xs whitespace-nowrap cursor-pointer disabled:opacity-50"
              >
                {savingLocation ? 'Adding...' : 'Add'}
              </button>
            </div>

            {/* Live Autocomplete Results */}
            {(searchingSuggestions ||
              countySuggestions.length > 0 ||
              addressSuggestions.length > 0) && (
              <ul className="mt-1.5 bg-white border border-gray-200 dark:bg-[#14110e] dark:border-white/15 rounded-xl shadow-lg overflow-hidden text-xs max-h-56 overflow-y-auto divide-y divide-gray-100 dark:divide-white/10">
                {searchingSuggestions &&
                  countySuggestions.length === 0 &&
                  addressSuggestions.length === 0 && (
                    <li className="px-3 py-2 text-gray-500 font-mono">Searching...</li>
                  )}

                {countySuggestions.map((item) => (
                  <li key={item.fips}>
                    <button
                      type="button"
                      onClick={() => selectCountySuggestion(item)}
                      className="w-full text-left px-3 py-2 hover:bg-[#f5f2eb] dark:hover:bg-white/5 cursor-pointer"
                    >
                      <span className="font-semibold text-gray-900 dark:text-white">
                        {item.name}
                      </span>
                      <span className="text-gray-500">, {item.stateCode}</span>
                      {item.matchedPlace && (
                        <span className="block text-[10px] text-gray-400">
                          via {item.matchedPlace}
                        </span>
                      )}
                    </button>
                  </li>
                ))}

                {addressSuggestions.map((addr) => (
                  <li key={addr.id}>
                    <button
                      type="button"
                      disabled={savingLocation}
                      onClick={() => selectAddressSuggestion(addr)}
                      className="w-full text-left px-3 py-2 hover:bg-[#f5f2eb] dark:hover:bg-white/5 cursor-pointer disabled:opacity-50"
                    >
                      <span className="font-semibold text-gray-900 dark:text-white block truncate">
                        {addr.label}
                      </span>
                      {addr.sublabel && (
                        <span className="block text-[10px] text-gray-500 dark:text-gray-400 truncate">
                          {addr.sublabel}
                        </span>
                      )}
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {locationError && (
            <p className="text-[11px] text-red-600 dark:text-red-400">{locationError}</p>
          )}
        </form>
      )}

      {/* Score + title */}
      <div className="flex items-center gap-5 mb-7">
        <div className="relative w-24 h-24 shrink-0 flex items-center justify-center">
          <svg className="w-full h-full -rotate-90" viewBox="0 0 36 36">
            <path
              className="text-gray-200 dark:text-white/10"
              strokeWidth="3.2"
              stroke="currentColor"
              fill="none"
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            />
            <path
              style={{ color: scoreColor(data.score) }}
              strokeDasharray={`${data.score}, 100`}
              strokeWidth="3.2"
              strokeLinecap="round"
              stroke="currentColor"
              fill="none"
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            />
          </svg>
          <div className="absolute flex flex-col items-center justify-center">
            <span className="text-3xl font-extrabold text-gray-950 dark:text-white leading-none">
              {data.score}
            </span>
            <span className="text-[9px] font-mono uppercase text-gray-500 dark:text-gray-400 tracking-tight mt-1">
              OF 100
            </span>
          </div>
        </div>

        <div>
          <h3 className="font-display text-2xl font-bold text-gray-950 dark:text-white tracking-tight leading-tight">
            {data.name}
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-1">
            {data.state ? `${data.state} · ${data.area}` : data.area}
          </p>
          <span className="inline-block mt-2.5 px-3 py-1 rounded-full bg-gray-900 text-white dark:bg-[#efe8dd] dark:text-black text-xs font-medium">
            {data.rating}
          </span>
        </div>
      </div>

      {/* Hazard bars */}
      <div className="space-y-4 mb-7">
        {data.hazards.map((hazard) => (
          <div key={hazard.name} className="flex items-center justify-between">
            <span className="w-24 text-gray-700 dark:text-gray-300 text-sm">{hazard.name}</span>
            <div className="flex-1 mx-3 h-2.5 bg-[#f5f2eb] dark:bg-white/5 rounded-full overflow-hidden relative">
              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.max(hazard.score, hazard.score > 0 ? 3 : 0)}%`,
                  backgroundColor: hazard.color,
                }}
              />
            </div>
            <span className="w-8 text-right font-mono text-gray-700 dark:text-gray-300 text-sm">
              {hazard.score}
            </span>
          </div>
        ))}
      </div>

      {/* Footer */}
      <div className="flex items-center justify-end pt-5 border-t border-[#e5e0d5] dark:border-white/10">
        <Link
          href={`/map?fips=${activePill.fips}`}
          className="text-amber-700 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300 text-sm font-medium hover:underline"
        >
          Open on the map →
        </Link>
      </div>
    </div>
  );
}
