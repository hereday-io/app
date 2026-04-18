// Marker element builders shared by the public runner/spectator views.
// Kept framework-agnostic (plain DOM) so the same code renders inside
// Mapbox's `new Marker(el)` without pulling React into the map-layer
// render path — which matters for clustering perf on busy events.

import type { PoiStatusState } from '@/types/mapEditor';

// Colors for the corner status dot. Kept as a flat lookup so the public
// popover's status line can reuse the same palette and stay in sync.
export const STATUS_DOT_COLORS: Record<PoiStatusState, string> = {
  open: '#10b981',   // green — operational (usually hidden, default state)
  low: '#f59e0b',    // amber — low on supplies
  closed: '#ef4444', // red — closed
  moved: '#3b82f6',  // blue — relocated
};

/**
 * Adds an absolutely-positioned status dot to the top-right of a POI
 * marker element. Returns a reference to the dot so the subscription
 * effect can toggle its color/visibility as `poi_statuses` updates,
 * without rebuilding the whole marker.
 *
 * The dot starts hidden — callers flip it on via setStatusDot() once
 * the subscription hook reports a non-open state.
 */
export function attachStatusDot(markerRoot: HTMLElement): HTMLElement {
  // Establish a positioning context so the absolute dot anchors to the
  // marker's top-right edge regardless of its internal layout.
  if (!markerRoot.style.position) {
    markerRoot.style.position = 'relative';
  }
  const dot = document.createElement('div');
  dot.style.cssText = [
    'position:absolute',
    'top:-3px',
    'right:-3px',
    'width:12px',
    'height:12px',
    'border-radius:50%',
    'border:2px solid white',
    'box-shadow:0 1px 3px rgba(0,0,0,0.35)',
    'display:none',
    'pointer-events:none',
    'z-index:2',
  ].join(';');
  markerRoot.appendChild(dot);
  return dot;
}

/** Drive the dot from a status value. Hidden for `null` or `open`. */
export function setStatusDot(dot: HTMLElement, state: PoiStatusState | null): void {
  if (!state || state === 'open') {
    dot.style.display = 'none';
    return;
  }
  dot.style.display = 'block';
  dot.style.background = STATUS_DOT_COLORS[state];
}

/**
 * Build the DOM element for an auto-placed Start/Finish marker.
 *
 * UX_PATTERNS.md §Start/Finish requires these to be *instantly*
 * recognizable — larger than a regular POI, colored to match the
 * route's stroke, and labelled with inline text so organizers and
 * spectators can orient themselves at a glance without tapping.
 *
 * Multi-route events get per-route colors so "where's the half-marathon
 * start" is answerable visually, not by trial and error.
 */
export function buildStartFinishMarkerEl(
  kind: 'start' | 'finish',
  routeColor: string,
): HTMLElement {
  const wrap = document.createElement('div');
  wrap.style.cssText = 'cursor:pointer;display:flex;flex-direction:column;align-items:center;pointer-events:auto;';

  const dot = document.createElement('div');
  // 40px circle filled with the route color. White inner ring keeps
  // the marker legible on any basemap (light, dark, satellite).
  dot.style.cssText = [
    'width:40px',
    'height:40px',
    'border-radius:50%',
    `background:${routeColor}`,
    'border:3px solid white',
    'box-shadow:0 3px 10px rgba(0,0,0,0.35)',
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'font-size:18px',
    'line-height:1',
    'color:white',
    'font-weight:800',
    'font-family:"Space Grotesk",system-ui,sans-serif',
    'transition:transform 0.15s ease',
  ].join(';');
  // A checkered flag for finish, a filled dot glyph for start. Emoji
  // render differently across devices — prefer simple characters so
  // the visual reads the same everywhere.
  dot.textContent = kind === 'finish' ? '🏁' : '●';

  const label = document.createElement('div');
  label.textContent = kind === 'finish' ? 'FINISH' : 'START';
  label.style.cssText = [
    'margin-top:3px',
    'padding:2px 7px',
    `background:${routeColor}`,
    'color:white',
    'font-size:9px',
    'font-weight:800',
    'letter-spacing:0.08em',
    'border-radius:999px',
    'box-shadow:0 1px 3px rgba(0,0,0,0.25)',
    'font-family:"Space Grotesk",system-ui,sans-serif',
    'white-space:nowrap',
  ].join(';');

  wrap.appendChild(dot);
  wrap.appendChild(label);

  wrap.addEventListener('mouseenter', () => { dot.style.transform = 'scale(1.08)'; });
  wrap.addEventListener('mouseleave', () => { dot.style.transform = 'scale(1)'; });

  return wrap;
}

/**
 * Build the DOM element for a branded sponsor marker. Differs from the
 * generic ⭐ sponsor pin: white logo background, brand-color ring, and
 * a small "SPONSORED" pill below so viewers register it as an ad unit
 * instead of a course support marker. Fallback glyph (text or ⭐)
 * renders when no logo URL is provided.
 *
 * Deliberately plain DOM — Mapbox owns these nodes; we keep React out
 * of the marker render path.
 */
export function buildBrandedSponsorMarkerEl(opts: {
  logoUrl?: string;
  brandColor?: string;
  fallbackGlyph?: string;
  isHighlighted: boolean;
}): HTMLElement {
  const brand = opts.brandColor || '#2563eb';
  const wrap = document.createElement('div');
  wrap.style.cssText = 'cursor:pointer;display:flex;flex-direction:column;align-items:center;pointer-events:auto;';

  const dot = document.createElement('div');
  const size = 38;
  const opacity = opts.isHighlighted ? 1 : 0.45;
  dot.style.cssText = [
    `width:${size}px`,
    `height:${size}px`,
    'border-radius:50%',
    'background:white',
    `border:3px solid ${brand}`,
    `box-shadow:0 2px 10px rgba(0,0,0,${opts.isHighlighted ? 0.3 : 0.12})`,
    'display:flex',
    'align-items:center',
    'justify-content:center',
    'overflow:hidden',
    `opacity:${opacity}`,
    'transition:transform 0.15s ease,box-shadow 0.2s',
    'pointer-events:none',
  ].join(';');

  if (opts.logoUrl) {
    const img = document.createElement('img');
    img.src = opts.logoUrl;
    img.alt = '';
    img.style.cssText = 'max-width:78%;max-height:78%;object-fit:contain;pointer-events:none;';
    img.loading = 'lazy';
    dot.appendChild(img);
  } else {
    dot.style.fontSize = '16px';
    dot.textContent = opts.fallbackGlyph || '⭐';
  }

  const label = document.createElement('div');
  label.textContent = 'SPONSORED';
  label.style.cssText = [
    'margin-top:3px',
    `background:${brand}`,
    'color:white',
    'font-size:8.5px',
    'font-weight:800',
    'letter-spacing:0.1em',
    'padding:1.5px 6px',
    'border-radius:999px',
    'box-shadow:0 1px 3px rgba(0,0,0,0.25)',
    'font-family:"Space Grotesk",system-ui,sans-serif',
    'white-space:nowrap',
    `opacity:${opacity}`,
  ].join(';');

  wrap.appendChild(dot);
  wrap.appendChild(label);

  wrap.addEventListener('mouseenter', () => {
    dot.style.transform = 'scale(1.12)';
    dot.style.boxShadow = '0 4px 14px rgba(0,0,0,0.35)';
  });
  wrap.addEventListener('mouseleave', () => {
    dot.style.transform = 'scale(1)';
    dot.style.boxShadow = `0 2px 10px rgba(0,0,0,${opts.isHighlighted ? 0.3 : 0.12})`;
  });

  return wrap;
}

/**
 * Detect auto-placed start/finish POIs by their id convention. The
 * editor creates these as `auto-start-${routeId}` / `auto-finish-${routeId}`
 * on route completion (RouteEditor.tsx `placeAutoStartFinish`). The
 * public views use this to split them out of the regular clustering
 * pass so they never get swallowed into a generic "N stops" pin.
 */
export function parseAutoStartFinishId(
  id: string,
): { kind: 'start' | 'finish'; routeId: string } | null {
  if (id.startsWith('auto-start-')) {
    return { kind: 'start', routeId: id.slice('auto-start-'.length) };
  }
  if (id.startsWith('auto-finish-')) {
    return { kind: 'finish', routeId: id.slice('auto-finish-'.length) };
  }
  return null;
}
