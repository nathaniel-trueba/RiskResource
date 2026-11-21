// frontend/components/home/HeroScoreCard.tsx
'use client';

import React, { useEffect, useState } from 'react';
import Link from 'next/link';
import { fetchCounty } from '@/lib/api';
import { HAZARD_COLORS } from '@/lib/riskColors';
import { CountyRecord } from '@/lib/types';

// Preset locations, each with the county the backend scores it by.
const PRESETS: Record<string, { fips: string; area: string }> = {
  'Palm Springs': { fips: '06065', area: 'Palm Springs area' },
  'Santa Rosa': { fips: '06097', area: 'Santa Rosa area' },
  Fresno: { fips: '06019', area: 'Central Valley' },
  'San Diego': { fips: '06073', area: 'San Diego area' },
};

export default function HeroScoreCard() {
  const [selectedKey, setSelectedKey] = useState<string>('Santa Rosa');
  // Fetched counties by FIPS, so switching back to a preset doesn't refetch it.
  const [counties, setCounties] = useState<Record<string, CountyRecord>>({});
  const [failed, setFailed] = useState<Record<string, boolean>>({});

  const preset = PRESETS[selectedKey];
  const county = counties[preset.fips];

  useEffect(() => {
    if (county) return;
    const fips = preset.fips;
    fetchCounty(fips)
      .then((record) => {
        setCounties((cached) => ({ ...cached, [fips]: record }));
        setFailed((cached) => ({ ...cached, [fips]: false }));
      })
      .catch(() => setFailed((cached) => ({ ...cached, [fips]: true })));
  }, [county, preset.fips]);

  const score = county?.compositeScore ?? 0;
  const status = failed[preset.fips] ? 'Backend unavailable' : 'Loading...';
  const data = {
    name: county?.name ?? status,
    state: county?.state ?? '',
    area: preset.area,
    score,
    rating: county ? `${county.tier} risk` : status,
    hazards: (county?.hazards ?? []).map((h) => ({
      name: h.name,
      score: h.score,
      color: HAZARD_COLORS[h.name] ?? '#9ca3af',
    })),
  };

  return (
    <div className="bg-white border border-[#e5e0d5] shadow-md dark:bg-[#1d1914] dark:border-white/10 dark:shadow-2xl rounded-3xl p-7 sm:p-8 relative transition-colors">
      {/* Location pills */}
      <div className="flex flex-wrap items-center gap-2 mb-7">
        {Object.keys(PRESETS).map((key) => {
          const active = selectedKey === key;
          return (
            <button
              key={key}
              type="button"
              onClick={() => setSelectedKey(key)}
              className={`px-3.5 py-2 rounded-full text-sm border transition-colors cursor-pointer ${
                active
                  ? 'bg-gray-900 text-white font-semibold border-transparent dark:bg-[#efe8dd] dark:text-black'
                  : 'bg-[#f5f2eb] text-gray-600 hover:text-gray-900 border-[#e5e0d5] hover:border-gray-400 dark:bg-transparent dark:text-gray-400 dark:hover:text-white dark:border-white/10 dark:hover:border-white/30'
              }`}
            >
              {key}
            </button>
          );
        })}
      </div>

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
              className="text-amber-600 dark:text-[#e29b4d]"
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
      <div className="flex items-center justify-between pt-5 border-t border-[#e5e0d5] dark:border-white/10">
        <span className="px-2.5 py-1 rounded-full bg-amber-50 border border-amber-200 text-amber-800 dark:bg-amber-400/10 dark:border-amber-400/20 dark:text-amber-300/90 text-[10px] font-mono uppercase tracking-wider">
          Live data
        </span>
        <Link
          href={`/map?fips=${preset.fips}`}
          className="text-amber-700 hover:text-amber-800 dark:text-amber-400 dark:hover:text-amber-300 text-sm font-medium hover:underline"
        >
          Open on the map →
        </Link>
      </div>
    </div>
  );
}
