
'use client';

import React, { useState } from 'react';
import Link from 'next/link';

interface CountyScore {
  name: string;
  state: string;
  area: string;
  score: number;
  rating: string;
  hazards: {
    name: string;
    score: number;
    color: string;
  }[];
}

const COUNTIES_DATA: Record<string, CountyScore> = {
  'Palm Springs': {
    name: 'Riverside County',
    state: 'California',
    area: 'Palm Springs area',
    score: 79,
    rating: 'Very high',
    hazards: [
      { name: 'Wildfire', score: 88, color: '#e65100' },
      { name: 'Earthquake', score: 84, color: '#c49a45' },
      { name: 'Flood', score: 14, color: '#4a72b2' },
      { name: 'Hurricane', score: 0, color: '#2a9d8f' },
      { name: 'Tornado', score: 3, color: '#7b52ab' },
    ],
  },
  'Santa Rosa': {
    name: 'Sonoma County',
    state: 'California',
    area: 'Santa Rosa area',
    score: 63,
    rating: 'Relatively high',
    hazards: [
      { name: 'Wildfire', score: 80, color: '#e65100' },
      { name: 'Earthquake', score: 67, color: '#c49a45' },
      { name: 'Flood', score: 0, color: '#4a72b2' },
      { name: 'Hurricane', score: 0, color: '#2a9d8f' },
      { name: 'Tornado', score: 0, color: '#7b52ab' },
    ],
  },
  Fresno: {
    name: 'Fresno County',
    state: 'California',
    area: 'Central Valley',
    score: 58,
    rating: 'Relatively moderate',
    hazards: [
      { name: 'Wildfire', score: 62, color: '#e65100' },
      { name: 'Earthquake', score: 45, color: '#c49a45' },
      { name: 'Flood', score: 32, color: '#4a72b2' },
      { name: 'Hurricane', score: 0, color: '#2a9d8f' },
      { name: 'Tornado', score: 5, color: '#7b52ab' },
    ],
  },
  'San Diego': {
    name: 'San Diego County',
    state: 'California',
    area: 'San Diego area',
    score: 65,
    rating: 'Relatively high',
    hazards: [
      { name: 'Wildfire', score: 81, color: '#e65100' },
      { name: 'Earthquake', score: 70, color: '#c49a45' },
      { name: 'Flood', score: 2, color: '#4a72b2' },
      { name: 'Hurricane', score: 0, color: '#2a9d8f' },
      { name: 'Tornado', score: 0, color: '#7b52ab' },
    ],
  },
};

export default function HeroScoreCard() {
  const [selectedKey, setSelectedKey] = useState<string>('Santa Rosa');
  const data = COUNTIES_DATA[selectedKey];

  return (
    <div className="bg-[#FFFCF7] border border-[#E4D9C9] rounded-3xl p-7 sm:p-8 shadow-xl relative">

      {/* Location pills */}
      <div className="flex flex-wrap items-center gap-2 mb-7">
        {Object.keys(COUNTIES_DATA).map((key) => {
          const active = selectedKey === key;

          return (
            <button
              key={key}
              type="button"
              onClick={() => setSelectedKey(key)}
              className={`px-3.5 py-2 rounded-full text-sm border transition-colors cursor-pointer ${
                active
                  ? 'bg-[#29211B] text-white font-semibold border-[#29211B]'
                  : 'bg-transparent text-[#71685F] hover:text-[#29211B] border-[#E4D9C9] hover:border-[#B87530]'
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
              className="text-[#E8DED0]"
              strokeWidth="3.2"
              stroke="currentColor"
              fill="none"
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            />

            <path
              className="text-[#D9954E]"
              strokeDasharray={`${data.score}, 100`}
              strokeWidth="3.2"
              strokeLinecap="round"
              stroke="currentColor"
              fill="none"
              d="M18 2.0845 a 15.9155 15.9155 0 0 1 0 31.831 a 15.9155 15.9155 0 0 1 0 -31.831"
            />

          </svg>

          <div className="absolute flex flex-col items-center justify-center">
            <span className="text-3xl font-extrabold text-[#29211B] leading-none">
              {data.score}
            </span>

            <span className="text-[9px] font-mono uppercase text-[#968B7E] tracking-tight mt-1">
              OF 100
            </span>
          </div>

        </div>

        <div>
          <h3 className="font-display text-2xl font-bold text-[#29211B] tracking-tight leading-tight">
            {data.name}
          </h3>

          <p className="text-sm text-[#71685F] mt-1">
            {data.state} · {data.area}
          </p>

          <span className="inline-block mt-2.5 px-3 py-1 rounded-full bg-[#F5E8D8] text-[#89531F] text-xs font-medium">
            {data.rating}
          </span>
        </div>

      </div>

      {/* Hazard bars */}
      <div className="space-y-4 mb-7">

        {data.hazards.map((hazard) => (
          <div key={hazard.name} className="flex items-center justify-between">

            <span className="w-24 text-[#50473E] text-sm">
              {hazard.name}
            </span>

            <div className="flex-1 mx-3 h-2.5 bg-[#E8DED0] rounded-full overflow-hidden relative">

              <div
                className="h-full rounded-full transition-all duration-500"
                style={{
                  width: `${Math.max(hazard.score, hazard.score > 0 ? 3 : 0)}%`,
                  backgroundColor: hazard.color,
                }}
              />

            </div>

            <span className="w-8 text-right font-mono text-[#50473E] text-sm">
              {hazard.score}
            </span>

          </div>
        ))}

      </div>

      {/* Footer */}
      <div className="flex items-center justify-between pt-5 border-t border-[#E4D9C9]">

        <span className="px-2.5 py-1 rounded-full bg-[#F8EEDB] border border-[#E8D6B5] text-[#94611F] text-[10px] font-mono uppercase tracking-wider">
          Sample values
        </span>

        <Link
          href={`/map?q=${encodeURIComponent(data.name)}`}
          className="text-[#A96521] hover:text-[#804817] text-sm font-medium hover:underline"
        >
          Open on the map →
        </Link>

      </div>

    </div>
  );
}
