// frontend/components/about/ScoreExplainer.tsx
'use client';

import React, { useState } from 'react';
import { Bricolage_Grotesque, Public_Sans, IBM_Plex_Mono } from 'next/font/google';
import { SCORE_WEIGHTS } from '@/lib/scoring';
import { TIER_STYLES, tierFor } from '@/lib/riskColors';

// Interactive "how a score is built" explainer, styled to match the Risk Resource prototype.
// Simplified to a single hazard: overall = 40% history + 40% live + 20% wildfire model
// (backend/app/domain/scoring.py). With several hazards, history and live are blended
// per hazard first, and the hazards are combined weighted toward the worst.

const display = Bricolage_Grotesque({ subsets: ['latin'], weight: ['700', '800'] });
const body = Public_Sans({ subsets: ['latin'], weight: ['400', '500', '600'] });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'] });

const RING_LENGTH = 263.9; // circumference of the r=42 circle

// The site's tiers and tier colours, shared with the map (lib/riskColors.ts).
function rating(score: number): { label: string; color: string; bg: string } {
  const tier = tierFor(score);
  return { label: tier, color: TIER_STYLES[tier].text, bg: TIER_STYLES[tier].color };
}

function ringColor(score: number): string {
  return TIER_STYLES[tierFor(score)].color;
}

interface SliderProps {
  id: string;
  label: string;
  help: string;
  value: number;
  display: string;
  min: number;
  max: number;
  step: number;
  onChange: (v: number) => void;
}

function Slider({ id, label, help, value, display: shown, min, max, step, onChange }: SliderProps) {
  const pct = ((value - min) / (max - min)) * 100;
  return (
    <div>
      <label
        htmlFor={id}
        className="flex items-baseline justify-between gap-3 text-[17px] font-semibold text-[#2A1F16] dark:text-white"
      >
        <span>{label}</span>
        <span className={`${mono.className} text-[17px] font-medium text-[#A44A0B] dark:text-[#e29b4d]`}>
          {shown}
        </span>
      </label>
      <p className="mt-1.5 mb-3 text-[15px] leading-relaxed text-[#6B5B4B] dark:text-gray-300">
        {help}
      </p>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
        className="rr-range w-full cursor-pointer"
        style={{ background: `linear-gradient(to right, #d96b38 ${pct}%, rgba(150,140,130,0.28) ${pct}%)` }}
      />
    </div>
  );
}

export default function ScoreExplainer() {
  const [historical, setHistorical] = useState(70); // baseline percentile, 0–100
  const [live, setLive] = useState(0); // strongest live signal, 0–100 (0 when nothing is happening)
  const [model, setModel] = useState(55); // wildfire model score, 0–100

  const parts = {
    historical: (SCORE_WEIGHTS.historical / 100) * historical,
    live: (SCORE_WEIGHTS.live / 100) * live,
    model: (SCORE_WEIGHTS.wildfireModel / 100) * model,
  };
  const score = Math.max(0, Math.min(100, parts.historical + parts.live + parts.model));
  const rounded = Math.round(score);
  const r = rating(rounded);

  return (
    <section
      className={`${body.className} w-full border-t bg-[#F6F1E9] border-[#E3D7C5] dark:bg-[#161513] dark:border-white/15 transition-colors`}
    >
      {/* Slider track + thumb styling (native range inputs need these selectors) */}
      <style>{`
        .rr-range { -webkit-appearance: none; appearance: none; height: 8px; border-radius: 999px; outline: none; }
        .rr-range:focus-visible { outline: 3px solid #d96b38; outline-offset: 4px; }
        .rr-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 20px; height: 20px; border-radius: 50%; background: #d96b38; border: 0; cursor: pointer; }
        .rr-range::-moz-range-thumb { width: 20px; height: 20px; border-radius: 50%; background: #d96b38; border: 0; cursor: pointer; }
        .rr-range::-moz-range-track { background: transparent; }
      `}</style>

      <div className="max-w-6xl mx-auto px-6 py-14 flex flex-col lg:flex-row gap-10 lg:gap-14">
        {/* Left: heading */}
        <div className="lg:w-80 shrink-0">
          <span
            className={`${mono.className} block text-[13px] font-medium uppercase tracking-[0.12em] text-[#A44A0B] dark:text-[#e29b4d]`}
          >
            Try It Yourself
          </span>
          <p className="mt-5 text-[17px] leading-relaxed text-[#6B5B4B] dark:text-gray-300">
            A county&rsquo;s threat score combines its disaster history, current conditions, and wildfire forecasts. Move the sliders to see how each one affects the score.
          </p>
        </div>

        {/* Right: sliders + result */}
        <div className="flex-1 min-w-0 flex flex-col md:flex-row gap-8 rounded-3xl border p-7 bg-[#FFFDF9] border-[#E3D7C5] dark:bg-[#24211d] dark:border-white/15 transition-colors">
          <div className="flex-1 min-w-0 flex flex-col gap-7">
            <Slider
              id="explainer-historical"
              label={`History`}
              help="How frequently this area has experienced major disasters since 2006, based on federal disaster records and seismic history."
              value={historical}
              display={`${historical}`}
              min={0}
              max={100}
              step={1}
              onChange={setHistorical}
            />
            <Slider
              id="explainer-live"
              label={`Live conditions`}
              help="Active weather warnings, river flood stages, severe wind gusts, or nearby earthquakes happening right now."
              value={live}
              display={String(live)}
              min={0}
              max={100}
              step={1}
              onChange={setLive}
            />
            <Slider
              id="explainer-model"
              label={`Wildfire model`}
              help="Our forecast model's rating of how favorable current heat, dryness, and wind conditions are for a wildfire to ignite in the area."
              value={model}
              display={String(model)}
              min={0}
              max={100}
              step={1}
              onChange={setModel}
            />
          </div>

          <div
            className="md:w-[22rem] flex flex-col items-center justify-center text-center gap-5 rounded-2xl p-6 bg-[#EEE5D7] dark:bg-[#191714] dark:border dark:border-white/10 transition-colors"
            aria-live="polite"
          >
            <div className="relative w-36 h-36" role="img" aria-label={`Score ${rounded} of 100`}>
              <svg viewBox="0 0 100 100" className="w-full h-full -rotate-90" aria-hidden="true">
                <circle cx="50" cy="50" r="42" fill="none" strokeWidth="9" stroke="rgba(150,120,90,0.22)" />
                <circle
                  cx="50"
                  cy="50"
                  r="42"
                  fill="none"
                  strokeWidth="9"
                  strokeLinecap="round"
                  stroke={ringColor(rounded)}
                  strokeDasharray={RING_LENGTH}
                  strokeDashoffset={RING_LENGTH * (1 - score / 100)}
                  style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(.2,.8,.2,1), stroke 0.4s ease' }}
                />
              </svg>
              <div className="absolute inset-0 grid place-items-center text-center">
                <div>
                  <span className={`${display.className} block text-5xl font-extrabold leading-none text-[#2A1F16] dark:text-white`}>
                    {rounded}
                  </span>
                  <span className={`${mono.className} block text-[11px] mt-1.5 text-[#6B5B4B] dark:text-gray-400`}>
                    OF 100
                  </span>
                </div>
              </div>
            </div>

            <span className="text-[15px] font-semibold px-3 py-1 rounded-full" style={{ color: r.color, backgroundColor: r.bg }}>
              {r.label}
            </span>

            <div className={`${mono.className} text-[15px] leading-7 text-left text-[#6B5B4B] dark:text-gray-400`}>
              {SCORE_WEIGHTS.historical / 100} &times; {historical} ={' '}
              <span className="font-medium text-[#2A1F16] dark:text-white">{parts.historical.toFixed(1)}</span>
              <br />+ {SCORE_WEIGHTS.live / 100} &times; {live} ={' '}
              <span className="font-medium text-[#2A1F16] dark:text-white">{parts.live.toFixed(1)}</span>
              <br />+ {SCORE_WEIGHTS.wildfireModel / 100} &times; {model} ={' '}
              <span className="font-medium text-[#2A1F16] dark:text-white">{parts.model.toFixed(1)}</span>
              <br />score = <span className="font-medium text-[#2A1F16] dark:text-white">{rounded}</span> / 100
            </div>
          </div>
        </div>
      </div>
    </section>
  );
}
