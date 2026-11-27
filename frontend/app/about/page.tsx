// frontend/app/about/page.tsx
'use client';

import React from 'react';
import Navigation from '@/components/common/Navigation';
import Footer from '@/components/common/Footer';
import ScoreExplainer from '@/components/about/ScoreExplainer';
// import NriExplainer from '@/components/about/NriExplainer';
import { NRI_HAZARDS_EXCLUDED, NRI_HAZARDS_INCLUDED } from '@/lib/nri';
import { SCORE_WEIGHTS } from '@/lib/scoring';

interface DataSource {
  name: string;
  agency: string;
  resolution: string;
  description: string;
  link: string;
}

const DATA_SOURCES: DataSource[] = [
  {
    name: 'Disaster Declarations Summaries',
    agency: 'OpenFEMA',
    resolution: 'County',
    description:
      'Official records of every federal major disaster and fire declaration across U.S. counties since 2006.',
    link: 'https://www.fema.gov/openfema-data-page/disaster-declarations-summaries-v2',
  },
  {
    name: 'Earthquake Catalog',
    agency: 'USGS',
    resolution: 'Epicenter (latitude and longitude)',
    description:
      'Real-time and historical earthquake reports from the U.S. Geological Survey.',
    link: 'https://earthquake.usgs.gov/fdsnws/event/1/',
  },
  {
    name: 'Active Weather Alerts',
    agency: 'NOAA / NWS',
    resolution: 'County (from each alert’s county codes)',
    description:
      'Live nationwide warnings, watches, and advisories issued by the National Weather Service.',
    link: 'https://www.weather.gov/documentation/services-web-api',
  },
  {
    name: 'Weather Forecast',
    agency: 'Open-Meteo',
    resolution: 'County center point',
    description:
      'Hourly and daily local weather forecasts providing wind speeds, gusts, temperature, and relative humidity.',
    link: 'https://open-meteo.com/en/docs',
  },
  {
    name: 'River Gauges',
    agency: 'NOAA / NWPS',
    resolution: 'Individual river gauges in and near the county',
    description:
      'Observed and forecasted water levels from river gauges nationwide, tracked against local action and flood stages.',
    link: 'https://api.water.noaa.gov/nwps/v1/docs/',
  },
  {
    name: 'Historical Burn & Weather Data',
    agency: 'MTBS / NASA POWER',
    resolution: 'County',
    description:
      'Satellite-mapped wildfire burn perimeters from Monitoring Trends in Burn Severity paired with daily solar, temperature, and moisture data from NASA.',
    link: 'https://www.mtbs.gov/',
  },
  {
    name: 'National Risk Index (NRI)',
    agency: 'FEMA',
    resolution: 'County (Connecticut by planning region)',
    description:
      "FEMA's county-level dataset estimating expected annual economic losses from natural hazards alongside social vulnerability and community resilience ratings.",
    link: 'https://hazards.fema.gov/nri/',
  },
  {
    name: 'County Population Estimates',
    agency: 'U.S. Census Bureau',
    resolution: 'County',
    description:
      'Official U.S. Census population.',
    link: 'https://www.census.gov/programs-surveys/popest.html',
  },
];

// Mirrors ALERT_RULES in backend/app/domain/hazards.py and the thresholds in
// backend/app/domain/scoring.py. Change them together.
interface SeverityLevel {
  score: number;
  condition: string;
}

interface LiveSignalRow {
  hazard: string;
  sources: string[];
  levels: SeverityLevel[]; // lowest score first
}

const LIVE_SIGNALS: LiveSignalRow[] = [
  {
    hazard: 'Wildfire',
    sources: ['NWS fire alerts', 'Open-Meteo (next 24 h)'],
    levels: [
      { score: 60, condition: 'Fire Weather Watch' },
      { score: 80, condition: 'Humidity ≤ 15% and gusts ≥ 25 mph in the same hour' },
      { score: 100, condition: 'Red Flag Warning or Fire Warning' },
    ],
  },
  {
    hazard: 'Severe storm',
    sources: ['NWS storm, wind and winter alerts', 'Open-Meteo peak gusts'],
    levels: [
      { score: 35, condition: 'Wind Advisory' },
      { score: 70, condition: 'Gusts ≥ 40 mph' },
      { score: 75, condition: 'High Wind Warning' },
      { score: 90, condition: 'Severe Thunderstorm Warning' },
      { score: 100, condition: 'Extreme Wind Warning or gusts ≥ 58 mph' },
    ],
  },
  {
    hazard: 'Flood',
    sources: ['NWS flood alerts', 'NOAA river gauges'],
    levels: [
      { score: 35, condition: 'Flood Advisory' },
      { score: 40, condition: 'Gauge at action stage' },
      { score: 70, condition: 'Minor flooding' },
      { score: 85, condition: 'Flood Warning or moderate flooding' },
      { score: 100, condition: 'Flash Flood Warning or major river flooding' },
    ],
  },
  {
    hazard: 'Hurricane',
    sources: ['NWS tropical and storm surge alerts'],
    levels: [
      { score: 50, condition: 'Tropical Storm Watch' },
      { score: 75, condition: 'Tropical Storm Warning' },
      { score: 90, condition: 'Storm Surge Warning' },
      { score: 100, condition: 'Hurricane Warning' },
    ],
  },
  {
    hazard: 'Tornado',
    sources: ['NWS tornado alerts'],
    levels: [
      { score: 65, condition: 'Tornado Watch' },
      { score: 100, condition: 'Tornado Warning' },
    ],
  },
  {
    hazard: 'Earthquake',
    sources: ['USGS (past 7 days)'],
    levels: [
      { score: 45, condition: 'M3.0+ within 30 mi' },
      { score: 75, condition: 'M4.5+ within 30 mi' },
      { score: 100, condition: 'M5.5+ within 20 mi' },
    ],
  },
];

// Severity bands for the table's columns. Each band's badge uses a muted color:
// gray low, pale yellow medium, soft red high.
const SEVERITY_BANDS = [
  {
    label: 'Low',
    range: '0–49',
    min: 0,
    max: 49,
    badge: 'bg-gray-100 text-gray-700 border-gray-200 dark:bg-white/10 dark:text-gray-200 dark:border-white/15',
  },
  {
    label: 'Medium',
    range: '50–84',
    min: 50,
    max: 84,
    badge: 'bg-yellow-50 text-yellow-800 border-yellow-200 dark:bg-yellow-950/40 dark:text-yellow-200 dark:border-yellow-900/60',
  },
  {
    label: 'High',
    range: '85–100',
    min: 85,
    max: 100,
    badge: 'bg-red-100 text-red-800 border-red-200 dark:bg-red-950/50 dark:text-red-200 dark:border-red-900/60',
  },
];

export default function AboutDataPage() {
  return (
    <div className="min-h-screen bg-[#fcfbf7] text-[#111827] dark:bg-[#11100e] dark:text-[#f3f4f6] flex flex-col justify-between selection:bg-amber-200 dark:selection:bg-amber-900/50 transition-colors duration-200">
      <Navigation />

      <main className="w-full flex-grow">
        {/* Header Hero Section */}
        <section className="max-w-5xl mx-auto px-6 pt-16 pb-12">
          <h1 className="text-4xl sm:text-5xl font-normal tracking-tight text-gray-950 dark:text-white leading-tight">
            About the Data
          </h1>
          <p className="text-sm sm:text-base text-gray-600 dark:text-gray-400 mt-5 leading-relaxed max-w-2xl">
            Hazard information is scattered across agency sites (NOAA, USGS, FEMA) that were not built
            for a resident asking &ldquo;how worried should I be about my house, right now?&rdquo; Risk
            Resource answers that, combining natural disaster data across government agencies reporting
            disaster history, live warnings, and our own wildfire forecast model, resulting in a single
            threat score. A user enters an address and gets a composite risk score, a per-hazard breakdown,
            a map of the live data behind it, a plain-language explanation, and safety resources for the
            top hazard.
          </p>
        </section>

        {/* Scoring Architecture Schematic */}
        <section className="max-w-5xl mx-auto px-6 py-10 border-t border-gray-200/80 dark:border-white/10">
          <div className="mb-8">
            <h2 className="text-xl font-medium text-gray-900 dark:text-white">How the score is built</h2>
          </div>

          <div className="space-y-4">
            {/* 3-Step Horizontal Flow */}
            <div className="grid grid-cols-1 md:grid-cols-[1fr_auto_1fr_auto_1fr] items-stretch gap-3">
              {/* Step 1 */}
              <div className="bg-white dark:bg-[#1c1915] p-5 border border-gray-800 dark:border-white/20 flex flex-col justify-between">
                <div>
                  <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-[#d96b38]">
                    Step 1 · Each Hazard
                  </span>
                  <div className="text-3xl font-bold tracking-tight text-gray-950 dark:text-white mt-2">
                    50 / 50
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-2.5 leading-relaxed">
                    Historical record + live conditions, scored for each of the 6 hazards
                  </p>
                </div>
              </div>

              {/* Arrow 1 -> 2 */}
              <div className="flex items-center justify-center py-1 md:py-0 text-[#d96b38]" aria-hidden="true">
                <svg className="w-6 h-6 rotate-90 md:rotate-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M13 5l7 7-7 7v-4H4v-6h9V5z" />
                </svg>
              </div>

              {/* Step 2 */}
              <div className="bg-white dark:bg-[#1c1915] p-5 border border-gray-800 dark:border-white/20 flex flex-col justify-between">
                <div>
                  <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-[#d96b38]">
                    Step 2 · Combine Hazards
                  </span>
                  <div className="text-3xl font-bold tracking-tight text-gray-950 dark:text-white mt-2">
                    60 / 40
                  </div>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-2.5 leading-relaxed">
                    60% worst hazard + 40% average of the top 3, so hazards that don&apos;t apply can&apos;t dilute real risk
                  </p>
                </div>
              </div>

              {/* Arrow 2 -> 3 */}
              <div className="flex items-center justify-center py-1 md:py-0 text-[#d96b38]" aria-hidden="true">
                <svg className="w-6 h-6 rotate-90 md:rotate-0" viewBox="0 0 24 24" fill="currentColor">
                  <path d="M13 5l7 7-7 7v-4H4v-6h9V5z" />
                </svg>
              </div>

              {/* Step 3 */}
              <div className="bg-[#1c1b1a] dark:bg-[#0e0d0c] p-5 border border-gray-900 dark:border-white/20 text-white flex flex-col justify-between">
                <div>
                  <span className="text-[11px] font-mono font-semibold uppercase tracking-wider text-[#e2b46d]">
                    Step 3 · Add Wildfire Model
                  </span>
                  <div className="text-3xl font-bold tracking-tight text-[#df7541] mt-2">
                    80 / 20
                  </div>
                  <p className="text-xs text-gray-200 mt-2.5 leading-relaxed">
                    80% combined hazard score + {SCORE_WEIGHTS.wildfireModel}% this week&apos;s ML wildfire forecast
                  </p>
                </div>
              </div>
            </div>

            {/* Net Weight Banner */}
            <div className="bg-[#df7a47] text-white px-4 py-2.5 text-center text-xs sm:text-sm font-semibold tracking-wide">
              Net weight in every score:{' '}
              <span className="font-bold">History {SCORE_WEIGHTS.historical}%</span>
              <span className="mx-2 opacity-80">·</span>
              <span className="font-bold">Live conditions {SCORE_WEIGHTS.live}%</span>
              <span className="mx-2 opacity-80">·</span>
              <span className="font-bold">ML wildfire {SCORE_WEIGHTS.wildfireModel}%</span>
            </div>

            {/* 4 Tier Legend Strip */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div className="bg-[#f3e3c3] text-[#1c1915] py-3 px-4 text-center">
                <div className="text-xs font-bold">Low</div>
                <div className="text-xs font-semibold mt-0.5">0–29</div>
              </div>
              <div className="bg-[#ebc580] text-[#1c1915] py-3 px-4 text-center">
                <div className="text-xs font-bold">Moderate</div>
                <div className="text-xs font-semibold mt-0.5">30–49</div>
              </div>
              <div className="bg-[#df7a47] text-white py-3 px-4 text-center">
                <div className="text-xs font-bold">Elevated</div>
                <div className="text-xs font-semibold mt-0.5">50–74</div>
              </div>
              <div className="bg-[#8b1c12] text-white py-3 px-4 text-center">
                <div className="text-xs font-bold">Critical</div>
                <div className="text-xs font-semibold mt-0.5">75–100</div>
              </div>
            </div>
          </div>
        </section>

        <ScoreExplainer />

        {/* Expected annual loss */}
        <section className="max-w-5xl mx-auto px-6 py-10 border-t border-gray-200/80 dark:border-white/10">
          <div className="mb-6">
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

        {/* <NriExplainer /> */}

        {/* Agency Ingestion Feeds */}
        <section className="max-w-5xl mx-auto px-6 py-12 border-t border-gray-200/80 dark:border-white/10">
          <div className="mb-8">
            <h2 className="text-xl font-medium text-gray-900 dark:text-white">Data Sources</h2>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 max-w-2xl leading-relaxed">
              The public datasets and agency feeds behind our scores, maps, and loss estimates.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
            {DATA_SOURCES.map((src) => (
              <div
                key={src.name}
                className="p-6 bg-white dark:bg-[#181613] border border-gray-200 dark:border-white/10 rounded-2xl flex flex-col justify-between shadow-2xs hover:border-gray-400 dark:hover:border-white/25 transition-colors"
              >
                <div>
                  <div className="mb-3">
                    <span className="text-[10px] font-mono uppercase tracking-wider px-2 py-0.5 rounded-md bg-gray-100 text-gray-700 dark:bg-white/10 dark:text-gray-200 font-semibold">
                      {src.agency}
                    </span>
                  </div>
                  <h3 className="text-base font-medium text-gray-950 dark:text-white">{src.name}</h3>
                  <p className="text-xs text-gray-600 dark:text-gray-400 mt-2 leading-relaxed">
                    {src.description}
                  </p>
                </div>

                <div className="mt-6 pt-4 border-t border-gray-100 dark:border-white/10 flex items-center justify-end text-xs font-mono text-gray-500 dark:text-gray-400">
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
            <h2 className="text-xl font-medium text-gray-900 dark:text-white">Live Signals And How They Score</h2>
            <p className="text-sm text-gray-600 dark:text-gray-400 mt-1 max-w-2xl leading-relaxed">
              Each hazard gets a threat score from 0 to 100. Live sources make up half of it.
              If there are no live warnings, the live score is 0.
              <br />Here is how we score live signals of varying severity:
            </p>
          </div>

          <div className="overflow-x-auto bg-white dark:bg-[#181613] border border-gray-200 dark:border-white/10 rounded-xl shadow-2xs">
            <table className="w-full text-left border-collapse text-sm">
              <thead>
                <tr className="border-b border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#211e1a] text-xs font-semibold text-slate-700 dark:text-gray-300">
                  <th scope="col" className="px-4 py-3 align-middle whitespace-nowrap">Hazard</th>
                  <th scope="col" className="px-4 py-3 align-middle whitespace-nowrap">Live Sources</th>
                  {SEVERITY_BANDS.map((band) => (
                    <th key={band.label} scope="col" className="px-4 py-3 align-middle whitespace-nowrap">
                      {band.label}{' '}
                      <span className="font-normal text-slate-500 dark:text-gray-400">({band.range})</span>
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/10 text-slate-900 dark:text-gray-100">
                {LIVE_SIGNALS.map((row) => (
                  <tr key={row.hazard} className="align-top">
                    <th scope="row" className="px-4 py-3.5 font-bold whitespace-nowrap">{row.hazard}</th>
                    <td className="px-4 py-3.5 text-slate-700 dark:text-gray-300 min-w-[9rem] max-w-[13rem]">
                      <ul className="space-y-0.5 leading-snug">
                        {row.sources.map((source) => (
                          <li key={source}>{source}</li>
                        ))}
                      </ul>
                    </td>
                    {SEVERITY_BANDS.map((band) => {
                      const levels = row.levels
                        .filter((level) => level.score >= band.min && level.score <= band.max)
                        .sort((a, b) => a.score - b.score);
                      return (
                        <td key={band.label} className="px-4 py-3.5 min-w-[11rem]">
                          {levels.length === 0 ? (
                            <span className="text-gray-400 dark:text-gray-500" aria-label="None">
                              —
                            </span>
                          ) : (
                            <ol className="space-y-2">
                              {levels.map((level) => (
                                <li key={level.condition} className="flex items-start gap-2">
                                  <span
                                    className={`inline-flex w-9 shrink-0 justify-center rounded-full border py-0.5 text-xs font-semibold tabular-nums ${band.badge}`}
                                  >
                                    {level.score}
                                  </span>
                                  <span className="leading-snug pt-0.5">{level.condition}</span>
                                </li>
                              ))}
                            </ol>
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </main>

      <Footer />
    </div>
  );
}
