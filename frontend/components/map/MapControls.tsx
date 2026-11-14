// frontend/components/map/MapControls.tsx
'use client';

import React from 'react';
import { MapViewMode, MetricOption } from '@/lib/types';

interface Props {
  viewMode: MapViewMode;
  onViewModeChange: (mode: MapViewMode) => void;
  metrics: MetricOption[];
  selectedMetricIndex: number;
  onMetricChange: (index: number) => void;
}

export default function MapControls({
  viewMode,
  onViewModeChange,
  metrics,
  selectedMetricIndex,
  onMetricChange,
}: Props) {
  return (
    <div className="flex flex-wrap items-center justify-between gap-4 py-3 px-5 bg-white border border-[#e2e0db] rounded-xl shadow-2xs mb-4">
      <div className="flex items-center gap-3">
        <h1 className="text-lg font-bold tracking-tight text-[#1d232b] m-0">Risk Resource</h1>
        <span className="text-xs text-[#5f6b78]">US natural disaster risk</span>
      </div>

      <div className="flex flex-wrap items-center gap-3.5">
        {/* States / Counties Toggle */}
        <div
          role="group"
          aria-label="Map level"
          className="inline-flex border border-[#e2e0db] rounded-full p-0.5 bg-[#f6f5f2]"
        >
          <button
            type="button"
            onClick={() => onViewModeChange('states')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium cursor-pointer transition-colors ${
              viewMode === 'states' ? 'bg-[#1d232b] text-white' : 'text-[#5f6b78] hover:text-[#1d232b]'
            }`}
          >
            States
          </button>
          <button
            type="button"
            onClick={() => onViewModeChange('counties')}
            className={`px-3.5 py-1.5 rounded-full text-xs font-medium cursor-pointer transition-colors ${
              viewMode === 'counties' ? 'bg-[#1d232b] text-white' : 'text-[#5f6b78] hover:text-[#1d232b]'
            }`}
          >
            Counties
          </button>
        </div>

        {/* Show Metric Dropdown */}
        <label className="flex items-center gap-2 text-xs text-[#5f6b78]">
          <span>Show</span>
          <select
            value={selectedMetricIndex}
            onChange={(e) => onMetricChange(Number(e.target.value))}
            className="text-xs text-[#1d232b] px-2.5 py-1.5 border border-[#e2e0db] rounded-lg bg-white focus:outline-none"
          >
            {metrics.map((m, i) => (
              <option key={m.key} value={i}>
                {m.label}
              </option>
            ))}
          </select>
        </label>
      </div>
    </div>
  );
}
