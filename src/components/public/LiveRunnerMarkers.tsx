import { useEffect, useRef, useCallback } from 'react';
import mapboxgl from 'mapbox-gl';
import type { RunnerPosition } from '@/types/mapEditor';
import { formatPace } from '@/lib/pace';

interface LiveRunnerMarkersProps {
  runners: Map<string, RunnerPosition>;
  mapRef: React.RefObject<mapboxgl.Map | null>;
  focusedRunnerId?: string | null;
  onRunnerClick?: (sessionId: string) => void;
}

/**
 * Renders a pulsing dot + name label on the Mapbox map for each active runner.
 * Markers are DOM elements managed imperatively (same pattern as POI markers).
 */
const LiveRunnerMarkers = ({ runners, mapRef, focusedRunnerId, onRunnerClick }: LiveRunnerMarkersProps) => {
  const markersRef = useRef<Map<string, mapboxgl.Marker>>(new Map());
  // Keep references to text DOM nodes for efficient updates
  const labelsRef = useRef<Map<string, { name: HTMLElement; pace: HTMLElement }>>(new Map());

  const handleClick = useCallback((sessionId: string) => {
    onRunnerClick?.(sessionId);
  }, [onRunnerClick]);

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
        labelsRef.current.delete(id);
      }
    }

    // Add or update markers for each runner
    for (const [id, runner] of runners) {
      // Hide if another runner is focused
      const hidden = focusedRunnerId != null && focusedRunnerId !== id;

      const existing = currentMarkers.get(id);

      if (existing) {
        // Update position
        existing.setLngLat([runner.lng, runner.lat]);

        // Update visibility
        existing.getElement().style.display = hidden ? 'none' : '';

        // Update pace text
        const refs = labelsRef.current.get(id);
        if (refs) {
          refs.name.textContent = runner.name;
          const pace = formatPace(runner.speed);
          refs.pace.textContent = pace ?? '';
          refs.pace.style.display = pace ? '' : 'none';
        }
      } else {
        // Create new marker
        const { el, nameEl, paceEl } = createRunnerElement(runner);
        el.style.display = hidden ? 'none' : '';
        el.addEventListener('click', () => handleClick(id));
        const marker = new mapboxgl.Marker({ element: el, anchor: 'center' })
          .setLngLat([runner.lng, runner.lat])
          .addTo(map);
        currentMarkers.set(id, marker);
        labelsRef.current.set(id, { name: nameEl, pace: paceEl });
      }
    }
  }, [runners, mapRef, focusedRunnerId, handleClick]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      for (const marker of markersRef.current.values()) {
        marker.remove();
      }
      markersRef.current.clear();
      labelsRef.current.clear();
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

function createRunnerElement(runner: RunnerPosition): {
  el: HTMLElement;
  nameEl: HTMLElement;
  paceEl: HTMLElement;
} {
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

  // Label container (name + pace stacked)
  const labelWrap = document.createElement('div');
  labelWrap.style.cssText = `
    position:absolute;
    top:100%;
    left:50%;
    transform:translateX(-50%);
    margin-top:4px;
    background:rgba(0,0,0,0.7);
    color:white;
    font-family:'DM Sans',system-ui,sans-serif;
    padding:2px 6px;
    border-radius:4px;
    white-space:nowrap;
    pointer-events:none;
    text-align:center;
    line-height:1.3;
  `;

  const nameEl = document.createElement('div');
  nameEl.textContent = runner.name;
  nameEl.style.cssText = 'font-size:11px;font-weight:600;';
  labelWrap.appendChild(nameEl);

  const paceEl = document.createElement('div');
  const pace = formatPace(runner.speed);
  paceEl.textContent = pace ?? '';
  paceEl.style.cssText = `font-size:10px;font-weight:400;opacity:0.85;${pace ? '' : 'display:none;'}`;
  labelWrap.appendChild(paceEl);

  wrapper.appendChild(labelWrap);

  return { el: wrapper, nameEl, paceEl };
}

export default LiveRunnerMarkers;
