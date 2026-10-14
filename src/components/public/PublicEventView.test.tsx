import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import type { EventRoute, RoutePoi } from '@/types/mapEditor';

/**
 * Two behaviors that make the public map feel broken when they regress:
 *  - POI markers must wait for the map's first complete render, or they
 *    float over an empty background while tiles load.
 *  - Run <-> Watch must restyle the existing map, not build a new one.
 */

const mapState = vi.hoisted(() => ({
  constructed: 0,
  setStyleCalls: 0,
  markersAdded: 0,
  markerLabels: [] as Array<string | null>,
  loadHandlers: [] as Array<() => void>,
  paint: [] as Array<[string, string, unknown]>,
}));

vi.mock('mapbox-gl', () => {
  class FakeMarker {
    el: HTMLElement;
    constructor(el?: HTMLElement | { element: HTMLElement }) {
      this.el = el instanceof HTMLElement ? el : el?.element ?? document.createElement('div');
    }
    setLngLat() { return this; }
    setPopup() { return this; }
    addTo() {
      mapState.markersAdded += 1;
      mapState.markerLabels.push(this.el.getAttribute('aria-label'));
      return this;
    }
    remove() { return this; }
    togglePopup() { return this; }
    getElement() { return this.el; }
  }
  class FakePopup {
    setDOMContent() { return this; }
    on() { return this; }
    remove() { return this; }
  }
  class FakeMap {
    constructor() { mapState.constructed += 1; }
    on() { return this; }
    off() { return this; }
    once(event: string, cb: () => void) {
      if (event === 'load') mapState.loadHandlers.push(cb);
      return this;
    }
    remove() { return this; }
    getLayer() { return {}; }
    getSource() { return {}; }
    setStyle() { mapState.setStyleCalls += 1; return this; }
    setPaintProperty(layer: string, prop: string, value: unknown) { mapState.paint.push([layer, prop, value]); return this; }
    setLayoutProperty() { return this; }
    project() { return { x: 0, y: 0 }; }
    getZoom() { return 12; }
    fitBounds() { return this; }
    flyTo() { return this; }
  }
  class FakeLngLatBounds { extend() { return this; } }
  const mapboxgl = { Map: FakeMap, Marker: FakeMarker, Popup: FakePopup, LngLatBounds: FakeLngLatBounds, accessToken: '' };
  return { default: mapboxgl, ...mapboxgl };
});

// The view's hooks import the Supabase client, which throws at load
// without .env (as on CI). Nothing here talks to Supabase.
vi.mock('@/integrations/supabase/client', () => ({ supabase: {} }));
vi.mock('@/hooks/useMapboxToken', () => ({ useMapboxToken: () => ({ token: 'pk.test', loading: false }) }));
vi.mock('@/hooks/usePoiStatuses', () => ({ usePoiStatuses: () => new Map() }));
vi.mock('@/hooks/useTrackingSubscription', () => ({ useTrackingSubscription: () => ({ runners: new Map() }) }));
vi.mock('@/lib/analytics', () => ({ logEvent: vi.fn() }));
vi.mock('@/components/map/MapBottomSheet', () => ({ default: () => null }));
vi.mock('@/components/public/SubscribeButton', () => ({ default: () => null }));
vi.mock('@/components/public/PublicShareButton', () => ({ default: () => null }));

const route: EventRoute = {
  id: 'r1',
  name: '5K',
  color: '#2563eb',
  waypoints: [[-88, 42], [-88.01, 42.01]],
  routeCoords: [[-88, 42], [-88.01, 42.01]],
} as EventRoute;

const pois: RoutePoi[] = [
  { id: 'p1', type: 'aid-station', title: 'Mile 2 table', coordinates: [-88.005, 42.005] } as RoutePoi,
];

const event = {
  id: 'evt-1', name: 'Test 5K', city: null, event_date: null,
  routes: [route], pois, is_pro: false,
};

beforeEach(() => {
  mapState.constructed = 0;
  mapState.setStyleCalls = 0;
  mapState.markersAdded = 0;
  mapState.markerLabels = [];
  mapState.loadHandlers = [];
  mapState.paint = [];
});

describe('PublicEventView', () => {
  it('holds markers back until the map has loaded, then names them', async () => {
    const { default: PublicEventView } = await import('./PublicEventView');
    render(
      <PublicEventView event={event} mode="runner" onSwitchMode={() => {}} />
    );

    expect(mapState.markersAdded).toBe(0);
    expect(screen.getByRole('status').textContent).toMatch(/loading map/i);

    act(() => { mapState.loadHandlers.forEach((cb) => cb()); });

    expect(mapState.markersAdded).toBeGreaterThan(0);
    expect(screen.queryByRole('status')).toBeNull();
    expect(mapState.markerLabels).toContain('Aid Station: Mile 2 table');
    // Visitors arrive from a shared link; there's no back-to-marketing button.
    expect(screen.queryByRole('button', { name: /back to hereday home/i })).toBeNull();
  });

  it('switches Run/Watch without rebuilding the map or reloading its style', async () => {
    const { default: PublicEventView } = await import('./PublicEventView');
    const onSwitchMode = vi.fn();
    const { rerender } = render(
      <PublicEventView event={event} mode="runner" onSwitchMode={onSwitchMode} />
    );
    act(() => { mapState.loadHandlers.forEach((cb) => cb()); });

    fireEvent.click(screen.getByRole('button', { name: /watch/i }));
    expect(onSwitchMode).toHaveBeenCalledWith('spectator');

    mapState.paint = [];
    rerender(<PublicEventView event={event} mode="spectator" onSwitchMode={onSwitchMode} />);

    expect(mapState.constructed).toBe(1);
    expect(mapState.setStyleCalls).toBe(0);
    expect(mapState.paint).toContainEqual(['route-line-r1', 'line-dasharray', [2, 2]]);
    expect(screen.getByRole('button', { name: /watch/i }).getAttribute('aria-pressed')).toBe('true');
  });

  it('shows the first-visit tip by the toggle, worded for the current mode', async () => {
    const { default: PublicEventView } = await import('./PublicEventView');
    const onModeHintDismiss = vi.fn();
    const { rerender } = render(
      <PublicEventView event={event} mode="runner" onSwitchMode={() => {}} showModeHint onModeHintDismiss={onModeHintDismiss} />
    );
    expect(screen.getByRole('note').textContent).toMatch(/tap watch/i);
    rerender(<PublicEventView event={event} mode="spectator" onSwitchMode={() => {}} showModeHint onModeHintDismiss={onModeHintDismiss} />);
    expect(screen.getByRole('note').textContent).toMatch(/tap run/i);
    fireEvent.click(screen.getByRole('button', { name: /dismiss tip/i }));
    expect(onModeHintDismiss).toHaveBeenCalledOnce();
  });

  it('shows no tip for returning visitors', async () => {
    const { default: PublicEventView } = await import('./PublicEventView');
    render(<PublicEventView event={event} mode="runner" onSwitchMode={() => {}} />);
    expect(screen.queryByRole('note')).toBeNull();
  });
});
