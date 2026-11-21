// frontend/components/home/HomeSearch.tsx
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

interface Suggestion {
  id: string;
  label: string;
  sublabel: string;
  lat: number;
  lng: number;
}

const SUGGESTED_LOCATIONS = [
  { label: 'Palm Springs, CA', fips: '06065', lat: 33.8303, lng: -116.5453 },
  { label: 'Santa Rosa, CA', fips: '06097', lat: 38.4404, lng: -122.7141 },
  { label: 'Fresno, CA', fips: '06019', lat: 36.7378, lng: -119.7871 },
  { label: 'San Diego, CA', fips: '06073', lat: 32.7157, lng: -117.1611 },
];

export default function HomeSearch() {
  const [query, setQuery] = useState('');
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [showDropdown, setShowDropdown] = useState(false);
  const [locating, setLocating] = useState(false);
  const wrapperRef = useRef<HTMLDivElement>(null);
  const router = useRouter();

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target as Node)) {
        setShowDropdown(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced US address autocomplete via Photon (OpenStreetMap)
  useEffect(() => {
    const trimmed = query.trim();
    if (trimmed.length < 3) {
      setSuggestions([]);
      return;
    }

    const controller = new AbortController();
    const timer = setTimeout(async () => {
      try {
        // bbox restricts suggestions to the United States
        const res = await fetch(
          `https://photon.komoot.io/api/?q=${encodeURIComponent(trimmed)}&bbox=-179.15,18.91,-66.95,71.39&limit=5`,
          { signal: controller.signal }
        );
        const data = await res.json();

        const formatted: Suggestion[] = (data.features || [])
          .filter((f: any) => f.properties?.countrycode === 'US')
          .map((f: any, idx: number) => {
            const p = f.properties || {};
            const [lng, lat] = f.geometry.coordinates;
            const street = [p.housenumber, p.street].filter(Boolean).join(' ');
            const primary = street || p.name || p.city || trimmed;
            const secondary = [p.city !== primary ? p.city : null, p.county, p.state, p.postcode]
              .filter(Boolean)
              .join(', ');

            return {
              id: `${p.osm_id || idx}-${lat}-${lng}`,
              label: primary,
              sublabel: secondary,
              lat,
              lng,
            };
          });

        setSuggestions(formatted);
        setShowDropdown(formatted.length > 0);
      } catch (err: any) {
        if (err.name !== 'AbortError') setSuggestions([]);
      }
    }, 280);

    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [query]);

  // Convert coordinates -> 5-digit County FIPS and route to /map
  const goToLocation = async (lat: number, lng: number, displayName: string) => {
    setLocating(true);
    setShowDropdown(false);

    try {
      const fccRes = await fetch(
        `https://geo.fcc.gov/api/census/area?lat=${lat}&lon=${lng}&format=json`
      );
      const fccData = await fccRes.json();
      const countyFips = fccData?.results?.[0]?.county_fips;

      if (countyFips) {
        router.push(
          `/map?fips=${countyFips}&lat=${lat}&lng=${lng}&name=${encodeURIComponent(displayName)}`
        );
        return;
      }
    } catch {
      // Fall back to lat/lng + name if FCC lookup fails
    } finally {
      setLocating(false);
    }

    router.push(`/map?lat=${lat}&lng=${lng}&name=${encodeURIComponent(displayName)}`);
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = query.trim();
    if (!trimmed) {
      router.push('/map');
      return;
    }

    // If dropdown already has a top match, use it immediately
    if (suggestions.length > 0) {
      const top = suggestions[0];
      const fullLabel = top.sublabel ? `${top.label}, ${top.sublabel}` : top.label;
      await goToLocation(top.lat, top.lng, fullLabel);
      return;
    }

    // Otherwise geocode the submitted text directly
    setLocating(true);
    try {
      const res = await fetch(
        `https://nominatim.openstreetmap.org/search?format=json&countrycodes=us&limit=1&q=${encodeURIComponent(trimmed)}`
      );
      const results = await res.json();
      if (Array.isArray(results) && results.length > 0) {
        const hit = results[0];
        const shortName = hit.display_name.split(',').slice(0, 3).join(',');
        await goToLocation(parseFloat(hit.lat), parseFloat(hit.lon), shortName);
        return;
      }
    } catch {
      // Fall back to backend county text search
    } finally {
      setLocating(false);
    }

    router.push(`/map?q=${encodeURIComponent(trimmed)}`);
  };

  return (
    <div ref={wrapperRef} className="relative max-w-md">
      {/* Unified Search Capsule */}
      <form
        onSubmit={handleSubmit}
        className="mt-8 flex items-center bg-white border border-[#e5e0d5] dark:bg-[#181613] dark:border-white/10 rounded-2xl p-1.5 focus-within:border-amber-500 dark:focus-within:border-[#e29b4d]/60 transition-colors shadow-sm"
      >
        <input
          type="text"
          value={query}
          onFocus={() => suggestions.length > 0 && setShowDropdown(true)}
          onChange={(e) => {
            setQuery(e.target.value);
            setShowDropdown(true);
          }}
          placeholder="Search any US address, city, or ZIP"
          autoComplete="off"
          className="w-full bg-transparent text-sm text-gray-900 placeholder-gray-400 dark:text-white dark:placeholder-gray-500 focus:outline-none pl-3.5 pr-2 py-2"
        />
        <button
          type="submit"
          disabled={locating}
          className="px-5 py-2.5 bg-amber-600 hover:bg-amber-700 disabled:opacity-60 text-white dark:bg-[#e29b4d] dark:hover:bg-[#c98335] dark:text-black font-semibold text-xs rounded-xl transition-all whitespace-nowrap cursor-pointer shrink-0 active:scale-95"
        >
          {locating ? 'Locating...' : 'Find my risk'}
        </button>
      </form>

      {/* Autocomplete Suggestions Dropdown */}
      {showDropdown && suggestions.length > 0 && (
        <ul className="absolute z-40 left-0 right-0 mt-1.5 bg-white border border-[#e5e0d5] dark:bg-[#1d1914] dark:border-white/15 rounded-2xl shadow-xl overflow-hidden divide-y divide-gray-100 dark:divide-white/10">
          {suggestions.map((item) => {
            const fullLabel = item.sublabel ? `${item.label}, ${item.sublabel}` : item.label;
            return (
              <li key={item.id}>
                <button
                  type="button"
                  onClick={() => {
                    setQuery(fullLabel);
                    goToLocation(item.lat, item.lng, fullLabel);
                  }}
                  className="w-full text-left px-4 py-2.5 hover:bg-[#f5f2eb] dark:hover:bg-white/5 transition-colors cursor-pointer"
                >
                  <span className="block text-xs font-semibold text-gray-900 dark:text-white truncate">
                    {item.label}
                  </span>
                  {item.sublabel && (
                    <span className="block text-[11px] text-gray-500 dark:text-gray-400 truncate mt-0.5">
                      {item.sublabel}
                    </span>
                  )}
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {/* Location Chips */}
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span className="font-mono text-[11px]">Try:</span>
        {SUGGESTED_LOCATIONS.map((loc) => (
          <button
            key={loc.label}
            type="button"
            onClick={() =>
              router.push(
                `/map?fips=${loc.fips}&lat=${loc.lat}&lng=${loc.lng}&name=${encodeURIComponent(loc.label)}`
              )
            }
            className="px-3 py-1 rounded-full bg-white border border-[#e5e0d5] text-gray-700 hover:border-gray-400 dark:bg-[#181613] dark:border-white/10 dark:text-gray-300 dark:hover:border-white/30 text-[11px] cursor-pointer transition-colors shadow-2xs"
          >
            {loc.label}
          </button>
        ))}
      </div>
    </div>
  );
}
