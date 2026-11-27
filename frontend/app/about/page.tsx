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
      'Every federal major disaster and fire declaration since 2006, by county and incident type. Ranking counties by distinct declarations per hazard gives the historical part of each hazard score. Emergency declarations and COVID-19 are left out.',
    link: 'https://www.fema.gov/openfema-data-page/disaster-declarations-summaries-v2',
  },
  {
    name: 'Earthquake Catalog',
    agency: 'USGS',
    resolution: 'Epicenter (latitude and longitude)',
    description:
      "Magnitude 3.0+ earthquakes from the past week score a county's live earthquake signal by magnitude and distance (for example M5.5+ within 20 miles). Magnitude 4.5+ earthquakes within 60 miles since 2006 give its earthquake history, where FEMA declarations are too rare to compare counties.",
    link: 'https://earthquake.usgs.gov/fdsnws/event/1/',
  },
  {
    name: 'Active Weather Alerts',
    agency: 'NOAA / NWS',
    resolution: 'County (from each alert’s county codes)',
    description:
      "Every active warning, watch and advisory in the US, in one nationwide request. Each alert type we track has a fixed live score, such as Red Flag Warning 100, Flood Warning 85 and Wind Advisory 35. Our AWS Lambda also archives county alerts for a rolling year, as a backup when the live feed is unreachable.",
    link: 'https://www.weather.gov/documentation/services-web-api',
  },
  {
    name: 'Weather Forecast',
    agency: 'Open-Meteo',
    resolution: 'County center point',
    description:
      'The next 24 hours of wind gusts and humidity. An hour with humidity at or below 15% and gusts of 25 mph or more counts as fire weather, and gusts of 40 or 58 mph count as damaging wind. Its daily forecast also supplies the current week for the wildfire model.',
    link: 'https://open-meteo.com/en/docs',
  },
  {
    name: 'River Gauges',
    agency: 'NOAA / NWPS',
    resolution: 'Individual river gauges in and near the county',
    description:
      "Whether rivers are observed or forecast to reach flood stage. Major, moderate and minor flooding score a county's live flood signal at 100, 85 and 70, and the action stage just below flooding scores 40.",
    link: 'https://water.noaa.gov/',
  },
  {
    name: 'Wildfire Ignition Model',
    agency: 'MTBS / NASA POWER',
    resolution: 'County',
    description:
      'Our XGBoost model of the weekly chance that a large wildfire (about 1,000+ acres in the West, 500+ in the East) starts in each county. Trained on MTBS fire records and NASA POWER weather from 2010 to 2018, calibrated on 2019 and 2020, and tested on 2021 to 2024. It makes up 20% of the overall score.',
    link: 'https://www.mtbs.gov/',
  },
  {
    name: 'National Risk Index (NRI)',
    agency: 'FEMA',
    resolution: 'County (Connecticut by planning region)',
    description:
      "Modeled expected annual loss in dollars, plus social vulnerability and community resilience ratings. We use its losses for the 11 of its 18 hazards that match ours, for the map's loss measures and the Expected Annual Loss panels. It isn't part of the risk score.",
    link: 'https://hazards.fema.gov/nri/',
  },
  {
    name: 'County Population Estimates',
    agency: 'U.S. Census Bureau',
    resolution: 'County',
    description:
      "Each county's population, used to weight state scores toward where people live and to order search results. Puerto Rico isn't covered, so its municipios are weighted equally.",
    link: 'https://www.census.gov/programs-surveys/popest.html',
  },
];

// Mirrors ALERT_RULES in backend/app/domain/hazards.py and the thresholds in
// backend/app/domain/scoring.py. Change them together.
const LIVE_SIGNALS = [
  {
    hazard: 'Wildfire',
    sources: 'NWS fire alerts; Open-Meteo humidity and gusts, next 24 hours',
    lower: 'Fire Weather Watch 60 · humidity ≤ 15% with gusts ≥ 25 mph in the same hour 80',
    highest: 'Red Flag Warning or Fire Warning: 100',
  },
  {
    hazard: 'Severe storm',
    sources: 'NWS storm, wind and winter alerts; Open-Meteo peak gusts',
    lower: 'Wind Advisory 35 · gusts ≥ 40 mph 70 · High Wind Warning 75 · Severe Thunderstorm Warning 90',
    highest: 'Extreme Wind Warning or gusts ≥ 58 mph: 100',
  },
  {
    hazard: 'Flood',
    sources: 'NWS flood alerts; NOAA river gauges in and near the county',
    lower: 'Flood Advisory 35 · gauge at action stage 40 · minor flooding 70 · Flood Warning or moderate flooding 85',
    highest: 'Flash Flood Warning or major river flooding: 100',
  },
  {
    hazard: 'Hurricane',
    sources: 'NWS tropical and storm surge alerts',
    lower: 'Tropical Storm Watch 50 · Tropical Storm Warning 75 · Storm Surge Warning 90',
    highest: 'Hurricane Warning: 100',
  },
  {
    hazard: 'Tornado',
    sources: 'NWS tornado alerts',
    lower: 'Tornado Watch 65',
    highest: 'Tornado Warning: 100',
  },
  {
    hazard: 'Earthquake',
    sources: 'USGS earthquakes from the past 7 days',
    lower: 'M3.0+ within 30 mi 45 · M4.5+ within 30 mi 75',
    highest: 'M5.5+ within 20 mi: 100',
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
          <p className="text-xs text-gray-600 dark:text-gray-400 mt-5 leading-relaxed max-w-2xl">
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
          <div className="mb-6">
            <h2 className="text-xl font-medium text-gray-900 dark:text-white">How the score is built</h2>
            <p className="text-xs text-gray-600 dark:text-gray-400 mt-1 max-w-2xl leading-relaxed">
              The overall threat score consists of three parts: {SCORE_WEIGHTS.historical}%
              history, {SCORE_WEIGHTS.live}% live conditions and {SCORE_WEIGHTS.wildfireModel}% a wildfire
              model. History and live conditions are blended inside each hazard&apos;s own score, so every
              hazard bar is half history and half live. The hazards are then combined, weighted toward the
              worst one (60% the highest score plus 40% the average of the top three), and the wildfire model
              is added on top. Because only wildfire gets a model of its own, the overall score leans toward
              wildfire risk by design.
            </p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-3 gap-6 bg-[#f7f5ef] dark:bg-[#161411] p-6 rounded-2xl border border-[#ece4d0] dark:border-white/10">
            <div className="bg-white dark:bg-[#1c1915] p-5 rounded-xl border border-gray-200 dark:border-white/10 shadow-2xs">
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-blue-50 text-blue-700 border border-blue-200 dark:bg-blue-950/60 dark:text-blue-300 dark:border-blue-800/60 font-semibold">
                {SCORE_WEIGHTS.historical}% Historical Baseline
              </span>
              <h3 className="text-sm font-bold text-gray-900 dark:text-white mt-3">Long-Term Exposure</h3>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1.5 leading-relaxed">
                A county&apos;s percentile rank, among counties that have had the hazard, by distinct FEMA disaster declarations since 2006. For earthquakes it uses USGS M4.5+ earthquakes within 60 miles instead.
              </p>
            </div>

            <div className="bg-white dark:bg-[#1c1915] p-5 rounded-xl border border-gray-200 dark:border-white/10 shadow-2xs">
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-rose-50 text-rose-700 border border-rose-200 dark:bg-rose-950/60 dark:text-rose-300 dark:border-rose-800/60 font-semibold">
                {SCORE_WEIGHTS.live}% Live Conditions
              </span>
              <h3 className="text-sm font-bold text-gray-900 dark:text-white mt-3">Real-Time Telemetry</h3>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1.5 leading-relaxed">
                Injected from hourly NWS alert polygons, HRRR wind gusts (&gt;40 mph), live river stages vs. flood crest, and USGS seismic events.
              </p>
            </div>

            <div className="bg-white dark:bg-[#1c1915] p-5 rounded-xl border border-gray-200 dark:border-white/10 shadow-2xs">
              <span className="text-[10px] font-mono uppercase px-2 py-0.5 rounded-full bg-amber-50 text-amber-800 border border-amber-200 dark:bg-amber-950/60 dark:text-amber-300 dark:border-amber-800/60 font-semibold">
                {SCORE_WEIGHTS.wildfireModel}% Wildfire Model
              </span>
              <h3 className="text-sm font-bold text-gray-900 dark:text-white mt-3">Weekly Ignition Forecast</h3>
              <p className="text-xs text-gray-600 dark:text-gray-400 mt-1.5 leading-relaxed">
                A machine-learning model trained on large wildfires since 2010 estimates the chance one
                starts in the county this week, from recent heat, dryness and rain, the week&apos;s forecast
                and local fire history. That chance is scored on a log scale: 0.01% scores 0, 0.1% scores
                33, 1% scores 67 and 10% or more scores 100. When the model has no forecast for an area, the
                score uses history and live conditions alone.
              </p>
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
            <p className="text-s text-gray-600 dark:text-gray-400 mt-1 max-w-2.5xl leading-relaxed">
              Each hazard gets a threat score from 0 to 100.  Live signals from these sources make up half of that score. 
              If there are no live warnings, the live score is 0. Here is how we evaluate the severity of live warnings:
            </p>
          </div>

          <div className="overflow-x-auto bg-white dark:bg-[#181613] border border-gray-200 dark:border-white/10 rounded-xl shadow-2xs">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="border-b border-gray-200 dark:border-white/10 bg-gray-50 dark:bg-[#211e1a] font-mono text-gray-500 dark:text-gray-400 text-[11px]">
                  <th className="p-3.5">Hazard</th>
                  <th className="p-3.5">Live sources</th>
                  <th className="p-3.5">Lower live scores</th>
                  <th className="p-3.5">Highest live score</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-100 dark:divide-white/10 text-gray-700 dark:text-gray-300">
                {LIVE_SIGNALS.map((row) => (
                  <tr key={row.hazard}>
                    <td className="p-3.5 font-bold text-gray-900 dark:text-white">{row.hazard}</td>
                    <td className="p-3.5">{row.sources}</td>
                    <td className="p-3.5 font-mono">{row.lower}</td>
                    <td className="p-3.5 font-mono text-rose-700 dark:text-rose-400 font-semibold">{row.highest}</td>
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
