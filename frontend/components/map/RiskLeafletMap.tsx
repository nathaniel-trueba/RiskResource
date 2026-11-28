// frontend/components/map/RiskLeafletMap.tsx
'use client';

import React, { useEffect, useRef, useState } from 'react';
import { MapContainer, TileLayer, GeoJSON, Pane, useMap, useMapEvents } from 'react-leaflet';
import L from 'leaflet';
import type { Feature, FeatureCollection, Position } from 'geojson';
import 'leaflet/dist/leaflet.css';
import { MapValue } from '@/lib/types';

const DEFAULT_CENTER: [number, number] = [45.0, -100.0];
const DEFAULT_ZOOM = 3.5;

/** An area to zoom to: a state by postal code ("CA") or a county by FIPS ("06065"). */
export interface MapFocus {
  type: 'state' | 'county';
  id: string;
}

// How far in each kind of focus may zoom, so a small county still shows its region.
const FOCUS_MAX_ZOOM = { state: 7, county: 8 };

/**
 * A feature's bounding box. Longitudes east of 0° are shifted west by 360°, because
 * every US area is in the western hemisphere except Alaska's Aleutian Islands, which
 * cross the 180° line. Without the shift Alaska's box spans the whole globe.
 */
function boundsOf(feature: Feature): L.LatLngBounds {
  const bounds = L.latLngBounds([]);
  const visit = (coords: unknown): void => {
    if (typeof (coords as Position)[0] === 'number') {
      const [lng, lat] = coords as Position;
      bounds.extend([lat, lng > 0 ? lng - 360 : lng]);
    } else {
      (coords as unknown[]).forEach(visit);
    }
  };
  if (feature.geometry && 'coordinates' in feature.geometry) visit(feature.geometry.coordinates);
  return bounds;
}

// Flies the map to `focus` when it's set, and back to the national view when it's
// cleared. Skips redundant zoom animation if already zoomed in on the target.
function FocusOn({
  focus,
  statesGeo,
  countiesGeo,
}: {
  focus?: MapFocus | null;
  statesGeo: FeatureCollection | null;
  countiesGeo: FeatureCollection | null;
}) {
  const map = useMap();
  const focused = useRef(false);

  useEffect(() => {
    if (!focus) {
      if (focused.current) map.flyTo(DEFAULT_CENTER, DEFAULT_ZOOM, { duration: 0.8 });
      focused.current = false;
      return;
    }
    const geo = focus.type === 'state' ? statesGeo : countiesGeo;
    const feature = geo?.features.find((f) => String(f.id) === focus.id);
    if (!feature) return;

    const targetBounds = boundsOf(feature);
    // The zoom flyToBounds would end at, given the same padding and cap as below
    const targetZoom = Math.min(
      map.getBoundsZoom(targetBounds, false, L.point(48, 48)),
      FOCUS_MAX_ZOOM[focus.type]
    );
    // Avoid re-playing the zoom animation if already zoomed in to about the target's
    // level with it in view. Being zoomed to its state isn't enough for a county.
    if (
      focused.current &&
      map.getZoom() >= targetZoom - 0.5 &&
      map.getBounds().pad(-0.15).contains(targetBounds.getCenter())
    ) {
      return;
    }

    map.flyToBounds(targetBounds, {
      padding: [24, 24],
      maxZoom: FOCUS_MAX_ZOOM[focus.type],
      duration: 0.8,
    });
    focused.current = true;
  }, [map, focus, statesGeo, countiesGeo]);

  return null;
}

// Automatically clears selection and zooms back out when clicking outside US polygons
function MapBackgroundClick({ onClear }: { onClear?: () => void }) {
  useMapEvents({
    click: () => {
      onClear?.();
    },
  });
  return null;
}

interface Props {
  viewMode: 'states' | 'counties';
  values?: Record<string, MapValue>;
  valuesKey: string;
  colorFor: (value: number | undefined) => string;
  describe: (value: MapValue) => string;
  onSelectFeature?: (id: string, type: 'state' | 'county') => void;
  onClearSelection?: () => void;
  selectedId?: string | null;
  focus?: MapFocus | null;
}

export default function RiskLeafletMap({
  viewMode,
  values,
  valuesKey,
  colorFor,
  describe,
  onSelectFeature,
  onClearSelection,
  selectedId,
  focus,
}: Props) {
  const [statesGeo, setStatesGeo] = useState<FeatureCollection | null>(null);
  const [countiesGeo, setCountiesGeo] = useState<FeatureCollection | null>(null);
  const [loading, setLoading] = useState<boolean>(true);

  const cartoApiKey = process.env.NEXT_PUBLIC_CARTO_API_KEY;

  const tileUrl = cartoApiKey
    ? `https://basemaps.cartocdn.com/rastertiles/light_all/{z}/{x}/{y}.png?key=${cartoApiKey}`
    : 'https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png';

  const tileAttribution = cartoApiKey
    ? '&copy; <a href="https://carto.com/">CARTO</a>'
    : '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors';

  useEffect(() => {
    const fetchStates = fetch(
      'https://raw.githubusercontent.com/python-visualization/folium-example-data/main/us_states.json'
    ).then((res) => res.json());

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

  // Re-mount GeoJSON when data values or selectedId change so borders update cleanly
  const layerKey = `${values ? valuesKey : `${valuesKey}-loading`}-${selectedId ?? 'none'}`;

  return (
    <div className="relative w-full h-[620px] rounded-2xl overflow-hidden border border-gray-200/90 dark:border-white/10 shadow-sm bg-[#e8ecef]">
      {/* Loading Overlay */}
      {loading && (
        <div className="absolute inset-0 z-20 flex flex-col items-center justify-center bg-white/75 backdrop-blur-xs">
          <div className="w-8 h-8 border-3 border-gray-400 border-t-black rounded-full animate-spin mb-2" />
          <span className="font-mono text-xs text-gray-700">
            Loading North America Geographic Boundary Layers...
          </span>
        </div>
      )}

      <MapContainer
        center={DEFAULT_CENTER}
        zoom={DEFAULT_ZOOM}
        minZoom={3}
        maxZoom={9}
        scrollWheelZoom={true}
        className="w-full h-full z-0"
      >
        <TileLayer attribution={tileAttribution} url={tileUrl} />
        <FocusOn focus={focus} statesGeo={statesGeo} countiesGeo={countiesGeo} />
        <MapBackgroundClick onClear={onClearSelection} />

        {/* States Overview Mode */}
        {viewMode === 'states' && statesGeo && (
          <GeoJSON
            key={`states-${layerKey}`}
            data={statesGeo}
            style={(feature) => {
              const isSelected = Boolean(selectedId && String(feature?.id) === selectedId);
              return {
                fillColor: colorFor(values?.[String(feature?.id)]?.value),
                weight: isSelected ? 2.6 : 1.2,
                opacity: 1,
                color: isSelected ? '#000000' : '#2d3748',
                fillOpacity: isSelected ? 0.85 : 0.7,
              };
            }}
            onEachFeature={(feature, layer) => {
              const id = String(feature.id ?? '');
              const isSelected = Boolean(selectedId && id === selectedId);
              const stateName = feature.properties?.name || 'Unknown State';
              layer.bindTooltip(tooltip(stateName, id), { sticky: true });
              layer.on({
                click: (e) => {
                  L.DomEvent.stopPropagation(e);
                  if (id) onSelectFeature?.(id, 'state');
                },
                mouseover: (e) =>
                  e.target.setStyle({ weight: 2.4, color: '#000000', fillOpacity: 0.9 }),
                mouseout: (e) =>
                  e.target.setStyle({
                    weight: isSelected ? 2.6 : 1.2,
                    color: isSelected ? '#000000' : '#2d3748',
                    fillOpacity: isSelected ? 0.85 : 0.7,
                  }),
              });
            }}
          />
        )}

        {/* Counties Detailed Mode */}
        {viewMode === 'counties' && countiesGeo && (
          <GeoJSON
            key={`counties-${layerKey}`}
            data={countiesGeo}
            style={(feature) => {
              const isSelected = Boolean(selectedId && String(feature?.id) === selectedId);
              return {
                fillColor: colorFor(values?.[String(feature?.id)]?.value),
                weight: isSelected ? 2.2 : 0.35,
                opacity: 0.85,
                color: isSelected ? '#000000' : '#4a5568',
                fillOpacity: isSelected ? 0.85 : 0.65,
              };
            }}
            onEachFeature={(feature, layer) => {
              const id = String(feature.id ?? '');
              const isSelected = Boolean(selectedId && id === selectedId);
              const countyName = feature.properties?.NAME || `County ${id}`;
              layer.bindTooltip(tooltip(countyName, id), { sticky: true });
              layer.on({
                click: (e) => {
                  L.DomEvent.stopPropagation(e);
                  if (id) onSelectFeature?.(id, 'county');
                },
                mouseover: (e) =>
                  e.target.setStyle({ weight: 1.8, color: '#000000', fillOpacity: 0.9 }),
                mouseout: (e) =>
                  e.target.setStyle({
                    weight: isSelected ? 2.2 : 0.35,
                    color: isSelected ? '#000000' : '#4a5568',
                    fillOpacity: isSelected ? 0.85 : 0.65,
                  }),
              });
            }}
          />
        )}

        {/* State borders drawn over the counties, so it's clear where each state's
            counties begin and end. Its own pane keeps it above the county layer (which
            re-mounts on selection) and lets clicks and hovers pass through to the counties. */}
        {viewMode === 'counties' && statesGeo && (
          <Pane name="state-borders" style={{ zIndex: 450, pointerEvents: 'none' }}>
            <GeoJSON
              data={statesGeo}
              interactive={false}
              style={{ fill: false, weight: 2, color: '#1a202c', opacity: 0.9 }}
            />
          </Pane>
        )}
      </MapContainer>
    </div>
  );
}
