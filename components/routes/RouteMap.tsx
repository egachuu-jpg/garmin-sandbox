'use client';

import { useEffect, useRef, useState } from 'react';
import maplibregl from 'maplibre-gl';
import 'maplibre-gl/dist/maplibre-gl.css';

export type MapPoint = { lat: number; lng: number };
export type MapLine = {
  id: string;
  coordinates: number[][]; // GeoJSON order [lng, lat, ...]
  color: string;
  dim?: boolean;
};

type Props = {
  lines: MapLine[];
  /** Editable control points, rendered as numbered draggable markers. */
  waypoints: MapPoint[];
  /** Start-place pin (not editable). */
  startPin: MapPoint | null;
  /** Pending pin while placing a new saved place / custom start. */
  pendingPin: MapPoint | null;
  center: MapPoint;
  /** Change this value to fit the viewport to the current lines/waypoints. */
  fitKey: string;
  onMapClick?: (p: MapPoint) => void;
  onWaypointMove?: (index: number, p: MapPoint) => void;
  onWaypointTap?: (index: number) => void;
};

// Free OSM raster tiles — fine at single-user volume. Slightly dimmed via CSS
// filter so the light tiles don't fight the dark UI.
const OSM_STYLE: maplibregl.StyleSpecification = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors',
    },
  },
  layers: [{ id: 'osm', type: 'raster', source: 'osm' }],
};

function pinElement(bg: string, label = ''): HTMLDivElement {
  const el = document.createElement('div');
  el.style.cssText = `width:22px;height:22px;border-radius:9999px;background:${bg};border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.5);display:flex;align-items:center;justify-content:center;font:600 11px sans-serif;color:#fff;cursor:pointer;`;
  el.textContent = label;
  return el;
}

export function RouteMap({
  lines,
  waypoints,
  startPin,
  pendingPin,
  center,
  fitKey,
  onMapClick,
  onWaypointMove,
  onWaypointTap,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  const [ready, setReady] = useState(false);
  const markersRef = useRef<maplibregl.Marker[]>([]);
  const startMarkerRef = useRef<maplibregl.Marker | null>(null);
  const pendingMarkerRef = useRef<maplibregl.Marker | null>(null);
  const lineIdsRef = useRef<string[]>([]);

  // Latest callbacks without re-binding map handlers.
  const cbRef = useRef({ onMapClick, onWaypointMove, onWaypointTap });
  cbRef.current = { onMapClick, onWaypointMove, onWaypointTap };

  useEffect(() => {
    if (!containerRef.current || mapRef.current) return;
    const map = new maplibregl.Map({
      container: containerRef.current,
      style: OSM_STYLE,
      center: [center.lng, center.lat],
      zoom: 12,
      attributionControl: { compact: true },
    });
    map.on('load', () => setReady(true));
    map.on('click', e => cbRef.current.onMapClick?.({ lat: e.lngLat.lat, lng: e.lngLat.lng }));
    mapRef.current = map;
    return () => {
      map.remove();
      mapRef.current = null;
    };
    // center is initial-only; moves after mount are done via fitKey.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Route lines
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    for (const id of lineIdsRef.current) {
      if (map.getLayer(id)) map.removeLayer(id);
      if (map.getSource(id)) map.removeSource(id);
    }
    lineIdsRef.current = [];

    // Draw dimmed lines first so the active one renders on top.
    const ordered = [...lines].sort((a, b) => Number(b.dim ?? false) - Number(a.dim ?? false));
    for (const line of ordered) {
      const id = `route-${line.id}`;
      map.addSource(id, {
        type: 'geojson',
        data: { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: line.coordinates } },
      });
      map.addLayer({
        id,
        type: 'line',
        source: id,
        layout: { 'line-cap': 'round', 'line-join': 'round' },
        paint: { 'line-color': line.color, 'line-width': line.dim ? 3 : 5, 'line-opacity': line.dim ? 0.45 : 0.9 },
      });
      lineIdsRef.current.push(id);
    }
  }, [lines, ready]);

  // Waypoint markers (numbered, draggable, tap to remove)
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;

    markersRef.current.forEach(m => m.remove());
    markersRef.current = waypoints.map((w, i) => {
      const el = pinElement('#3b82f6', String(i + 1));
      el.addEventListener('click', e => {
        e.stopPropagation();
        cbRef.current.onWaypointTap?.(i);
      });
      const marker = new maplibregl.Marker({ element: el, draggable: true })
        .setLngLat([w.lng, w.lat])
        .addTo(map);
      marker.on('dragend', () => {
        const p = marker.getLngLat();
        cbRef.current.onWaypointMove?.(i, { lat: p.lat, lng: p.lng });
      });
      return marker;
    });
  }, [waypoints, ready]);

  // Start + pending pins
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    startMarkerRef.current?.remove();
    startMarkerRef.current = startPin
      ? new maplibregl.Marker({ element: pinElement('#10b981') }).setLngLat([startPin.lng, startPin.lat]).addTo(map)
      : null;
  }, [startPin, ready]);

  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    pendingMarkerRef.current?.remove();
    pendingMarkerRef.current = pendingPin
      ? new maplibregl.Marker({ element: pinElement('#f59e0b') }).setLngLat([pendingPin.lng, pendingPin.lat]).addTo(map)
      : null;
  }, [pendingPin, ready]);

  // Fit viewport when the caller signals a meaningful content change.
  useEffect(() => {
    const map = mapRef.current;
    if (!map || !ready) return;
    const pts: [number, number][] = [
      ...lines.flatMap(l => l.coordinates.map(c => [c[0], c[1]] as [number, number])),
      ...waypoints.map(w => [w.lng, w.lat] as [number, number]),
    ];
    if (pts.length === 0) {
      map.easeTo({ center: [center.lng, center.lat], zoom: 12 });
      return;
    }
    const bounds = pts.reduce(
      (b, p) => b.extend(p),
      new maplibregl.LngLatBounds(pts[0], pts[0])
    );
    map.fitBounds(bounds, { padding: 48, maxZoom: 15, duration: 500 });
    // Only refit when fitKey changes — not on every waypoint tap.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [fitKey, ready]);

  return (
    <div className="relative w-full h-full rounded-2xl overflow-hidden border border-surface-border">
      {/* Explicit h-full, not absolute inset-0: MapLibre forces `position:
          relative` on its container via .maplibregl-map, which cancels
          Tailwind's `absolute` and collapses the div to 0 height. */}
      <div ref={containerRef} className="w-full h-full [&_.maplibregl-canvas]:brightness-[.85]" />
    </div>
  );
}
