// frontend/components/map/ExpectedLossSection.tsx
'use client';

import React from 'react';
import { formatPct, formatUsd } from '@/lib/format';
import { EXPECTED_LOSS_NOTE, NRI_HAZARDS_INCLUDED, NRI_LINK } from '@/lib/nri';
import { HAZARD_COLORS } from '@/lib/riskColors';
import { CountyExpectedLoss, StateExpectedLoss } from '@/lib/types';

interface Props {
  // Undefined when NRI has no data for this area
  loss?: CountyExpectedLoss | StateExpectedLoss;
  kind: 'county' | 'state';
  areaName?: string;
  // For the no-data message: Connecticut counties have no NRI county data
  stateCode?: string;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="p-3 bg-gray-50 border border-gray-200 rounded-xl flex flex-col justify-between">
      <div>
        <span className="text-[10px] text-gray-500 block leading-tight">{label}</span>
        <span className="text-base font-bold text-gray-900 font-mono mt-1 block">{value}</span>
      </div>
      {hint && <span className="text-[10px] text-gray-500 block leading-tight mt-1">{hint}</span>}
    </div>
  );
}

/** FEMA NRI expected annual loss for a county or state, with what it does and doesn't cover. */
export default function ExpectedLossSection({ loss, kind, areaName, stateCode }: Props) {
  if (!loss) {
    return (
      <section className="mt-6 bg-white border border-gray-200/90 rounded-2xl p-6 shadow-xs">
        <SectionTitle areaName={areaName} />
        <p className="text-xs text-gray-500 leading-relaxed">
          {stateCode === 'CT'
            ? "FEMA's National Risk Index reports Connecticut by planning region, which don't line up with its former counties, so there's no county-level estimate. The state view includes all of Connecticut."
            : "FEMA's National Risk Index has no data for this area."}
        </p>
      </section>
    );
  }

  const county = kind === 'county' ? (loss as CountyExpectedLoss) : null;
  const state = kind === 'state' ? (loss as StateExpectedLoss) : null;
  const largest = loss.byHazard[0]?.amount || 1;
  const threshold = `${formatUsd(loss.highLossThresholdPerPerson)}+ per person/yr`;

  return (
    <section className="mt-6 bg-white border border-gray-200/90 rounded-2xl p-6 shadow-xs">
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pb-4 border-b border-gray-100">
        <SectionTitle areaName={areaName} />
        <span className="text-[10px] font-mono text-gray-400">FEMA National Risk Index</span>
      </div>

      <div className="mt-4 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left: Key Metrics */}
        <div className="lg:col-span-5 grid grid-cols-2 gap-2.5">
          <Stat label="Total per year" value={formatUsd(loss.total)} />
          <Stat
            label="Per person per year"
            value={loss.perPerson !== undefined ? formatUsd(loss.perPerson) : 'N/A'}
            hint={
              county?.lossPerPersonPercentile !== undefined
                ? `Higher than ${county.lossPerPersonPercentile}% of US counties`
                : undefined
            }
          />
          {state && (
            <div className="col-span-2">
              <Stat
                label="Residents in high-loss counties"
                value={
                  state.highLossPopulationPct !== undefined
                    ? formatPct(state.highLossPopulationPct)
                    : 'N/A'
                }
                hint={`Top ${100 - loss.highLossPercentile}% nationally (${threshold})`}
              />
            </div>
          )}
          {county && (
            <Stat
              label="High-loss county"
              value={county.isHighLoss ? 'Yes' : 'No'}
              hint={`Top ${100 - loss.highLossPercentile}% nationally (${threshold})`}
            />
          )}
          {county && (
            <Stat
              label="Social vulnerability"
              value={county.socialVulnerability ?? 'N/A'}
              hint="NRI rating, all hazards"
            />
          )}
          {county && (
            <div className="col-span-2">
              <Stat
                label="Community resilience"
                value={county.communityResilience ?? 'N/A'}
                hint="NRI rating, all hazards"
              />
            </div>
          )}
        </div>

        {/* Right: Loss by Hazard Breakdown */}
        <div className="lg:col-span-7">
          <span className="text-[10px] font-mono uppercase tracking-wider text-gray-400 block mb-2.5 font-semibold">
            Breakdown by Hazard
          </span>
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-6 gap-y-2.5">
            {loss.byHazard.map((h) => (
              <div
                key={h.name}
                className="text-xs"
                title={`Includes NRI: ${NRI_HAZARDS_INCLUDED[h.name] ?? h.name}`}
              >
                <div className="flex justify-between items-center mb-1">
                  <span className="font-medium text-gray-800">{h.name}</span>
                  <span className="font-mono font-semibold text-gray-900">
                    {formatUsd(h.amount)}/yr
                  </span>
                </div>
                <div className="w-full bg-gray-100 h-1.5 rounded-full overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${(100 * h.amount) / largest}%`,
                      backgroundColor: HAZARD_COLORS[h.name] ?? '#9ca3af',
                    }}
                  />
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}

function SectionTitle({ areaName }: { areaName?: string }) {
  return (
    <span className="text-[11px] font-mono uppercase tracking-wider text-gray-600 font-semibold">
      Expected Annual Loss{areaName ? ` · ${areaName}` : ''} (FEMA Estimate)
    </span>
  );
}
