// frontend/components/map/StateInspector.tsx
'use client';

import React from 'react';
import { FemaStateRecord } from '@/lib/types';
import { money, fmtInt } from '@/lib/mockRiskData';

interface Props {
  stateRecord: FemaStateRecord | null;
  fallbackName?: string;
  source: string;
  version: string;
}

export default function StateInspector({ stateRecord, fallbackName, source, version }: Props) {
  if (!stateRecord) {
    return (
      <aside className="w-full lg:w-[340px] bg-white border border-[#e2e0db] rounded-xl flex flex-col justify-between overflow-y-auto">
        <div className="p-5">
          {fallbackName ? (
            <>
              <h2 className="text-xl font-bold text-[#1d232b] m-0">{fallbackName}</h2>
              <p className="text-xs text-[#5f6b78] mt-1 mb-4">No FEMA data matched this area.</p>
            </>
          ) : (
            <p className="text-sm text-[#5f6b78]">Click a state to see its details.</p>
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

  const maxEal = stateRecord.top_hazards?.[0]?.eal || 1;

  return (
    <aside className="w-full lg:w-[340px] bg-white border border-[#e2e0db] rounded-xl flex flex-col justify-between overflow-y-auto">
      <div className="p-5">
        <h2 className="text-xl font-bold text-[#1d232b] m-0">{stateRecord.name}</h2>
        <p className="text-xs text-[#5f6b78] mt-1 mb-4">
          {stateRecord.counties} counties · {fmtInt(stateRecord.population)} people
        </p>

        <div className="grid grid-cols-2 gap-2.5 mb-5">
          <div className="p-2.5 border border-[#e2e0db] rounded-lg">
            <div className="text-[11px] text-[#5f6b78] uppercase tracking-wider">Loss per person / yr</div>
            <div className="text-base font-semibold mt-0.5 tabular-nums">{money(stateRecord.eal_per_person)}</div>
          </div>
          <div className="p-2.5 border border-[#e2e0db] rounded-lg">
            <div className="text-[11px] text-[#5f6b78] uppercase tracking-wider">Total loss / yr</div>
            <div className="text-base font-semibold mt-0.5 tabular-nums">{money(stateRecord.eal_total)}</div>
          </div>
          <div className="p-2.5 border border-[#e2e0db] rounded-lg">
            <div className="text-[11px] text-[#5f6b78] uppercase tracking-wider">People in high-risk counties</div>
            <div className="text-base font-semibold mt-0.5 tabular-nums">{stateRecord.pct_pop_high_risk}%</div>
          </div>
          <div className="p-2.5 border border-[#e2e0db] rounded-lg">
            <div className="text-[11px] text-[#5f6b78] uppercase tracking-wider">High-risk counties</div>
            <div className="text-base font-semibold mt-0.5 tabular-nums">{stateRecord.high_risk_counties}</div>
          </div>
        </div>

        <h3 className="text-xs uppercase tracking-wider text-[#5f6b78] font-semibold mb-2.5">
          Biggest hazards (expected annual loss)
        </h3>
        {stateRecord.top_hazards && stateRecord.top_hazards.length > 0 ? (
          <ul className="list-none m-0 p-0 space-y-2.5">
            {stateRecord.top_hazards.map((h) => (
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
          &ldquo;High-risk&rdquo; means FEMA rated the county Relatively High or Very High.
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
