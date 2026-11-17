// frontend/app/map/page.tsx
'use client';

import React, { useCallback, useEffect, useRef, useState } from 'react';
import dynamic from 'next/dynamic';
import * as d3 from 'd3';
import * as topojson from 'topojson-client';
import Navigation from '@/components/common/Navigation';
import Footer from '@/components/common/Footer';
import MapControls, { Measure } from '@/components/map/MapControls';
import MapLegend from '@/components/map/MapLegend';
import StateInspector from '@/components/map/StateInspector';
import CountyInspector from '@/components/map/CountyInspector';
import { fetchCounty, fetchMapValues, fetchState, HazardKey, MapMetric, searchCounties } from '@/lib/api';
import { formatPct, formatUsd } from '@/lib/format';
import { bandColor, HAZARDS, quantileBands, SCORE_BANDS } from '@/lib/riskColors';
import { StateRecord, CountyRecord, MapValue } from '@/lib/types';

const RiskLeafletMap = dynamic(
  () => import('@/components/map/RiskLeafletMap'),
  {
    ssr: false,
    loading: () => (
      <div className="w-full h-[580px] bg-gray-100/80 animate-pulse rounded-2xl flex items-center justify-center border border-gray-200">
        <span className="text-xs font-mono text-gray-500">Initializing GIS Map...</span>
      </div>
    ),
  }
);

const DEFAULT_STATE_CODE = 'CA';

type ViewMode = 'states' | 'counties';

const levelFor = (mode: ViewMode) => (mode === 'states' ? 'state' : 'county');

/** The backend metric (and hazard filter) for a measure and hazard selection. */
function queryFor(measure: Measure, hazard: HazardKey | null): [MapMetric, HazardKey | undefined] {
  if (measure === 'score') return [hazard ?? 'compositeScore', undefined];
  if (measure === 'highLossPct') return ['highLossPct', undefined];
  return [measure, hazard ?? undefined];
}

export default function RiskMapPage() {
  const [viewMode, setViewMode] = useState<ViewMode>('states');
  const [measureChoice, setMeasure] = useState<Measure>('score');
  const [hazard, setHazard] = useState<HazardKey | null>(null); // null: all hazards
  const [selectedState, setSelectedState] = useState<StateRecord | null>(null);
  const [selectedCounty, setSelectedCounty] = useState<CountyRecord | null>(null);
  const [loading, setLoading] = useState(true); // The first area loads on mount
  const [error, setError] = useState<string | null>(null);

  // Map colours, cached by "level:metric:hazard" so switching back is instant.
  const [mapValues, setMapValues] = useState<Record<string, Record<string, MapValue>>>({});
  const [mapError, setMapError] = useState<string | null>(null);

  // Each request gets a number. Responses to older requests are ignored, so a slow
  // response can't overwrite the area the user clicked most recently.
  const latestRequest = useRef(0);
  // loadCounty reads the current state code through a ref, so it doesn't need to
  // be recreated whenever the selected state changes.
  const selectedStateCode = useRef<string | null>(null);
  useEffect(() => {
    selectedStateCode.current = selectedState?.code ?? null;
  }, [selectedState]);

  // Mark a new request as in flight, and return its number. Click handlers call
  // this; the initial load doesn't need to, since loading already starts as true.
  const startRequest = () => {
    setLoading(true);
    setError(null);
    return ++latestRequest.current;
  };

  const finishRequest = useCallback((request: number, err?: unknown, what?: string) => {
    if (request !== latestRequest.current) return;
    if (err) setError(`Couldn't load ${what}: ${String(err)}`);
    setLoading(false);
  }, []);

  // Load a state into the side panel. State updates only happen after the fetch.
  const loadState = useCallback(
    (code: string, request: number) => {
      fetchState(code)
        .then((state) => {
          if (request !== latestRequest.current) return;
          setSelectedState(state);
          setSelectedCounty(null);
          finishRequest(request);
        })
        .catch((err) => finishRequest(request, err, code));
    },
    [finishRequest]
  );

  // Load a county, and its state too if it's in a different state than the panel's,
  // so "Back to <state>" shows the county's own state.
  const loadCounty = useCallback(
    (fips: string, request: number) => {
      fetchCounty(fips)
        .then(async (county) => {
          const state =
            county.stateCode && county.stateCode !== selectedStateCode.current
              ? await fetchState(county.stateCode)
              : null;
          if (request !== latestRequest.current) return;
          if (state) setSelectedState(state);
          setSelectedCounty(county);
          setViewMode('counties');
          finishRequest(request);
        })
        .catch((err) => finishRequest(request, err, `county ${fips}`));
    },
    [finishRequest]
  );

  // First load: a county from the URL (?fips=06065 or ?q=Palm Springs, CA, as the
  // home page links), otherwise the default state.
  useEffect(() => {
    const request = ++latestRequest.current;
    const params = new URLSearchParams(window.location.search);
    const fips = params.get('fips');
    const query = params.get('q');
    if (fips) {
      loadCounty(fips, request);
    } else if (query) {
      searchCounties(query, 1)
        .then((results) => {
          if (results.length > 0) loadCounty(results[0].fips, request);
          else loadState(DEFAULT_STATE_CODE, request);
        })
        .catch(() => loadState(DEFAULT_STATE_CODE, request));
    } else {
      loadState(DEFAULT_STATE_CODE, request);
    }
  }, [loadCounty, loadState]);

  // The high-loss share only exists for states, so county view falls back to loss
  // per person. Likewise it covers all hazards together, so it ignores the hazard.
  const measure: Measure =
    viewMode === 'counties' && measureChoice === 'highLossPct' ? 'lossPerPerson' : measureChoice;
  const activeHazard = measure === 'highLossPct' ? null : hazard;
  const [metric, hazardFilter] = queryFor(measure, activeHazard);

  // Fetch map colours for the current view, measure and hazard, unless they're cached.
  const valuesKey = `${levelFor(viewMode)}:${metric}:${hazardFilter ?? 'all'}`;
  const currentValues = mapValues[valuesKey];
  useEffect(() => {
    if (currentValues) return;
    fetchMapValues(levelFor(viewMode), metric, hazardFilter)
      .then((values) => {
        setMapValues((cached) => ({ ...cached, [valuesKey]: values }));
        setMapError(null);
      })
      .catch((err) => setMapError(`Couldn't load map colours: ${String(err)}`));
  }, [currentValues, valuesKey, viewMode, metric, hazardFilter]);

  // Handle clicking a polygon on the map
  const handleFeatureSelect = (id: string, type: 'state' | 'county') => {
    if (type === 'county') loadCounty(id, startRequest());
    else loadState(id, startRequest());
  };

  // Called when clicking "View county breakdown": show the county map, and keep the
  // state panel until a county is clicked.
  const handleDrillDownToCounties = () => {
    setViewMode('counties');
    setSelectedCounty(null);
  };

  // Legend, colours and tooltips for the current measure
  const hazardLabel = HAZARDS.find((h) => h.key === activeHazard)?.label ?? 'All hazards';
  const hazardSuffix = activeHazard ? ` · ${hazardLabel}` : '';
  const format = measure === 'highLossPct' ? formatPct : formatUsd;
  const bands =
    measure === 'score'
      ? SCORE_BANDS
      : quantileBands(Object.values(currentValues ?? {}).map((v) => v.value), format);
  const legend = {
    score: { title: `Risk score (0–100)${hazardSuffix}`, note: undefined },
    lossPerPerson: {
      title: `Expected annual loss per person${hazardSuffix}`,
      note: 'FEMA NRI estimate, $ per resident per year. 11 of 18 NRI hazards.',
    },
    totalLoss: {
      title: `Total expected annual loss${hazardSuffix}`,
      note: 'FEMA NRI estimate, $ per year. 11 of 18 NRI hazards.',
    },
    highLossPct: {
      title: '% of residents in high-loss counties',
      note: 'High-loss: top 20% of counties nationally for FEMA expected loss per person.',
    },
  }[measure];
  const describe = (value: MapValue) => {
    if (measure === 'score') return `Risk score${hazardSuffix}: <b>${Math.round(value.value)}</b>/100 · ${value.tier}`;
    if (measure === 'lossPerPerson') return `Expected loss: <b>${formatUsd(value.value)}</b> per person/yr`;
    if (measure === 'totalLoss') return `Expected loss: <b>${formatUsd(value.value)}</b>/yr`;
    return `<b>${formatPct(value.value)}</b> of residents in high-loss counties`;
  };

  return (
    <div className="min-h-screen bg-[#fcfbf7] text-[#111827] flex flex-col justify-between">
      <Navigation />

      <main className="max-w-7xl w-full mx-auto px-6 py-8">
        <MapControls
          viewMode={viewMode}
          onViewModeChange={(mode) => {
            setViewMode(mode);
            if (mode === 'states') setSelectedCounty(null);
          }}
          measure={measure}
          onMeasureChange={setMeasure}
          hazard={activeHazard}
          onHazardChange={setHazard}
          onSelectCounty={(fips) => loadCounty(fips, startRequest())}
        />

        {mapError && (
          <p className="mb-3 p-3 text-xs text-red-900 bg-red-50 border border-red-200 rounded-xl">
            {mapError}. Is the backend running?
          </p>
        )}

        <div className="flex flex-col lg:flex-row gap-6 mt-4">
          {/* self-start: keep this box the map's height even when the side panel is
              taller, so the legend stays pinned to the map's bottom-left corner */}
          <div className="flex-1 relative self-start w-full">
            <RiskLeafletMap
              viewMode={viewMode}
              values={currentValues}
              valuesKey={valuesKey}
              colorFor={(value) => bandColor(value, bands)}
              describe={describe}
              onSelectFeature={handleFeatureSelect}
            />
            <MapLegend title={legend.title} bands={bands} note={legend.note} />
          </div>

          {/* Conditional Sidebar: Shows County details if in county mode, State details otherwise */}
          <div className={`relative ${loading ? 'opacity-60 transition-opacity' : ''}`}>
            {error && (
              <p className="mb-3 p-3 text-xs text-red-900 bg-red-50 border border-red-200 rounded-xl lg:w-88">
                {error}. Is the backend running?
              </p>
            )}
            {viewMode === 'counties' && selectedCounty ? (
              <CountyInspector
                county={selectedCounty}
                onBackToState={() => {
                  setViewMode('states');
                  setSelectedCounty(null);
                }}
              />
            ) : selectedState ? (
              <StateInspector
                stateData={selectedState}
                onDrillDown={handleDrillDownToCounties}
              />
            ) : (
              <aside className="w-full lg:w-88 bg-white border border-gray-200/90 rounded-2xl p-6 text-xs font-mono text-gray-500">
                {error ? 'No data to show.' : 'Loading risk data...'}
              </aside>
            )}
          </div>
        </div>
      </main>

      <Footer />
    </div>
  );
}
