import { useEffect, useRef } from 'react';
import mapboxgl from 'mapbox-gl';
import type { RunnerPosition } from '@/types/mapEditor';

interface LiveRunnerMarkersProps {
  runners: Map<string, RunnerPosition>;
  mapRef: React.RefObject<mapboxgl.Map | null>;
}

/**
 * Renders a pulsing dot + name label on the Mapbox map for each active runner.
 * Markers are DOM elements managed imperatively (same pattern as POI markers).
 */
const LiveRunnerMarkers = ({ runners, mapRef }: LiveRunnerMarkersProps) => {
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());

  useEffect(() => {
    const map = mapRef.current;
    if (!map) return;

    const currentMarkers = markersRef.current;
    const activeIds = new Set(runners.keys());

    // Remove markers for runners that are no longer active
    for (const [id, marker] of currentMarkers) {
      if (!activeIds.has(id)) {
        marker.remove();
        currentMarkers.delete(id);
      }
    }

    // Add or update markers for each runner
    for (const [id, runner] of runners) {
      const existing = currentMarkers.get(id);

      if (existing) {
        // Update position smoothly
        existing.setLngLat([runner.lng, runner.lat]);
      } else {
        // Create new marker
        const el = createRunnerElement(runner);
        const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([runner.lng, runner.lat])
          .addTo(map);
        currentMarkers.set(id, marker);
      }
    }
  }, [runners, mapRef]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const marker of markersRef.current.values()) {
        marker.remove();
      }
      markersRef.current.clear();
    };
  }, []);

  // Inject keyframes once
  useEffect(() => {
    if (document.getElementById('runner-pulse-style')) return;
    const style = document.createElement('style');
    style.id = 'runner-pulse-style';
    style.textContent = `
      @keyframes runnerPulse {
        0% { transform: scale(1); opacity: 0.6; }
        70% { transform: scale(2.2); opacity: 0; }
        100% { transform: scale(2.2); opacity: 0; }
      }
    `;
    document.head.appendChild(style);
  }, []);

  return null; // Markers are managed imperatively via mapbox-gl
};

function createRunnerElement(runner: RunnerPosition): HTMLElement {
  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:relative;pointer-events:auto;cursor:pointer;';

  // Outer pulse ring
  const pulse = document.createElement('div');
  pulse.style.cssText = `
    position:absolute;
    width:32px; height:32px;
    top:50%; left:50%;
    transform:translate(-50%, -50%);
    border-radius:50%;
    background:${runner.color};
    opacity:0.4;
    animation: runnerPulse 2s ease-out infinite;
    pointer-events:none;
  `;
  wrapper.appendChild(pulse);

  // Solid dot
  const dot = document.createElement('div');
  dot.style.cssText = `
    position:relative;
    width:16px; height:16px;
    border-radius:50%;
    background:${runner.color};
    border:3px solid white;
    box-shadow:0 2px 8px rgba(0,0,0,0.35);
  `;
  wrapper.appendChild(dot);

  // Name label
  const label = document.createElement('div');
  label.textContent = runner.name;
  label.style.cssText = `
    position:absolute;
    top:100%;
    left:50%;
    transform:translateX(-50%);
    margin-top:4px;
    background:rgba(0,0,0,0.7);
    color:white;
    font-size:11px;
    font-weight:600;
    font-family:'DM Sans',system-ui,sans-serif;
    padding:2px 6px;
    border-radius:4px;
    white-space:nowrap;
    pointer-events:none;
  `;
  wrapper.appendChild(label);

  return wrapper;
}

export default LiveRunnerMarkers;
