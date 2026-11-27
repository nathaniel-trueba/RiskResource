// frontend/components/map/CountyInspector.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { CountyRecord } from '@/lib/types';
import { TIER_STYLES } from '@/lib/riskColors';
import ExpectedLossSection from '@/components/map/ExpectedLossSection';
import WildfireModelSection from '@/components/map/WildfireModelSection';

interface Props {
  county: CountyRecord;
  onBackToState: () => void;
}

export default function CountyInspector({ county, onBackToState }: Props) {
  const [alertsExpanded, setAlertsExpanded] = useState(false);

  // Collapse the dropdown when switching counties
  useEffect(() => {
    setAlertsExpanded(false);
  }, [county.fips, county.name]);

  // Use structured alerts array if available; fallback to activeAlert string
  const alertsList: string[] =
    county.alerts && county.alerts.length > 0
      ? county.alerts
      : county.activeAlert
        ? [county.activeAlert]
        : [];

  const headlineAlert = alertsList[0] ?? 'No active alerts';
  const extraAlerts = alertsList.slice(1);

  return (
    <aside className="w-full lg:w-88 bg-white border border-gray-200/90 rounded-2xl p-6 shadow-xs flex flex-col justify-between">
      <div>
        {/* Navigation breadcrumb */}
        <div className="flex items-center justify-between pb-3 border-b border-gray-100">
          <button
            type="button"
            onClick={onBackToState}
            className="text-xs text-gray-500 hover:text-black flex items-center gap-1 font-mono cursor-pointer"
          >
            ← Back to {county.state}
          </button>
          <span className="text-[10px] font-mono text-gray-400">FIPS: {county.fips}</span>
        </div>

        {/* Header */}
        <div className="mt-4 flex items-start justify-between">
          <div>
            <h2 className="text-xl font-black text-gray-950 tracking-tight">{county.name}</h2>
            <p className="text-xs text-gray-500 font-mono mt-0.5">Pop: {county.pop}</p>
          </div>
          <div className="text-right shrink-0">
            <span className="text-2xl font-black font-mono text-gray-900 block leading-none">
              {county.compositeScore}
              <span className="text-xs font-normal text-gray-400">/100</span>
            </span>
            <span
              className={`inline-flex items-center justify-center text-center whitespace-nowrap text-[10px] font-semibold leading-none px-2.5 py-1 rounded-full mt-1.5`}
              style={{ backgroundColor: TIER_STYLES[county.tier].color, color: TIER_STYLES[county.tier].text }}
            >
              {county.tier}
            </span>
          </div>
        </div>

		{/* Live Warning Banner with Expandable Dropdown */}
        <div className="mt-4 p-3 bg-amber-50 border border-amber-200/80 rounded-xl">
          <div className="flex items-center gap-1.5 text-xs font-semibold text-amber-900">
            <span className="inline-block w-2 h-2 rounded-full bg-amber-600 animate-pulse" />
            {alertsList.length > 1 ? 'Live Advisories' : 'Live Advisory'}
          </div>

          <div className="text-[11px] text-amber-800 mt-1 leading-snug">
            <span>{headlineAlert}</span>

            {extraAlerts.length > 0 && (
              <button
                type="button"
                onClick={() => setAlertsExpanded((prev) => !prev)}
                aria-expanded={alertsExpanded}
                className="ml-1.5 inline-flex items-center gap-0.5 font-mono text-[11px] font-semibold text-amber-900 hover:text-amber-950 underline decoration-amber-400 hover:decoration-amber-800 cursor-pointer"
              >
                <span>{alertsExpanded ? 'Show less' : `+${extraAlerts.length} more`}</span>
                <svg
                  className={`w-3 h-3 transition-transform duration-150 ${alertsExpanded ? 'rotate-180' : ''}`}
                  viewBox="0 0 20 20"
                  fill="currentColor"
                  aria-hidden="true"
                >
                  <path
                    fillRule="evenodd"
                    d="M5.23 7.21a.75.75 0 011.06.02L10 11.168l3.71-3.938a.75.75 0 111.08 1.04l-4.25 4.5a.75.75 0 01-1.08 0l-4.25-4.5a.75.75 0 01.02-1.06z"
                    clipRule="evenodd"
                  />
                </svg>
              </button>
            )}
          </div>

          {alertsExpanded && extraAlerts.length > 0 && (
            <ul className="mt-2.5 pt-2 border-t border-amber-200/80 space-y-1.5 max-h-40 overflow-y-auto pr-1">
              {extraAlerts.map((alertText, idx) => (
                <li
                  key={`${alertText}-${idx}`}
                  className="text-[11px] text-amber-900/90 leading-snug flex items-start gap-1.5"
                >
                  <span className="text-amber-500 select-none">•</span>
                  <span>{alertText}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Sub-Hazard Scoring Breakdown */}
        <div className="mt-6">
          <span className="text-[11px] font-mono uppercase tracking-wider text-gray-500 block mb-3 font-semibold">
            Hazard Scores & Active Conditions
          </span>

          <div className="space-y-3.5">
            {county.hazards.map((h) => (
              <div key={h.name} className="text-xs">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-semibold text-gray-900">{h.name}</span>
                  <span className="font-mono font-bold text-gray-800">{h.score}/100</span>
                </div>
                <div className="w-full bg-gray-100 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all duration-300"
                    style={{
                      width: `${h.score}%`,
                      backgroundColor: TIER_STYLES[h.tier].color,
                    }}
                  />
                </div>
                <p className="text-[10px] text-gray-500 font-mono mt-1 leading-tight">{h.warning}</p>
              </div>
            ))}
          </div>
        </div>

        <WildfireModelSection model={county.wildfireModel} />

        <ExpectedLossSection loss={county.expectedLoss} kind="county" stateCode={county.stateCode} />
      </div>

      <div className="pt-4 border-t border-gray-100 text-[10px] text-gray-400 font-mono flex items-center justify-between">
        <span>Scores: FEMA/USGS history, live feeds, wildfire model · Losses: FEMA NRI</span>
        <span className="text-emerald-600 font-semibold">● Active</span>
      </div>
    </aside>
  );
}
