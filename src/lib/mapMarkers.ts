// Marker element builders shared by the public runner/spectator views.
// Kept framework-agnostic (plain DOM) so the same code renders inside
// Mapbox's `new Marker(el)` without pulling React into the map-layer
// render path — which matters for clustering perf on busy events.

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
