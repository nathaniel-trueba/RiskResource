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
  // For the no-data message: Connecticut counties have no NRI county data
  stateCode?: string;
}

function Stat({ label, value, hint }: { label: string; value: string; hint?: string }) {
  return (
    <div className="p-2.5 bg-gray-50 border border-gray-200 rounded-xl">
      <span className="text-[10px] text-gray-500 block leading-tight">{label}</span>
      <span className="text-base font-bold text-gray-900 font-mono mt-0.5 block">{value}</span>
      {hint && <span className="text-[10px] text-gray-500 block leading-tight mt-0.5">{hint}</span>}
    </div>
  );
}

/** FEMA NRI expected annual loss for a county or state, with what it does and doesn't cover. */
export default function ExpectedLossSection({ loss, kind, stateCode }: Props) {
  if (!loss) {
    return (
      <div className="mt-6">
        <SectionTitle />
        <p className="text-[11px] text-gray-500 leading-snug">
          {stateCode === 'CT'
            ? "FEMA's National Risk Index reports Connecticut by planning region, which don't line up with its former counties, so there's no county-level estimate. The state view includes all of Connecticut."
            : "FEMA's National Risk Index has no data for this area."}
        </p>
      </div>
    );
  }

  const county = kind === 'county' ? (loss as CountyExpectedLoss) : null;
  const state = kind === 'state' ? (loss as StateExpectedLoss) : null;
  const largest = loss.byHazard[0]?.amount || 1;
  const threshold = `${formatUsd(loss.highLossThresholdPerPerson)}+ per person/yr`;

  return (
    <div className="mt-6">
      <SectionTitle />

      <div className="grid grid-cols-2 gap-2">
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
          <Stat
            label="Residents in high-loss counties"
            value={state.highLossPopulationPct !== undefined ? formatPct(state.highLossPopulationPct) : 'N/A'}
            hint={`Top ${100 - loss.highLossPercentile}% nationally (${threshold})`}
          />
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
          <Stat
            label="Community resilience"
            value={county.communityResilience ?? 'N/A'}
            hint="NRI rating, all hazards"
          />
        )}
      </div>

      {/* Loss by hazard */}
      <div className="mt-3 space-y-2">
        {loss.byHazard.map((h) => (
          <div key={h.name} className="text-xs" title={`Includes NRI: ${NRI_HAZARDS_INCLUDED[h.name] ?? h.name}`}>
            <div className="flex justify-between items-center mb-0.5">
              <span className="text-gray-800">{h.name}</span>
              <span className="font-mono text-gray-900">{formatUsd(h.amount)}/yr</span>
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

      <p className="mt-3 text-[10px] text-gray-500 leading-snug">
        {EXPECTED_LOSS_NOTE} Severe Storm combines NRI strong wind, hail, lightning, ice storm and
        winter weather; Flood combines inland and coastal flooding.{' '}
        <a href={NRI_LINK} target="_blank" rel="noreferrer" className="underline hover:text-gray-800">
          {loss.source}
        </a>
        .
      </p>
    </div>
  );
}

function SectionTitle() {
  return (
    <span className="text-[11px] font-mono uppercase tracking-wider text-gray-500 block mb-2.5 font-semibold">
      Expected Annual Loss (FEMA estimate)
    </span>
  );
}
