// frontend/components/map/RiskLeafletMap.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, useMap } from 'react-leaflet';
import L from 'leaflet';
import * as topojson from 'topojson-client';
import 'leaflet/dist/leaflet.css';
import { MapViewMode, MetricOption, RiskDataPayload } from '@/lib/types';
import { BOUNDARIES_URL, STATE_FIPS_ON_MAP, RATINGS, NO_DATA } from '@/lib/mockRiskData';
import MapLegend from './MapLegend';

interface Props {
  viewMode: MapViewMode;
  metric: MetricOption;
  data: RiskDataPayload;
  selectedId: string | null;
  onSelectFeature: (id: string, fallbackName: string) => void;
}

function quantileBreaks(values: (number | null | undefined)[], n = 5): number[] {
  const v = values
    .filter((x): x is number => x != null && !Number.isNaN(x))
    .sort((a, b) => a - b);
  if (!v.length) return [];
  const out: number[] = [];
  for (let i = 1; i < n; i++) {
    out.push(v[Math.floor((i / n) * (v.length - 1))]);
  }
  return out;
}

// Helper component inside MapContainer to handle fitBounds when a feature is clicked
function ZoomToBounds({ bounds, viewMode }: { bounds: L.LatLngBoundsExpression | null; viewMode: MapViewMode }) {
  const map = useMap();
  useEffect(() => {
    if (bounds) {
      map.fitBounds(bounds, {
        maxZoom: viewMode === 'states' ? 6 : 8,
        padding: [20, 20],
      });
    }
  }, [bounds, viewMode, map]);
  return null;
}

export default function RiskLeafletMap({
  viewMode,
  metric,
  data,
  selectedId,
  onSelectFeature,
}: Props) {
  const [shapes, setShapes] = useState<{ states: any; counties: any } | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [targetBounds, setTargetBounds] = useState<L.LatLngBoundsExpression | null>(null);

  useEffect(() => {
    async function loadBoundaries() {
      try {
        const res = await fetch(BOUNDARIES_URL);
        if (!res.ok) throw new Error(`Boundary file returned ${res.status}`);
        const topo = await res.json();

        const states: any = topojson.feature(topo, topo.objects.states);
        const counties: any = topojson.feature(topo, topo.objects.counties);

        states.features = states.features.filter((f: any) =>
          STATE_FIPS_ON_MAP.has(String(f.id).padStart(2, '0'))
        );
        counties.features = counties.features.filter((f: any) =>
          STATE_FIPS_ON_MAP.has(String(f.id).padStart(5, '0').slice(0, 2))
        );

        setShapes({ states, counties });
        setLoading(false);
      } catch (err: any) {
        console.error(err);
        setError(err.message || 'Failed to load map boundaries');
        setLoading(false);
      }
    }
    loadBoundaries();
  }, []);

  const recordFor = (feature: any) => {
    const rawId = String(feature.id);
    const id = viewMode === 'states' ? rawId.padStart(2, '0') : rawId.padStart(5, '0');
    return (data[viewMode] as Record<string, any>)[id];
  };

  const activeFeatures = shapes ? shapes[viewMode].features : [];
  const activeRecords = activeFeatures.map(recordFor).filter(Boolean);
  const breaks = metric.categorical
    ? []
    : quantileBreaks(activeRecords.map((r: any) => r[metric.key]));

  const colorFor = (record: any): string => {
    if (!record) return NO_DATA;
    const v = record[metric.key];
    if (metric.categorical) {
      return (RATINGS.find((r) => r.label === v) || { color: NO_DATA }).color;
    }
    if (v == null || !metric.palette) return NO_DATA;
    let i = 0;
    while (i < breaks.length && v > breaks[i]) i++;
    return metric.palette[i];
  };

  const baseStyle = (feature: any) => {
    const rawId = String(feature.id);
    const id = viewMode === 'states' ? rawId.padStart(2, '0') : rawId.padStart(5, '0');
    const isSelected = selectedId === id;
    return {
      fillColor: colorFor(recordFor(feature)),
      fillOpacity: 0.85,
      color: isSelected ? '#1d232b' : '#ffffff',
      weight: isSelected ? 2.5 : viewMode === 'states' ? 1 : 0.3,
    };
  };

  const tooltipHtml = (feature: any) => {
    const r = recordFor(feature);
    if (!r) return `<b>${feature.properties?.name || `FIPS ${feature.id}`}</b><br/>No FEMA data for this area`;
    const name = viewMode === 'counties' ? `${r.name}, ${r.state}` : r.name;
    const v = r[metric.key];
    const shown = v == null ? 'No data' : metric.categorical ? v : metric.fmt ? metric.fmt(v) : v;
    return `<b>${name}</b><br/>${metric.label}: ${shown}`;
  };

  return (
    <div className="relative w-full h-[620px] rounded-xl overflow-hidden border border-[#e2e0db] bg-[#dfe6ea]">
      {loading && (
        <div className="absolute inset-0 z-[1000] grid place-items-center bg-[#f6f5f2]/85 text-sm text-[#5f6b78]">
          Loading map…
        </div>
      )}
      {error && (
        <div className="absolute inset-0 z-[1000] grid place-items-center bg-[#f6f5f2]/90 text-sm text-[#b8321f]">
          Couldn&apos;t load the map: {error}
        </div>
      )}

      <MapContainer
        bounds={[
          [24.5, -125],
          [49.5, -66.5],
        ]}
        preferCanvas={true}
        zoomSnap={0.25}
        minZoom={3}
        scrollWheelZoom={true}
        className="w-full h-full z-0"
      >
        <TileLayer
          maxZoom={16}
          url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Light_Gray_Base/MapServer/tile/{z}/{y}/{x}"
          attribution="Tiles &copy; Esri &mdash; Esri, HERE, Garmin, &copy; OpenStreetMap contributors"
        />

        <ZoomToBounds bounds={targetBounds} viewMode={viewMode} />

        {shapes && (
          <GeoJSON
            key={`${viewMode}-${metric.key}-${selectedId || 'none'}`}
            data={shapes[viewMode]}
            style={baseStyle}
            onEachFeature={(feature, layer: any) => {
              layer.bindTooltip(() => tooltipHtml(feature), {
                sticky: true,
                className: 'risk-tip',
              });
              layer.on({
                mouseover: (e: any) =>
                  e.target.setStyle({
                    weight: viewMode === 'states' ? 2.5 : 1.5,
                    color: '#1d232b',
                  }),
                mouseout: (e: any) => e.target.setStyle(baseStyle(feature)),
                click: (e: any) => {
                  const rawId = String(feature.id);
                  const id = viewMode === 'states' ? rawId.padStart(2, '0') : rawId.padStart(5, '0');
                  setTargetBounds(e.target.getBounds());
                  onSelectFeature(id, feature.properties?.name || `Area ${id}`);
                },
              });
            }}
          />
        )}

        {/* Keep white state borders visible on top when viewing counties */}
        {shapes && viewMode === 'counties' && (
          <GeoJSON
            key="state-borders-overlay"
            data={shapes.states}
            style={{ fill: false, color: '#ffffff', weight: 1.2 }}
            interactive={false}
          />
        )}
      </MapContainer>

      <MapLegend metric={metric} breaks={breaks} />
    </div>
  );
}
