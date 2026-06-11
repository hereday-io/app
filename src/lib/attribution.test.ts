import { describe, it, expect, beforeEach, vi } from 'vitest';
import { captureFirstTouch, getFirstTouch, attributionProperties } from './attribution';

vi.mock('@/integrations/supabase/client', () => ({
  supabase: {},
}));

const setUrl = (path: string) => {
  window.history.replaceState({}, '', path);
};

const setReferrer = (value: string) => {
  Object.defineProperty(document, 'referrer', { value, configurable: true });
};

beforeEach(() => {
  localStorage.clear();
  setUrl('/');
  setReferrer('');
});

describe('captureFirstTouch', () => {
  it('captures utm params, referrer, and landing page on first visit', () => {
    setUrl('/?utm_source=newsletter&utm_medium=email&utm_campaign=launch');
    setReferrer('https://www.google.com/');

    captureFirstTouch();
    const touch = getFirstTouch();

    expect(touch).not.toBeNull();
    expect(touch!.utm_source).toBe('newsletter');
    expect(touch!.utm_medium).toBe('email');
    expect(touch!.utm_campaign).toBe('launch');
    expect(touch!.referrer).toBe('https://www.google.com/');
    expect(touch!.landing_page).toBe('/?utm_source=newsletter&utm_medium=email&utm_campaign=launch');
  });

  it('does not overwrite an existing first touch', () => {
    setUrl('/?utm_source=first');
    captureFirstTouch();

    setUrl('/?utm_source=second');
    captureFirstTouch();

    expect(getFirstTouch()!.utm_source).toBe('first');
  });

  it('treats a same-origin referrer as no referrer', () => {
    setReferrer(`${window.location.origin}/some-page`);

    captureFirstTouch();

    expect(getFirstTouch()!.referrer).toBeNull();
  });

  it('captures a direct visit with no source data', () => {
    setUrl('/getting-started');

    captureFirstTouch();
    const touch = getFirstTouch();

    expect(touch!.referrer).toBeNull();
    expect(touch!.utm_source).toBeNull();
    expect(touch!.landing_page).toBe('/getting-started');
  });

  it('records the generic ref param', () => {
    setUrl('/?ref=race-directory');

    captureFirstTouch();

    expect(getFirstTouch()!.ref).toBe('race-directory');
  });
});

describe('attributionProperties', () => {
  it('returns an empty object when nothing was captured', () => {
    expect(attributionProperties()).toEqual({});
  });

  it('drops null fields and the captured_at timestamp', () => {
    setUrl('/?utm_source=newsletter');
    setReferrer('https://news.example.com/');

    captureFirstTouch();

    expect(attributionProperties()).toEqual({
      referrer: 'https://news.example.com/',
      landing_page: '/?utm_source=newsletter',
      utm_source: 'newsletter',
    });
  });
});
