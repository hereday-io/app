import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';

/**
 * Does the editor mount at all?
 *
 * Deliberately shallow. It exists because a `const` referenced in a useEffect
 * dependency array before its declaration is a temporal-dead-zone
 * ReferenceError thrown during render — the editor crashed on every load, and
 * nothing caught it: types passed, unit tests passed, the dev server logged
 * nothing, and the page looked fine because the editor sits behind auth and
 * never mounted.
 *
 * Anything that stops this component rendering is the most severe class of bug
 * in the product, so it gets a test that runs the component body for real.
 */

vi.mock('mapbox-gl', () => {
  class FakeMarker {
    setLngLat() { return this; }
    setPopup() { return this; }
    addTo() { return this; }
    remove() { return this; }
    on() { return this; }
    getElement() { return document.createElement('div'); }
    getLngLat() { return { lng: 0, lat: 0 }; }
  }
  class FakePopup {
    setDOMContent() { return this; }
    setLngLat() { return this; }
    addTo() { return this; }
    remove() { return this; }
    on() { return this; }
  }
  class FakeMap {
    getCanvas() { return document.createElement('canvas'); }
    getContainer() { return document.createElement('div'); }
    getCanvasContainer() { return document.createElement('div'); }
    on() { return this; }
    off() { return this; }
    once() { return this; }
    remove() { return this; }
    addSource() { return this; }
    addLayer() { return this; }
    removeLayer() { return this; }
    removeSource() { return this; }
    getLayer() { return undefined; }
    getSource() { return undefined; }
    queryRenderedFeatures() { return []; }
    setStyle() { return this; }
    fitBounds() { return this; }
    flyTo() { return this; }
    easeTo() { return this; }
    unproject() { return { lng: 0, lat: 0 }; }
    project() { return { x: 0, y: 0 }; }
    resize() { return this; }
    getZoom() { return 12; }
    getCenter() { return { lng: 0, lat: 0 }; }
    isStyleLoaded() { return true; }
    loaded() { return true; }
    setPaintProperty() { return this; }
    setLayoutProperty() { return this; }
    setFilter() { return this; }
    getBounds() { return { getWest: () => 0, getSouth: () => 0, getEast: () => 0, getNorth: () => 0 }; }
    setCenter() { return this; }
    setZoom() { return this; }
    getStyle() { return { layers: [] }; }
    hasImage() { return false; }
    addImage() { return this; }
    listImages() { return []; }
    doubleClickZoom = { disable() {}, enable() {} };
    dragPan = { disable() {}, enable() {} };
    scrollZoom = { disable() {}, enable() {} };
    addControl() { return this; }
  }
  class FakeControl { onAdd() { return document.createElement('div'); } onRemove() {} }
  class FakeLngLatBounds {
    extend() { return this; }
    isEmpty() { return false; }
    getCenter() { return { lng: 0, lat: 0 }; }
  }
  const mapboxgl = {
    Map: FakeMap, Marker: FakeMarker, Popup: FakePopup,
    NavigationControl: FakeControl, GeolocateControl: FakeControl,
    ScaleControl: FakeControl, AttributionControl: FakeControl, FullscreenControl: FakeControl,
    LngLatBounds: FakeLngLatBounds,
    accessToken: '',
  };
  return { default: mapboxgl, ...mapboxgl };
});

vi.mock('@/hooks/useAuth', () => ({
  useAuth: () => ({ user: { id: 'user-1', email: 't@example.invalid' }, session: null, loading: false }),
}));

vi.mock('@/lib/analytics', () => ({ logEvent: vi.fn(), identifyUser: vi.fn(), resetUser: vi.fn() }));

vi.mock('@/integrations/supabase/client', () => {
  const chain: Record<string, unknown> = {};
  const self = () => chain;
  Object.assign(chain, {
    select: self, insert: self, update: self, upsert: self, delete: self,
    eq: self, in: self, order: self, limit: self,
    single: () => Promise.resolve({ data: null, error: null }),
    maybeSingle: () => Promise.resolve({ data: null, error: null }),
    then: (res: (v: unknown) => unknown) => Promise.resolve({ data: [], error: null }).then(res),
  });
  return {
    supabase: {
      from: () => chain,
      channel: () => ({ on: () => ({ subscribe: () => ({}) }), subscribe: () => ({}), unsubscribe: () => {} }),
      removeChannel: () => {},
      functions: { invoke: () => Promise.resolve({ data: null, error: null }) },
      auth: { getSession: () => Promise.resolve({ data: { session: null }, error: null }) },
      storage: { from: () => ({ upload: () => Promise.resolve({ data: null, error: null }), getPublicUrl: () => ({ data: { publicUrl: '' } }) }) },
    },
  };
});

beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('RouteEditor mounts', () => {
  it('renders without throwing', async () => {
    const { default: RouteEditor } = await import('./RouteEditor');
    expect(() =>
      render(
        <MemoryRouter initialEntries={['/editor?event=evt-1']}>
          <RouteEditor />
        </MemoryRouter>
      )
    ).not.toThrow();
  });

  it('does not throw a temporal-dead-zone ReferenceError during render', async () => {
    // The specific failure mode this file exists for: a hook declared after an
    // effect that lists it as a dependency. React surfaces it as a render-time
    // throw, so assert on the error text rather than only on "did not throw".
    const { default: RouteEditor } = await import('./RouteEditor');
    let thrown: unknown = null;
    try {
      render(
        <MemoryRouter initialEntries={['/editor?event=evt-1']}>
          <RouteEditor />
        </MemoryRouter>
      );
    } catch (e) {
      thrown = e;
    }
    expect(thrown, thrown instanceof Error ? thrown.message : String(thrown)).toBeNull();
  });

  it('renders something to the document', async () => {
    const { default: RouteEditor } = await import('./RouteEditor');
    const { container } = render(
      <MemoryRouter initialEntries={['/editor?event=evt-1']}>
        <RouteEditor />
      </MemoryRouter>
    );
    expect(container.firstChild).not.toBeNull();
    expect(screen.queryByText(/cannot access/i)).toBeNull();
  });
});
