// frontend/components/map/RiskLeafletMap.tsx
'use client';

import React, { useEffect, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON } from 'react-leaflet';
import type { FeatureCollection } from 'geojson';
import 'leaflet/dist/leaflet.css';
import { MapValue } from '@/lib/types';

interface Props {
  viewMode: 'states' | 'counties';
  // Values for the current view, keyed by state code or county FIPS. Undefined while loading.
  values?: Record<string, MapValue>;
  // Identifies what `values` holds, e.g. "county:lossPerPerson:flood". The map
  // redraws when it changes.
  valuesKey: string;
  // Fill colour for an area's value (undefined: no data)
  colorFor: (value: number | undefined) => string;
  // Tooltip line for an area's value, e.g. "Loss per person: $447/yr"
  describe: (value: MapValue) => string;
  // id is the state's postal code (e.g. "CA") or the county's FIPS code (e.g. "06065")
  onSelectFeature?: (id: string, type: 'state' | 'county') => void;
}

export default function RiskLeafletMap({
  viewMode,
  values,
  valuesKey,
  colorFor,
  describe,
  onSelectFeature,
}: Props) {
  const [statesGeo, setStatesGeo] = useState<FeatureCollection | null>(null);
  const [countiesGeo, setCountiesGeo] = useState<FeatureCollection | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  // Read CARTO API key from Next.js environment variable
  const cartoApiKey = process.env.NEXT_PUBLIC_CARTO_API_KEY;

  // If key is present in env, use CARTO Positron; otherwise fallback gracefully to OpenStreetMap
  const tileUrl = cartoApiKey
    ? `https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}.png?key=${cartoApiKey}`
    : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

  const tileAttribution = cartoApiKey
    ? '&copy; <a href="https://carto.com/">CARTO</a>'
    : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

  useEffect(() => {
    // 1. Fetch US States GeoJSON (feature ids are postal codes)
    const fetchStates = fetch(
      'https://raw.githubusercontent.com/python-visualization/folium-example-data/main/us_states.json'
    ).then((res) => res.json());

    // 2. Fetch US Counties GeoJSON (feature ids are FIPS codes)
    const fetchCounties = fetch(
      'https://raw.githubusercontent.com/plotly/datasets/master/geojson-counties-fips.json'
    ).then((res) => res.json());

    Promise.all([fetchStates, fetchCounties])
      .then(([statesData, countiesData]) => {
        setStatesGeo(statesData);
        setCountiesGeo(countiesData);
        setLoading(false);
      })
      .catch((err) => console.error('Error fetching map boundaries:', err));
  }, []);

  const tooltip = (name: string, id: string) => {
    const value = values?.[id];
    const line = !values ? 'Loading...' : value ? describe(value) : 'No data';
    return `<b>${name}</b><br/>${line}`;
  };

  // GeoJSON layers only read `style` and `onEachFeature` when they mount, so the
  // key changes whenever new values arrive to redraw them with the new colours.
  const layerKey = values ? valuesKey : `${valuesKey}-loading`;

  return (
    <div className="relative w-full h-[620px] rounded-2xl overflow-hidden border border-gray-200/90 shadow-sm bg-[#e8ecef]">
      {/* Loading Overlay */}
      {loading && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-white/75 backdrop-blur-xs">
          <div className="w-8 h-8 border-3 border-gray-400 border-t-black rounded-full animate-spin mb-2" />
          <span className="font-mono text-xs text-gray-700">Loading North America Geographic Boundary Layers...</span>
        </div>
      )}

      {/* Map Centered over North America */}
      <MapContainer
        center={[45.0, -100.0]}
        zoom={3.5}
        minZoom={3}
        maxZoom={9}
        scrollWheelZoom={true}
        className="w-full h-full z-0"
      >
        <TileLayer attribution={tileAttribution} url={tileUrl} />

        {/* States Overview Mode */}
        {viewMode === 'states' && statesGeo && (
          <GeoJSON
            key={`states-${layerKey}`}
            data={statesGeo}
            style={(feature) => ({
              fillColor: colorFor(values?.[String(feature?.id)]?.value),
              weight: 1.2,
              opacity: 1,
              color: '#2d3748',
              fillOpacity: 0.7,
            })}
            onEachFeature={(feature, layer) => {
              const id = String(feature.id ?? '');
              const stateName = feature.properties?.name || 'Unknown State';
              layer.bindTooltip(tooltip(stateName, id), { sticky: true });
              layer.on({
                click: () => id && onSelectFeature?.(id, 'state'),
                mouseover: (e) => e.target.setStyle({ weight: 2.2, color: '#000000', fillOpacity: 0.9 }),
                mouseout: (e) => e.target.setStyle({ weight: 1.2, color: '#2d3748', fillOpacity: 0.7 }),
              });
            }}
          />
        )}

        {/* Counties Detailed Mode */}
        {viewMode === 'counties' && countiesGeo && (
          <GeoJSON
            key={`counties-${layerKey}`}
            data={countiesGeo}
            style={(feature) => ({
              fillColor: colorFor(values?.[String(feature?.id)]?.value),
              weight: 0.35,
              opacity: 0.8,
              color: '#4a5568',
              fillOpacity: 0.65,
            })}
            onEachFeature={(feature, layer) => {
              const id = String(feature.id ?? '');
              const countyName = feature.properties?.NAME || `County ${id}`;
              layer.bindTooltip(tooltip(countyName, id), { sticky: true });
              layer.on({
                click: () => id && onSelectFeature?.(id, 'county'),
                mouseover: (e) => e.target.setStyle({ weight: 1.5, color: '#000000', fillOpacity: 0.9 }),
                mouseout: (e) => e.target.setStyle({ weight: 0.35, color: '#4a5568', fillOpacity: 0.65 }),
              });
            }}
          />
        )}
      </MapContainer>
    </div>
  );
}
