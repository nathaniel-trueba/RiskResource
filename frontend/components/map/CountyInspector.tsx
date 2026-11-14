// frontend/components/map/CountyInspector.tsx
'use client';

import React from 'react';
import { FemaCountyRecord } from '@/lib/types';
import { RATINGS, NO_DATA, money, fmtInt } from '@/lib/mockRiskData';

interface Props {
  countyRecord: FemaCountyRecord | null;
  fallbackName?: string;
  source: string;
  version: string;
}

export default function CountyInspector({ countyRecord, fallbackName, source, version }: Props) {
  if (!countyRecord) {
    return (
      <aside className="w-full lg:w-[340px] bg-white border border-[#e2e0db] rounded-xl flex flex-col justify-between overflow-y-auto">
        <div className="p-5">
          {fallbackName ? (
            <>
              <h2 className="text-xl font-bold text-[#1d232b] m-0">{fallbackName}</h2>
              <p className="text-xs text-[#5f6b78] mt-1 mb-4">No FEMA data matched this area.</p>
              <p className="text-xs text-[#5f6b78]">
                The boundary file uses older county lines in a few places (Connecticut&apos;s 2022 switch to planning
                regions, for example), so those areas don&apos;t line up with FEMA&apos;s latest data yet.
              </p>
            </>
          ) : (
            <p className="text-sm text-[#5f6b78]">Click a county to see its details.</p>
          )}
        </div>
        <footer className="px-5 py-3 text-xs text-[#5f6b78] border-t border-[#e2e0db]">
          Data:{' '}
          <a href="https://hazards.fema.gov/nri/" target="_blank" rel="noopener noreferrer" className="underline">
            {source}
          </a>
          , {version}
        </footer>
      </aside>
    );
  }

  const rating = RATINGS.find((x) => x.label === countyRecord.risk_rating) || { color: NO_DATA };
  const dark = ['Very High', 'Relatively High'].includes(countyRecord.risk_rating);
  const maxEal = countyRecord.top_hazards?.[0]?.eal || 1;

  return (
    <aside className="w-full lg:w-[340px] bg-white border border-[#e2e0db] rounded-xl flex flex-col justify-between overflow-y-auto">
      <div className="p-5">
        <h2 className="text-xl font-bold text-[#1d232b] m-0">{countyRecord.name}</h2>
        <p className="text-xs text-[#5f6b78] mt-1 mb-3">
          {countyRecord.state} · {fmtInt(countyRecord.population)} people
        </p>

        <span
          className="inline-block px-2.5 py-1 rounded-full text-xs font-semibold mb-4"
          style={{
            backgroundColor: rating.color,
            color: dark ? '#ffffff' : '#1d232b',
          }}
        >
          {countyRecord.risk_rating} risk
        </span>

        <div className="grid grid-cols-2 gap-2.5 mb-5">
          <div className="p-2.5 border border-[#e2e0db] rounded-lg">
            <div className="text-[11px] text-[#5f6b78] uppercase tracking-wider">Risk score</div>
            <div className="text-base font-semibold mt-0.5 tabular-nums">
              {countyRecord.risk_score == null ? '-' : countyRecord.risk_score.toFixed(1)}
            </div>
          </div>
          <div className="p-2.5 border border-[#e2e0db] rounded-lg">
            <div className="text-[11px] text-[#5f6b78] uppercase tracking-wider">Loss per person / yr</div>
            <div className="text-base font-semibold mt-0.5 tabular-nums">{money(countyRecord.eal_per_person)}</div>
          </div>
          <div className="p-2.5 border border-[#e2e0db] rounded-lg">
            <div className="text-[11px] text-[#5f6b78] uppercase tracking-wider">Social vulnerability</div>
            <div className="text-base font-semibold mt-0.5 tabular-nums">
              {countyRecord.sovi_score == null ? '-' : countyRecord.sovi_score.toFixed(1)}
            </div>
          </div>
          <div className="p-2.5 border border-[#e2e0db] rounded-lg">
            <div className="text-[11px] text-[#5f6b78] uppercase tracking-wider">Community resilience</div>
            <div className="text-base font-semibold mt-0.5 tabular-nums">
              {countyRecord.resl_score == null ? '-' : countyRecord.resl_score.toFixed(1)}
            </div>
          </div>
        </div>

        <h3 className="text-xs uppercase tracking-wider text-[#5f6b78] font-semibold mb-2.5">
          Biggest hazards (expected annual loss)
        </h3>
        {countyRecord.top_hazards && countyRecord.top_hazards.length > 0 ? (
          <ul className="list-none m-0 p-0 space-y-2.5">
            {countyRecord.top_hazards.map((h) => (
              <li key={h.hazard} className="text-xs">
                <div className="flex justify-between mb-1">
                  <span>{h.hazard}</span>
                  <span>{money(h.eal)}/yr</span>
                </div>
                <div className="h-1.5 bg-[#f6f5f2] rounded-xs overflow-hidden">
                  <span
                    className="block h-full bg-[#b8321f]"
                    style={{ width: `${((100 * h.eal) / maxEal).toFixed(0)}%` }}
                  />
                </div>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-xs text-[#5f6b78]">No hazard losses reported.</p>
        )}

        <p className="text-xs text-[#5f6b78] mt-4">
          Scores are national percentiles from 0 to 100. Higher risk and vulnerability are worse; higher resilience is
          better.
        </p>
      </div>

      <footer className="px-5 py-3 text-xs text-[#5f6b78] border-t border-[#e2e0db]">
        Data:{' '}
        <a href="https://hazards.fema.gov/nri/" target="_blank" rel="noopener noreferrer" className="underline">
          {source}
        </a>
        , {version}
      </footer>
    </aside>
  );
}
