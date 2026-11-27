'use client';

import React, { useEffect, useRef, useState } from 'react';
import { HazardKey, LossMetric, searchCounties } from '@/lib/api';
import { HAZARDS } from '@/lib/riskColors';
import { SearchResult } from '@/lib/types';

/** What colours the map: our risk score, or a FEMA NRI expected loss measure. */
export type Measure = 'score' | LossMetric;

export const MEASURES: { value: Measure; label: string; statesOnly?: boolean }[] = [
  { value: 'score', label: 'Risk score (history + live conditions + wildfire model)' },
  { value: 'lossPerPerson', label: 'Expected annual loss per person (FEMA)' },
  { value: 'totalLoss', label: 'Total expected annual loss (FEMA)' },
  { value: 'highLossPct', label: '% of residents in high-loss counties (FEMA)', statesOnly: true },
];

interface Props {
  viewMode: 'states' | 'counties';
  onViewModeChange: (mode: 'states' | 'counties') => void;
  measure: Measure;
  onMeasureChange: (measure: Measure) => void;
  hazard: HazardKey | null; // null: all hazards
  onHazardChange: (hazard: HazardKey | null) => void;
  onSelectCounty: (fips: string, pin?: { lat: number; lng: number; name?: string }) => void;
}

interface AddressSuggestion {
  id: string;
  label: string;
  sublabel: string;
  lat: number;
  lng: number;
}

// Wait this long after the last keystroke before searching
const SEARCH_DEBOUNCE_MS = 250;

export default function MapControls({
  viewMode,
  onViewModeChange,
  measure,
  onMeasureChange,
  hazard,
  onHazardChange,
  onSelectCounty,
}: Props) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchResult[]>([]);
  const [addressResults, setAddressResults] = useState<AddressSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [resolvingAddress, setResolvingAddress] = useState(false);
  const [lookupError, setLookupError] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const latestQuery = useRef('');

  useEffect(() => {
    const trimmed = query.trim();
    latestQuery.current = trimmed;
    setLookupError(null);

    if (!trimmed) {
      setResults([]);
      setAddressResults([]);
      return;
    }

    const timer = setTimeout(() => {
      setSearching(true);

      // 1. Search counties / cities / ZIPs via existing backend API
      const countyPromise = searchCounties(trimmed).catch(() => [] as SearchResult[]);

      // 2. Search US street addresses via Photon (only once query has 4+ chars)
      const addressPromise: Promise<AddressSuggestion[]> =
        trimmed.length >= 4
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
                    const streetLine = [p.housenumber, p.street].filter(Boolean).join(' ') || p.name;
                    const locality = [p.city || p.town || p.village, p.state, p.postcode]
                      .filter(Boolean)
                      .join(', ');
                    return {
                      id: `${p.osm_id || idx}-${lat}-${lng}`,
                      label: streetLine || locality || trimmed,
                      sublabel: streetLine ? locality : 'US Address',
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
          setResults(foundCounties);
          setAddressResults(foundAddresses);
        })
        .finally(() => {
          if (latestQuery.current === trimmed) setSearching(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [query]);

  const choose = (result: SearchResult) => {
    setQuery('');
    setResults([]);
    setAddressResults([]);
    setLookupError(null);
    setOpen(false);
    onSelectCounty(result.fips);
  };

  const chooseAddress = async (addr: AddressSuggestion) => {
    setResolvingAddress(true);
    setLookupError(null);
    try {
      const fccRes = await fetch(
        `https://geo.fcc.gov/api/census/area?lat=${addr.lat}&lon=${addr.lng}&format=json`
      );
      const fccData = await fccRes.json();
      const fips: string | undefined = fccData?.results?.[0]?.county_fips;

      if (!fips) {
        setLookupError('Could not match that address to a US county.');
        return;
      }

      const fullLabel = [addr.label, addr.sublabel].filter(Boolean).join(', ');
      setQuery('');
      setResults([]);
      setAddressResults([]);
      setOpen(false);
      onSelectCounty(fips, { lat: addr.lat, lng: addr.lng, name: fullLabel });
    } catch {
      setLookupError('Address lookup failed. Try again.');
    } finally {
      setResolvingAddress(false);
    }
  };

  const showDropdown = open && query.trim() !== '';
  const hasAnyResult = results.length > 0 || addressResults.length > 0;
  // The high-loss share is defined on all tracked hazards together
  const hazardsDisabled = measure === 'highLossPct';

  return (
    <div className="w-full space-y-4 mb-6">
      <div className="flex flex-wrap items-center justify-between gap-4">
        <div className="flex flex-wrap items-center gap-4">
          <div className="inline-flex p-1 bg-gray-200/80 rounded-full border border-gray-300/70">
            <button
              onClick={() => onViewModeChange('states')}
              className={`px-4 py-1 rounded-full text-xs font-semibold transition-all ${
                viewMode === 'states'
                  ? 'bg-[#1b232c] text-white shadow-xs'
                  : 'text-gray-700 hover:text-black'
              }`}
            >
              States
            </button>
            <button
              onClick={() => onViewModeChange('counties')}
              className={`px-4 py-1 rounded-full text-xs font-semibold transition-all ${
                viewMode === 'counties'
                  ? 'bg-[#1b232c] text-white shadow-xs'
                  : 'text-gray-700 hover:text-black'
              }`}
            >
              Counties
            </button>
          </div>

          <label className="flex items-center gap-2">
            <span className="text-xs text-gray-500 font-medium">Show</span>
            <select
              value={measure}
              onChange={(e) => onMeasureChange(e.target.value as Measure)}
              className="px-3 py-1.5 text-xs bg-white border border-gray-300 rounded-lg shadow-2xs font-medium text-gray-800 focus:outline-none"
            >
              {MEASURES.map((m) => (
                <option key={m.value} value={m.value} disabled={m.statesOnly && viewMode === 'counties'}>
                  {m.label}
                  {m.statesOnly && viewMode === 'counties' ? ' (states only)' : ''}
                </option>
              ))}
            </select>
          </label>
        </div>

        {/* Location search: street address, county name, city, or ZIP code */}
        <div className="relative">
          <input
            type="text"
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setOpen(true);
            }}
            onFocus={() => setOpen(true)}
            onBlur={() => setTimeout(() => setOpen(false), 150)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                if (results.length > 0) choose(results[0]);
                else if (addressResults.length > 0) chooseAddress(addressResults[0]);
              }
              if (e.key === 'Escape') setOpen(false);
            }}
            placeholder="Search an address, county, city, or ZIP"
            className="px-3 py-1.5 text-xs bg-white border border-gray-300 rounded-lg w-72 text-gray-900 placeholder:text-gray-400 focus:outline-none focus:ring-2 focus:ring-gray-900"
          />
          {showDropdown && (
            <ul className="absolute right-0 mt-1 w-80 z-[1000] bg-white border border-gray-200 rounded-lg shadow-lg overflow-hidden text-xs max-h-80 overflow-y-auto">
              {(searching || resolvingAddress) && !hasAnyResult && (
                <li className="px-3 py-2 text-gray-500 font-mono">
                  {resolvingAddress ? 'Resolving county...' : 'Searching...'}
                </li>
              )}
              {lookupError && (
                <li className="px-3 py-2 text-red-600 bg-red-50">{lookupError}</li>
              )}
              {!searching && !resolvingAddress && !hasAnyResult && !lookupError && (
                <li className="px-3 py-2 text-gray-500">No matching counties or addresses</li>
              )}

              {/* Counties / Cities / ZIP matches */}
              {results.length > 0 && (
                <li className="px-3 py-1 bg-gray-50 text-[10px] font-mono uppercase tracking-wider text-gray-400 border-b border-gray-100">
                  Counties &amp; Cities
                </li>
              )}
              {results.map((result) => (
                <li key={result.fips}>
                  <button
                    type="button"
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => choose(result)}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 cursor-pointer"
                  >
                    <span className="font-semibold text-gray-900">{result.name}</span>
                    <span className="text-gray-500">, {result.stateCode}</span>
                    {result.matchedPlace && (
                      <span className="block text-[10px] text-gray-400">via {result.matchedPlace}</span>
                    )}
                  </button>
                </li>
              ))}

              {/* Street Address matches */}
              {addressResults.length > 0 && (
                <li className="px-3 py-1 bg-gray-50 text-[10px] font-mono uppercase tracking-wider text-gray-400 border-y border-gray-100">
                  Addresses
                </li>
              )}
              {addressResults.map((addr) => (
                <li key={addr.id}>
                  <button
                    type="button"
                    disabled={resolvingAddress}
                    onMouseDown={(e) => e.preventDefault()}
                    onClick={() => chooseAddress(addr)}
                    className="w-full text-left px-3 py-2 hover:bg-gray-50 cursor-pointer disabled:opacity-50"
                  >
                    <span className="font-semibold text-gray-900 block truncate">{addr.label}</span>
                    {addr.sublabel && (
                      <span className="block text-[10px] text-gray-500 truncate">{addr.sublabel}</span>
                    )}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 pt-2 border-t border-gray-200/60 text-xs">
        <span className="text-gray-400 font-mono text-[11px] mr-1">Hazard:</span>
        {HAZARDS.map(({ label, key }) => (
          <button
            key={label}
            onClick={() => onHazardChange(key)}
            disabled={hazardsDisabled && key !== null}
            className={`px-3 py-1 rounded-full font-medium transition-colors cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed ${
              hazard === key
                ? 'bg-[#1b232c] text-white'
                : 'bg-white border border-gray-200 text-gray-700 hover:bg-gray-50'
            }`}
          >
            {label}
          </button>
        ))}
        {hazardsDisabled && (
          <span className="text-[10px] text-gray-500">
            High-loss counties are defined on all tracked hazards together.
          </span>
        )}
      </div>
    </div>
  );
}
