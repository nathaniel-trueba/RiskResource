'use client';

import React, { useState } from 'react';
import { Bricolage_Grotesque, Public_Sans, IBM_Plex_Mono } from 'next/font/google';

// Interactive "What impacts your risk" explainer, styled to match the Risk Resource prototype.
// Simplified for learning: FEMA's real method ranks every county against all others nationally.

const display = Bricolage_Grotesque({ subsets: ['latin'], weight: ['700', '800'] });
const body = Public_Sans({ subsets: ['latin'], weight: ['400', '500', '600'] });
const mono = IBM_Plex_Mono({ subsets: ['latin'], weight: ['400', '500'] });

// Prototype palette
const C = {
  band: '#F6F1E9', // section background
  card: '#FFFDF9', // slider card
  result: '#EEE5D7', // score panel
  line: '#E3D7C5',
  ink: '#2A1F16',
  muted: '#6B5B4B',
  accent: '#A44A0B',
  track: '#E6E1DA',
};

const RING_LENGTH = 263.9; // circumference of the r=42 circle

function rating(score: number): { label: string; color: string; bg: string } {
  if (score >= 80) return { label: 'Very high', color: '#A51D16', bg: '#FFE3E0' };
  if (score >= 60) return { label: 'Relatively high', color: '#B23A12', bg: '#FFE9DC' };
  if (score >= 40) return { label: 'Relatively moderate', color: '#8A5A00', bg: '#FFF2D1' };
  if (score >= 20) return { label: 'Relatively low', color: '#1E6B45', bg: '#E2F3EA' };
  return { label: 'Very low', color: '#1E6B45', bg: '#E2F3EA' };
}

function ringColor(score: number): string {
  if (score >= 80) return '#B3261E';
  if (score >= 60) return '#E8622C';
  if (score >= 40) return '#F0812F';
  if (score >= 20) return '#C9A227';
  return '#3BA776';
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
      <label htmlFor={id} className="flex items-baseline justify-between gap-3 text-[17px] font-semibold" style={{ color: C.ink }}>
        <span>{label}</span>
        <span className={`${mono.className} text-[17px] font-medium`} style={{ color: C.accent }}>
          {shown}
        </span>
      </label>
      <p className="mt-1.5 mb-3 text-[15px] leading-relaxed" style={{ color: C.muted }}>
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
        style={{ background: `linear-gradient(to right, ${C.accent} ${pct}%, ${C.track} ${pct}%)` }}
      />
    </div>
  );
}

export default function ScoreExplainer() {
  const [eal, setEal] = useState(420); // expected annual loss, $ per person
  const [sovi, setSovi] = useState(55); // social vulnerability, 0–100
  const [resil, setResil] = useState(45); // community resilience, 0–100

  const communityFactor = (0.6 + sovi / 100) / (0.6 + resil / 100);
  const raw = eal * communityFactor;
  const score = Math.max(0, Math.min(100, (100 * raw) / (raw + 420)));
  const rounded = Math.round(score);
  const r = rating(score);

  return (
    <section className={`${body.className} w-full border-t`} style={{ backgroundColor: C.band, borderColor: C.line }}>
      {/* Slider track + thumb styling (native range inputs need these selectors) */}
      <style>{`
        .rr-range { -webkit-appearance: none; appearance: none; height: 8px; border-radius: 999px; outline: none; }
        .rr-range:focus-visible { outline: 3px solid ${C.accent}; outline-offset: 4px; }
        .rr-range::-webkit-slider-thumb { -webkit-appearance: none; appearance: none; width: 20px; height: 20px; border-radius: 50%; background: ${C.accent}; border: 0; cursor: pointer; }
        .rr-range::-moz-range-thumb { width: 20px; height: 20px; border-radius: 50%; background: ${C.accent}; border: 0; cursor: pointer; }
        .rr-range::-moz-range-track { background: transparent; }
      `}</style>

      <div className="max-w-6xl mx-auto px-6 py-14 flex flex-col lg:flex-row gap-10 lg:gap-14">
        {/* Left: heading */}
        <div className="lg:w-80 shrink-0">
          <span className={`${mono.className} block text-[13px] font-medium uppercase tracking-[0.12em]`} style={{ color: C.accent }}>
            What impacts your risk
          </span>
          <h2 className={`${display.className} mt-4 text-[34px] font-extrabold leading-[1.05] tracking-tight`} style={{ color: C.ink }}>
             How three variables,
            <br />
            shape your risk.
          </h2>
          <p className="mt-5 text-[17px] leading-relaxed" style={{ color: C.muted }}>
            A county&rsquo;s risk score combines what hazards are expected to cost with how vulnerable and how
            resilient its community is. Move the sliders to see how each one pushes the score.
          </p>
        </div>

        {/* Right: sliders + result */}
        <div
          className="flex-1 min-w-0 flex flex-col md:flex-row gap-8 rounded-3xl border p-7"
          style={{ backgroundColor: C.card, borderColor: C.line }}
        >
          <div className="flex-1 min-w-0 flex flex-col gap-7">
            <Slider
              id="explainer-eal"
              label="Expected annual loss"
              help="Average yearly damage to buildings, crops and people from all hazards."
              value={eal}
              display={`$${eal.toLocaleString()} / person`}
              min={50}
              max={1500}
              step={10}
              onChange={setEal}
            />
            <Slider
              id="explainer-sovi"
              label="Social vulnerability"
              help="How hard it is for residents to prepare and recover (income, age, housing)."
              value={sovi}
              display={String(sovi)}
              min={0}
              max={100}
              step={1}
              onChange={setSovi}
            />
            <Slider
              id="explainer-resil"
              label="Community resilience"
              help="How ready local systems are to respond and bounce back. Higher lowers the risk."
              value={resil}
              display={String(resil)}
              min={0}
              max={100}
              step={1}
              onChange={setResil}
            />
          </div>

          <div
            className="md:w-[22rem] flex flex-col items-start gap-5 rounded-2xl p-6"
            style={{ backgroundColor: C.result }}
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
                  stroke={ringColor(score)}
                  strokeDasharray={RING_LENGTH}
                  strokeDashoffset={RING_LENGTH * (1 - score / 100)}
                  style={{ transition: 'stroke-dashoffset 0.6s cubic-bezier(.2,.8,.2,1), stroke 0.4s ease' }}
                />
              </svg>
              <div className="absolute inset-0 grid place-items-center text-center">
                <div>
                  <span className={`${display.className} block text-5xl font-extrabold leading-none`} style={{ color: C.ink }}>
                    {rounded}
                  </span>
                  <span className={`${mono.className} block text-[11px] mt-1.5`} style={{ color: C.muted }}>
                    OF 100
                  </span>
                </div>
              </div>
            </div>

            <span className="text-[15px] font-semibold px-3 py-1 rounded-full" style={{ color: r.color, backgroundColor: r.bg }}>
              {r.label}
            </span>

            <div className={`${mono.className} text-[15px] leading-7`} style={{ color: C.muted }}>
              community factor = <span className="font-medium" style={{ color: C.ink }}>{communityFactor.toFixed(2)}</span>
              <br />${eal} &times; {communityFactor.toFixed(2)} ={' '}
              <span className="font-medium" style={{ color: C.ink }}>{Math.round(raw)}</span>
              <br />score = <span className="font-medium" style={{ color: C.ink }}>{rounded}</span> / 100
            </div>

            <p className="m-0 text-[13.5px] leading-relaxed" style={{ color: C.muted }}>
              A simplified version for learning. FEMA&rsquo;s method ranks every county against all others nationally.
            </p>
          </div>
        </div>
      </div>
    </section>
  );
}
