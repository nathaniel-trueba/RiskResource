// frontend/app/about/page.tsx
'use client';

import React from 'react';
import Navigation from '@/components/common/Navigation';
import Footer from '@/components/common/Footer';
import ScoreExplainer from '@/components/about/ScoreExplainer';
import { NRI_HAZARDS_EXCLUDED, NRI_HAZARDS_INCLUDED } from '@/lib/nri';

interface DataSource {
  name: string;
  agency: string;
  type: 'Baseline (Static)' | 'Live Telemetry';
  cadence: string;
  resolution: string;
  description: string;
  link: string;
}

const DATA_SOURCES: DataSource[] = [
  {
    name: 'National Risk Index (NRI)',
    agency: 'FEMA',
    type: 'Baseline (Static)',
    cadence: 'Periodic releases (December 2025 in use)',
    resolution: 'County (Connecticut by planning region)',
    description:
      "Modeled expected annual loss in dollars, plus social vulnerability and community resilience ratings. We use its losses for the 11 of its 18 hazards that match ours, for the map's loss measures and the Expected Annual Loss panels. It isn't part of the risk score.",
    link: 'https://hazards.fema.gov/nri/',
  },
  {
    name: 'Disaster Declarations Summaries',
    agency: 'OpenFEMA',
    type: 'Baseline (Static)',
    cadence: 'Refreshed when we rebuild the baseline',
    resolution: 'County',
    description:
      'Every federal disaster declaration since 2006, by county and incident type. Counting distinct declarations per hazard gives the historical half of each risk score.',
    link: 'https://www.fema.gov/openfema-data-page/disaster-declarations-summaries-v2',
  },
  {
    name: 'Real-Time Seismic Network',
    agency: 'USGS',
    type: 'Live Telemetry',
    cadence: '1 minute (Event-driven)',
    resolution: 'Geographic coordinate (Lat/Lon)',
    description:
      'Continuous stream of seismic events, moment magnitudes, epicenter depths, and ShakeMap peak ground acceleration (PGA) decay vectors within distance buffers.',
    link: 'https://earthquake.usgs.gov/',
  },
  {
    name: 'HRRR & NWS Active Alert Polygons',
    agency: 'NOAA / NWS',
    type: 'Live Telemetry',
    cadence: 'Hourly / 15 minutes',
    resolution: '3 km grid (HRRR)',
    description:
      'Mesoscale atmospheric weather modeling for peak wind gusts, sudden precipitation rates, and real-time CAP alert warning polygons (Red Flag, Flash Flood, High Wind).',
    link: 'https://www.weather.gov/',
  },
  {
    name: 'Wildland Fire Interagency System',
    agency: 'NIFC / IRWIN',
    type: 'Live Telemetry',
    cadence: 'Hourly to Daily',
    resolution: 'Active Perimeter Polygons',
    description:
      'Active fire incident perimeters, containment percentages, and thermal satellite hotspot detections (VIIRS / MODIS) evaluating proximity risk.',
    link: 'https://www.nifc.gov/',
  },
];

export default function AboutDataPage() {
  return (
    <div className="min-h-screen bg-[#fcfbf7] text-[#111827] dark:bg-[#11100e] dark:text-[#f3f4f6] flex flex-col justify-between selection:bg-amber-200 dark:selection:bg-amber-900/50 transition-colors duration-200">
      <Navigation />

      <main className="w-full flex-grow">
        {/* Header Hero Section */}
        <section className="max-w-5xl mx-auto px-6 pt-16 pb-12">
          <span className="text-[11px] font-mono uppercase tracking-widest text-gray-500 dark:text-gray-400 block mb-3">
            — Methodology & Ingestion Pipelines
          </span>
          <h1 className="text-4xl sm:text-5xl font-normal tracking-tight text-gray-950 dark:text-white leading-tight">
            About the data, <br />
            <span className="font-semibold text-gray-600 dark:text-gray-400">
              The science of explainability.
            </span>
          </h1>
          <p className="text-sm text-gray-600 dark:text-gray-400 mt-5 leading-relaxed max-w-2xl">
            Hazard risk information is scattered across disparate agency databases built for research,
            not for everyday residents asking <em>&ldquo;how worried should I be about my home right now?&rdquo;</em>{' '}
            Risk Resource synthesizes historical baselines with real-time physical telemetry.
          </p>
        </section>

        {/* Scoring Architecture Schematic */}
        <section className="max-w-5xl mx-auto px-6 py-10 border-t border-gray-200/80 dark:border-white/10">
          <div className="mb-6">
            <span className="text-[11px] font-mono uppercase tracking-wider text-gray-500 dark:text-gray-400 block mb-1">
              Architecture
            </span>
            <h2 className="text-xl font-medium text-gray-900 dark:text-white">How the score is built</h2>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 max-w-xl">
              Each hazard is calculated as an isolated 0 to 100 sub-score split into two distinct, explainable components.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 bg-[#f7f5ef] dark:bg-[#161411] p-6 rounded-2xl border border-[#ece4d0] dark:border-white/10">
            <div className="bg-white dark:bg-[#1c1915] p-5 rounded-xl border border-gray-200 dark:border-white/10 shadow-2xs">
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800/60 font-semibold">
                50% Static Baseline
              </span>
              <h3 className="text-sm font-bold text-gray-900 dark:text-white mt-3">Long-Term Exposure</h3>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1.5 leading-relaxed">
                A county&apos;s percentile rank, among counties that have had the hazard, by distinct FEMA disaster declarations since 2006. For earthquakes it uses USGS M4.5+ earthquakes within 60 miles instead.
              </p>
            </div>

            <div className="bg-white dark:bg-[#1c1915] p-5 rounded-xl border border-gray-200 dark:border-white/10 shadow-2xs">
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800/60 font-semibold">
                50% Live Multiplier
              </span>
              <h3 className="text-sm font-bold text-gray-900 dark:text-white mt-3">Real-Time Telemetry</h3>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1.5 leading-relaxed">
                Injected from hourly NWS alert polygons, HRRR wind gusts (&gt;40 mph), live river stages vs. flood crest, and USGS seismic events.
              </p>
            </div>
          </div>
        </section>

        <ScoreExplainer />

        {/* Expected annual loss */}
        <section className="max-w-5xl mx-auto px-6 py-10 border-t border-gray-200/80 dark:border-white/10">
          <div className="mb-6">
            <span className="text-[11px] font-mono uppercase tracking-wider text-gray-500 dark:text-gray-400 block mb-1">
              Losses
            </span>
            <h2 className="text-xl font-medium text-gray-900 dark:text-white">Expected annual loss</h2>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 max-w-2xl leading-relaxed">
              Dollar figures come straight from FEMA&apos;s National Risk Index (December 2025). They
              are FEMA&apos;s modeled average yearly loss to buildings and crops, plus deaths and
              injuries at FEMA&apos;s dollar value. They&apos;re estimates, not money actually lost, and
              they don&apos;t change with live conditions. A county is <em>high-loss</em> when its loss
              per person is in the top 20% of all US counties.
            </p>
          </div>

          <div className="overflow-x-auto bg-white dark:bg-[#181613] border border-gray-200 dark:border-white/10 rounded-xl shadow-2xs">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#211e1a] font-mono text-gray-500 dark:text-gray-400 text-[11px]">
                  <th className="p-3.5">Our hazard</th>
                  <th className="p-3.5">NRI hazards counted</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/10 text-gray-700 dark:text-gray-300">
                {Object.entries(NRI_HAZARDS_INCLUDED).map(([ours, nri]) => (
                  <tr key={ours}>
                    <td className="p-3.5 font-bold text-gray-900 dark:text-white">{ours}</td>
                    <td className="p-3.5">{nri}</td>
                  </tr>
                ))}
                <tr>
                  <td className="p-3.5 font-bold text-gray-500 dark:text-gray-400">Not counted</td>
                  <td className="p-3.5 text-gray-500 dark:text-gray-400">
                    {NRI_HAZARDS_EXCLUDED.join(', ')}: NRI models these, but they have no
                    matching hazard here, so every loss figure leaves them out. Nationally, the
                    counted hazards make up about 86% of NRI&apos;s total expected loss.
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p className="text-[11px] text-gray-500 dark:text-gray-400 mt-3 leading-relaxed max-w-2xl">
            NRI reports Connecticut by its 9 planning regions, which don&apos;t line up with its
            8 former counties, so Connecticut counties have no loss data; the state total includes
            every region. Social vulnerability and community resilience ratings cover all of
            NRI&apos;s hazards.
          </p>
        </section>

        {/* Agency Ingestion Feeds */}
        <section className="max-w-5xl mx-auto px-6 py-12 border-t border-gray-200/80 dark:border-white/10">
          <div className="mb-8">
            <span className="text-[11px] font-mono uppercase tracking-wider text-gray-500 dark:text-gray-400 block mb-1">
              Pipelines
            </span>
            <h2 className="text-xl font-medium text-gray-900 dark:text-white">Federal Data Sources</h2>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {DATA_SOURCES.map((src) => (
              <div
                key={src.name}
                className="p-6 bg-white dark:bg-[#181613] border border-gray-200 dark:border-white/10 rounded-2xl flex flex-col justify-between shadow-2xs hover:border-gray-400 dark:hover:border-white/25 transition-colors"
              >
                <div>
                  <div className="flex items-center justify-between mb-3">
                    <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-md bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-200 font-semibold">
                      {src.agency}
                    </span>
                    <span className="text-[11px] font-mono text-gray-500 dark:text-gray-400">
                      {src.type}
                    </span>
                  </div>
                  <h3 className="text-base font-medium text-gray-950 dark:text-white">{src.name}</h3>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-2 leading-relaxed">
                    {src.description}
                  </p>
                </div>

                <div className="mt-6 pt-4 border-t border-gray-100 dark:border-white/10 flex items-center justify-between text-xs font-mono text-gray-500 dark:text-gray-400">
                  <span>Sync: {src.cadence}</span>
                  <a
                    href={src.link}
                    target="_blank"
                    rel="noreferrer"
                    className="text-gray-900 dark:text-gray-200 underline hover:text-amber-600 dark:hover:text-[#e29b4d] transition-colors"
                  >
                    Documentation →
                  </a>
                </div>
              </div>
            ))}
          </div>
        </section>

        {/* Data Dictionary Table */}
        <section className="max-w-5xl mx-auto px-6 py-12 border-t border-gray-200/80 dark:border-white/10 mb-12">
          <div className="mb-6">
            <span className="text-[11px] font-mono uppercase tracking-wider text-gray-500 dark:text-gray-400 block mb-1">
              Dictionary
            </span>
            <h2 className="text-xl font-medium text-gray-900 dark:text-white">Telemetry Variables & Units</h2>
          </div>

          <div className="overflow-x-auto bg-white dark:bg-[#181613] border border-gray-200 dark:border-white/10 rounded-xl shadow-2xs">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#211e1a] font-mono text-gray-500 dark:text-gray-400 text-[11px]">
                  <th className="p-3.5">Hazard Pod</th>
                  <th className="p-3.5">Live Parameter</th>
                  <th className="p-3.5">Unit</th>
                  <th className="p-3.5">Advisory Threshold</th>
                  <th className="p-3.5">Critical Severity</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/10 font-mono text-gray-700 dark:text-gray-300">
                <tr>
                  <td className="p-3.5 font-bold text-gray-900 dark:text-white">Wildfire</td>
                  <td className="p-3.5">Wind &times; (100 - RH)</td>
                  <td className="p-3.5">Compound Index</td>
                  <td className="p-3.5">RH &le; 15% &amp; Gusts &ge; 25 mph</td>
                  <td className="p-3.5 text-rose-700 dark:text-rose-400 font-semibold">Red Flag / Perimeter &lt; 5 mi</td>
                </tr>
                <tr>
                  <td className="p-3.5 font-bold text-gray-900 dark:text-white">Severe Weather</td>
                  <td className="p-3.5">Peak Wind Gusts</td>
                  <td className="p-3.5">mph</td>
                  <td className="p-3.5">40 mph (NWS Advisory)</td>
                  <td className="p-3.5 text-rose-700 dark:text-rose-400 font-semibold">&ge; 58 mph (Structural Shock)</td>
                </tr>
                <tr>
                  <td className="p-3.5 font-bold text-gray-900 dark:text-white">Flood</td>
                  <td className="p-3.5">Gauge vs. Flood Stage</td>
                  <td className="p-3.5">ft / discharge</td>
                  <td className="p-3.5">Action Stage (+0.0 ft)</td>
                  <td className="p-3.5 text-rose-700 dark:text-rose-400 font-semibold">Major Flood Crest (+3.5 ft)</td>
                </tr>
                <tr>
                  <td className="p-3.5 font-bold text-gray-900 dark:text-white">Earthquake</td>
                  <td className="p-3.5">Distance-decayed PGA</td>
                  <td className="p-3.5">%g / MMI</td>
                  <td className="p-3.5">M &ge; 3.0 within 30 mi</td>
                  <td className="p-3.5 text-rose-700 dark:text-rose-400 font-semibold">M &ge; 5.5 within 20 mi</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
