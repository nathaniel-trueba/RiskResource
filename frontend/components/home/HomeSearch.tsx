// frontend/components/home/HomeSearch.tsx
'use client';

import React, { useState } from 'react';
import { useRouter } from 'next/navigation';

const SUGGESTIONS = ['Palm Springs, CA', 'Santa Rosa, CA', 'Fresno, CA', 'San Diego, CA'];

// Sends the search to the map page, which resolves it with /api/search and opens
// the best matching county.
export default function HomeSearch() {
  const [query, setQuery] = useState('');
  const router = useRouter();

  const go = (text: string) => {
    const trimmed = text.trim();
    if (trimmed) router.push(`/map?q=${encodeURIComponent(trimmed)}`);
  };

  return (
    <>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          go(query);
        }}
        className="mt-8 flex items-center bg-[#1d1914] border border-white/10 rounded-2xl p-1.5 max-w-lg focus-within:border-[#e29b4d]/60 transition-colors shadow-lg"
      >
        <span className="pl-3.5 pr-2 text-gray-500 text-base">🔍</span>
        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search a county, city or ZIP code"
          className="w-full bg-transparent text-base text-white placeholder-gray-500 focus:outline-none py-3"
        />
        <button
          type="submit"
          className="px-6 py-3 bg-[#e29b4d] hover:bg-[#c98335] text-black font-semibold text-sm rounded-xl transition-all whitespace-nowrap cursor-pointer shrink-0"
        >
          Find my risk
        </button>
      </form>

      {/* Location chips */}
      <div className="mt-4 flex flex-wrap items-center gap-2 text-xs text-gray-500">
        <span className="font-mono text-xs">Try:</span>
        {SUGGESTIONS.map((loc) => (
          <button
            key={loc}
            type="button"
            onClick={() => go(loc)}
            className="px-3.5 py-1.5 rounded-full bg-[#1d1914] border border-white/10 text-gray-300 text-xs cursor-pointer hover:border-white/30 transition-colors"
          >
            {loc}
          </button>
        ))}
      </div>
    </>
  );
}
