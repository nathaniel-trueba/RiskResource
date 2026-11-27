// frontend/components/map/StateInspector.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { StateRecord } from '@/lib/types';
import { TIER_STYLES } from '@/lib/riskColors';
import ExpectedLossSection from '@/components/map/ExpectedLossSection';
import WildfireModelSection from '@/components/map/WildfireModelSection';

interface Props {
  stateData: StateRecord;
  onDrillDown: () => void;
}

export default function StateInspector({ stateData, onDrillDown }: Props) {
  const [alertsExpanded, setAlertsExpanded] = useState(false);

  // Collapse the dropdown whenever the user selects a different state
  useEffect(() => {
    setAlertsExpanded(false);
  }, [stateData.code]);

  // Use structured alerts array if available; fallback to primaryAlert string
  const alertsList: string[] =
    stateData.alerts && stateData.alerts.length > 0
      ? stateData.alerts
      : stateData.primaryAlert
        ? [stateData.primaryAlert]
        : [];

  const headlineAlert = alertsList[0] ?? 'No active alerts';
  const extraAlerts = alertsList.slice(1);

  return (
    <aside className="w-full lg:w-88 bg-white border border-gray-200/90 rounded-2xl p-6 shadow-xs flex flex-col justify-between">
      <div>
        <div className="flex items-start justify-between">
          <div>
            <h2 className="text-2xl font-black text-gray-900 tracking-tight">{stateData.name}</h2>
            <p className="text-xs text-gray-500 font-mono mt-0.5">
              {stateData.countiesCount} counties · {stateData.population} residents
            </p>
          </div>
          <div className="text-right shrink-0">
            <span className="text-3xl font-black font-mono text-gray-900 block leading-none">
              {stateData.compositeScore}
              <span className="text-xs font-normal text-gray-400">/100</span>
            </span>
            <span className="inline-flex items-center justify-center text-center whitespace-nowrap text-[10px] font-semibold leading-none px-2.5 py-1 rounded-full mt-1.5"
              style={{ backgroundColor: TIER_STYLES[stateData.tier].color, color: TIER_STYLES[stateData.tier].text }}
            >
              {stateData.tier} Risk
            </span>
          </div>
        </div>

        {/* 2x2 Metric Grid */}
        <div className="grid grid-cols-2 gap-2 mt-4">
          <div className="p-2.5 bg-gray-50 border border-gray-200 rounded-xl">
            <span className="text-[10px] text-gray-500 block">Active Alerts</span>
            <span className="text-base font-bold text-gray-900 font-mono mt-0.5 block">
              {stateData.activeAlertCount === undefined
                ? 'Unavailable'
                : `${stateData.activeAlertCount} Warnings`}
            </span>
          </div>
          <div className="p-2.5 bg-gray-50 border border-gray-200 rounded-xl">
            <span className="text-[10px] text-gray-500 block">Threat Index</span>
            <span className="text-base font-bold text-gray-900 font-mono mt-0.5 flex items-center gap-1.5">
              <span
                className="inline-block w-2.5 h-2.5 rounded-full shrink-0"
                style={{ backgroundColor: TIER_STYLES[stateData.tier].color }}
              />
              {stateData.tier}
            </span>
          </div>
        </div>

		{/* Primary Alert Callout with Expandable Dropdown */}
        <div className="mt-3 p-3 bg-red-50/80 border border-red-200/70 rounded-xl">
          <span className="text-[10px] font-mono uppercase text-red-900 font-bold block">
            Live Advisory Summary
          </span>

          <div className="text-xs text-red-950 font-medium mt-0.5 leading-snug">
            <span>{headlineAlert}</span>

            {extraAlerts.length > 0 && (
              <button
                type="button"
                onClick={() => setAlertsExpanded((prev) => !prev)}
                aria-expanded={alertsExpanded}
                className="ml-1.5 inline-flex items-center gap-0.5 font-mono text-[11px] font-semibold text-red-800 hover:text-red-950 underline decoration-red-400 hover:decoration-red-800 cursor-pointer"
              >
                <span>
                  {alertsExpanded
                    ? 'Show less'
                    : `+${extraAlerts.length} other ${extraAlerts.length === 1 ? 'alert' : 'alerts'}`}
                </span>
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
            <ul className="mt-2.5 pt-2 border-t border-red-200/70 space-y-1.5 max-h-40 overflow-y-auto pr-1">
              {extraAlerts.map((alertText, idx) => (
                <li
                  key={`${alertText}-${idx}`}
                  className="text-[11px] text-red-950/90 leading-snug flex items-start gap-1.5"
                >
                  <span className="text-red-400 select-none">•</span>
                  <span>{alertText}</span>
                </li>
              ))}
            </ul>
          )}
        </div>

        {/* Hazard Breakdown with Live Drivers */}
        <div className="mt-5">
          <span className="text-[11px] font-mono uppercase tracking-wider text-gray-500 block mb-2.5 font-semibold">
            Hazard Scores & Drivers
          </span>

          <div className="space-y-3">
            {stateData.hazards.map((h) => (
              <div key={h.name} className="text-xs">
                <div className="flex justify-between items-center mb-1">
                  <span className="font-semibold text-gray-800">{h.name}</span>
                  <span className="font-mono font-bold text-gray-900">{h.score}/100</span>
                </div>
                <div className="w-full bg-gray-100 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full transition-all"
                    style={{
                      width: `${h.score}%`,
                      backgroundColor: TIER_STYLES[h.tier].color,
                    }}
                  />
                </div>
                <p className="text-[10px] text-gray-500 font-mono mt-0.5">{h.warning}</p>
              </div>
            ))}
          </div>
        </div>

        <WildfireModelSection model={stateData.wildfireModel} />

        <ExpectedLossSection loss={stateData.expectedLoss} kind="state" stateCode={stateData.code} />
      </div>

      <button
        type="button"
        onClick={onDrillDown}
        className="w-full mt-6 py-3 bg-[#1b232c] hover:bg-black text-white text-xs font-semibold rounded-xl transition-colors shadow-xs cursor-pointer"
      >
        View county breakdown →
      </button>
    </aside>
  );
}
