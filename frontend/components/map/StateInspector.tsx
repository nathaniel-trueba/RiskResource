// frontend/components/map/StateInspector.tsx
'use client';

import React from 'react';
import { StateRecord } from '@/lib/types';
import ExpectedLossSection from '@/components/map/ExpectedLossSection';
import WildfireModelSection from '@/components/map/WildfireModelSection';

interface Props {
  stateData: StateRecord;
  onDrillDown: () => void;
}

export default function StateInspector({ stateData, onDrillDown }: Props) {
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
			<span className="inline-flex items-center justify-center text-center whitespace-nowrap text-[10px] font-semibold leading-none px-2.5 py-1 rounded-full bg-[#7a221b] text-white mt-1.5">
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
            <span className="text-base font-bold text-[#7a221b] font-mono mt-0.5 block">
              {stateData.tier}
            </span>
          </div>
        </div>

        {/* Primary Alert Callout */}
        <div className="mt-3 p-3 bg-red-50/80 border border-red-200/70 rounded-xl">
          <span className="text-[10px] font-mono uppercase text-red-900 font-bold block">
            Current Statewide Focus
          </span>
          <p className="text-xs text-red-950 font-medium mt-0.5 leading-snug">
            {stateData.primaryAlert ?? 'No active alerts'}
          </p>
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
                      backgroundColor:
                        h.score >= 75 ? '#7a221b' : h.score >= 50 ? '#ca6834' : '#e5ab58',
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
