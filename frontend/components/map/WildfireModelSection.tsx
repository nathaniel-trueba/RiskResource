// frontend/components/map/WildfireModelSection.tsx
'use client';

import React from 'react';
import { describeWildfireModel, SCORE_FORMULA, SCORE_WEIGHTS } from '@/lib/scoring';
import { WildfireModelInfo } from '@/lib/types';

interface Props {
  model?: WildfireModelInfo;
}

/** The wildfire model's share of the overall score, under the hazard bars. */
export default function WildfireModelSection({ model }: Props) {
  return (
    <div className="mt-6">
      <span className="text-[11px] font-mono uppercase tracking-wider text-gray-500 block mb-3 font-semibold">
        Wildfire Model · {SCORE_WEIGHTS.wildfireModel}% of Score
      </span>

      {model ? (
        <div className="text-xs">
          <div className="flex justify-between items-center mb-1">
            <span className="font-semibold text-gray-900">Large-fire ignition outlook</span>
            <span className="font-mono font-bold text-gray-800">{model.score}/100</span>
          </div>
          <div className="w-full bg-gray-100 h-1.5 rounded-full overflow-hidden">
            <div
              className="h-full rounded-full transition-all duration-300"
              style={{
                width: `${model.score}%`,
                backgroundColor: model.score >= 75 ? '#7a221b' : model.score >= 50 ? '#ca6834' : '#e5ab58',
              }}
            />
          </div>
          <p className="text-[10px] text-gray-500 font-mono mt-1 leading-tight">{describeWildfireModel(model)}</p>
        </div>
      ) : (
        <p className="text-[10px] text-gray-500 font-mono leading-tight">
          Not available this week, so the score uses history and live conditions only.
        </p>
      )}

      <p className="text-[10px] text-gray-400 mt-2 leading-tight">{SCORE_FORMULA}</p>
    </div>
  );
}
