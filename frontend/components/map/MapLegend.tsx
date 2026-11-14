// frontend/components/map/MapLegend.tsx
'use client';

import React from 'react';
import { MetricOption } from '@/lib/types';
import { RATINGS, NO_DATA } from '@/lib/mockRiskData';

interface Props {
  metric: MetricOption;
  breaks: number[];
}

export default function MapLegend({ metric, breaks }: Props) {
  let rows: [string, string][] = [];

  if (metric.categorical) {
    rows = RATINGS.filter((r) => r.label !== 'No Rating').map((r) => [r.color, r.label]);
  } else if (metric.palette && breaks.length > 0 && metric.fmt) {
    const fmt = metric.fmt;
    const palette = metric.palette;
    rows = palette
      .map((c, i): [string, string] => {
        if (i === 0) return [c, `≤ ${fmt(breaks[0])}`];
        if (i === palette.length - 1) return [c, `> ${fmt(breaks[breaks.length - 1])}`];
        return [c, `${fmt(breaks[i - 1])} – ${fmt(breaks[i])}`];
      })
      .reverse();
  }

  rows.push([NO_DATA, 'No data']);

  return (
    <div className="absolute bottom-4 left-4 z-[400] bg-white p-3 rounded-xl shadow-md border border-[#e2e0db] text-xs min-w-[160px] leading-relaxed">
      <div className="font-semibold text-[#1d232b] mb-1.5">{metric.label}</div>
      <div className="space-y-1">
        {rows.map(([color, text], idx) => (
          <div key={idx} className="flex items-center gap-2 text-[#1d232b]">
            <i
              className="w-3.5 h-3.5 rounded-xs shrink-0 inline-block"
              style={{ backgroundColor: color }}
            />
            <span>{text}</span>
          </div>
        ))}
      </div>
    </div>
  );
}
