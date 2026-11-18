import React from 'react';
import { Band, NO_DATA_COLOR } from '@/lib/riskColors';

interface Props {
  title: string;     // What the colours show, e.g. "Risk score (0–100)"
  bands: Band[];     // Lowest first
  note?: string;     // Short caveat under the bands
}

export default function MapLegend({ title, bands, note }: Props) {
  // Highest band first, as on a typical choropleth legend
  const ordered = [...bands].reverse();

  return (
    <div className="absolute bottom-4 left-4 z-[500] bg-white/95 backdrop-blur-xs p-3 rounded-xl border border-gray-200/90 shadow-sm text-xs w-52">
      <span className="font-mono text-[10px] uppercase text-gray-500 font-bold block mb-2 leading-snug">
        {title}
      </span>
      <div className="space-y-1.5">
        {ordered.map((band) => (
          <div key={band.label} className="flex items-center gap-2">
            <span className="w-3.5 h-3.5 rounded-sm shrink-0" style={{ backgroundColor: band.color }} />
            <span className="text-gray-700 font-mono text-[11px]">{band.label}</span>
          </div>
        ))}
        <div className="flex items-center gap-2">
          <span className="w-3.5 h-3.5 rounded-sm shrink-0" style={{ backgroundColor: NO_DATA_COLOR }} />
          <span className="text-gray-500 font-mono text-[11px]">No data</span>
        </div>
      </div>
      {note && <p className="mt-2 text-[10px] text-gray-500 leading-snug">{note}</p>}
    </div>
  );
}
