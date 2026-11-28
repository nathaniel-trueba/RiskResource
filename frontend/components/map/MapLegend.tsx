// frontend/components/map/MapLegend.tsx
'use client';

import React from 'react';

export interface LegendBand {
  label: string;
  color: string;
}

interface Props {
  title?: string;
  bands: LegendBand[];
  note?: string;
}

interface GroupedRow {
  colors: string[];
  name: string;
  range: string;
  sortValue: number;
}

/**
 * Groups bands sharing a tier prefix (e.g., "Moderate 40-49" & "Moderate 30-39")
 * into a single row with paired swatches, ordered highest-to-lowest (Critical on top, Low at bottom).
 */
function groupBands(bands: LegendBand[]): GroupedRow[] {
  // Sort highest-to-lowest first so Critical (75-100) is always first and Low (0-14) is last
  const sorted = [...bands].sort((a, b) => {
    const aNums = a.label.match(/\d+/g)?.map(Number) ?? [0];
    const bNums = b.label.match(/\d+/g)?.map(Number) ?? [0];
    return Math.max(...bNums) - Math.max(...aNums);
  });

  const rows: GroupedRow[] = [];

  for (const band of sorted) {
    // Match labels like "Critical 75-100", "Moderate 40-49", "Low 0-14"
    const match = band.label.match(/^([A-Za-z]+)\s+(\d+)\s*[-–]\s*(\d+)$/);

    if (!match) {
      const nums = band.label.match(/\d+/g)?.map(Number) ?? [0];
      rows.push({
        colors: [band.color],
        name: band.label,
        range: '',
        sortValue: Math.max(...nums),
      });
      continue;
    }

    const [, tierName, minStr, maxStr] = match;
    const prev = rows[rows.length - 1];

    if (prev && prev.name === tierName && prev.range) {
      // prev holds the higher sub-band; merge current lower bound into it
      const upper = prev.range.split(/[-–]/)[1];
      prev.colors.push(band.color);
      prev.range = `${minStr}-${upper}`;
    } else {
      rows.push({
        colors: [band.color],
        name: tierName,
        range: `${minStr}-${maxStr}`,
        sortValue: Number(maxStr),
      });
    }
  }

  return rows;
}

export default function MapLegend({ title, bands, note }: Props) {
  const rows = groupBands(bands);

  return (
    <div className="absolute bottom-3 left-3 z-[400] bg-white/95 dark:bg-[#181613]/95 backdrop-blur-xs px-3.5 py-2.5 rounded-xl border border-gray-200/90 dark:border-white/10 shadow-sm text-xs">
      {title && (
        <span className="font-mono text-[10px] uppercase tracking-wider text-gray-500 dark:text-gray-400 font-bold block mb-2">
          {title}
        </span>
      )}

      <div className="space-y-1.5">
        {rows.map((row) => (
          <div
            key={`${row.name}-${row.range}`}
            className="flex items-center justify-between gap-5 font-mono text-[11px]"
          >
            <div className="flex items-center gap-2">
              <div className="flex items-center gap-0.5 shrink-0">
                {row.colors.map((color, i) => (
                  <span
                    key={`${color}-${i}`}
                    className="w-2.5 h-2.5 rounded-[2px] inline-block border border-black/10"
                    style={{ backgroundColor: color }}
                  />
                ))}
              </div>
              <span className="text-gray-800 dark:text-gray-200 font-medium">{row.name}</span>
            </div>

            {row.range && (
              <span className="text-gray-600 dark:text-gray-300 tabular-nums text-right">
                {row.range}
              </span>
            )}
          </div>
        ))}

        {/* No data row */}
        <div className="flex items-center gap-2 font-mono text-[11px]">
          <span className="w-2.5 h-2.5 rounded-[2px] inline-block bg-[#d1d5db] border border-black/10 shrink-0" />
          <span className="text-gray-500 dark:text-gray-400">No data</span>
        </div>
      </div>

      {note && (
        <p className="mt-2 pt-1.5 border-t border-gray-100 dark:border-white/10 text-[10px] text-gray-500 dark:text-gray-400 leading-snug max-w-[230px]">
          {note}
        </p>
      )}
    </div>
  );
}
