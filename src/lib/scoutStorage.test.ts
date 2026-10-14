import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { EdgeFunctionError } from './userFacingError';
import type { PendingPoi } from './scoutQueueDb';

vi.mock('@/lib/scoutApi', () => ({ submitScoutedPoi: vi.fn() }));
vi.mock('@/lib/scoutQueueDb', () => ({
  addPending: vi.fn(),
  readAllPending: vi.fn(),
  deletePending: vi.fn(),
}));

import { submitScoutedPoi } from '@/lib/scoutApi';
import { deletePending, readAllPending } from '@/lib/scoutQueueDb';
import { flushResultToast, flushScoutPending, isRetryableSubmitError, type FlushResult } from './scoutStorage';

const submit = vi.mocked(submitScoutedPoi);
const readAll = vi.mocked(readAllPending);
const del = vi.mocked(deletePending);

const TOKEN = 'sct_test';

const pin = (id: number, title: string): PendingPoi => ({
  id,
  token: TOKEN,
  poi: { type: 'water', title, coordinates: [-122.4, 37.8] },
  queuedAt: 1_700_000_000_000 + id,
});

const http = (status: number, serverMessage: string | null = null) =>
  new EdgeFunctionError({ fn: 'submit-scouted-poi', status, serverMessage, transport: 'http' });
const offline = () =>
  new EdgeFunctionError({ fn: 'submit-scouted-poi', status: null, serverMessage: null, transport: 'fetch', sdkMessage: 'Failed to fetch' });

/** Submit outcomes keyed by pin title; anything missing succeeds. */
function serverSays(outcomes: Record<string, Error>) {
  submit.mockImplementation(async ({ poi }) => {
    const err = outcomes[poi.title];
    if (err) throw err;
    return {} as Awaited<ReturnType<typeof submitScoutedPoi>>;
  });
}

const submittedTitles = () => submit.mock.calls.map(([input]) => input.poi.title);
const deletedIds = () => del.mock.calls.map(([id]) => id);

let onLine: ReturnType<typeof vi.spyOn>;

beforeEach(() => {
  vi.clearAllMocks();
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  onLine = vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(true);
  del.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('isRetryableSubmitError', () => {
  it.each([
    ['no answer (offline)', offline(), true],
    ['relay failure', new EdgeFunctionError({ fn: 'x', status: null, serverMessage: null, transport: 'relay' }), true],
    ['500', http(500), true],
    ['503', http(503, 'Service temporarily unavailable. Please retry in a moment.'), true],
    ['429', http(429, 'Rate limit exceeded'), true],
    ['408', http(408), true],
    ['an unexpected throw', new TypeError('boom'), true],
    ['404 dead link', http(404, 'Invalid or expired link'), false],
    ['403 revoked', http(403, 'This scout link has been revoked'), false],
    ['400 validation', http(400, 'Title too long (max 80)'), false],
    ['200 with an { error } body', new EdgeFunctionError({ fn: 'x', status: 200, serverMessage: 'nope', transport: 'body' }), false],
  ])('%s → %s', (_label, err, expected) => {
    expect(isRetryableSubmitError(err)).toBe(expected);
  });
});

describe('flushScoutPending', () => {
  it('uploads every queued pin oldest first and empties the queue', async () => {
    readAll.mockResolvedValue([pin(1, 'Aid station'), pin(2, 'Water'), pin(3, 'Toilets')]);
    serverSays({});

    const result = await flushScoutPending(TOKEN);

    expect(result).toEqual({ flushed: 3, rejected: [] });
    expect(submittedTitles()).toEqual(['Aid station', 'Water', 'Toilets']);
    expect(deletedIds()).toEqual([1, 2, 3]);
  });

  it('drops a dead-link pin at the head of the queue and keeps going', async () => {
    readAll.mockResolvedValue([pin(1, 'Aid station'), pin(2, 'Water')]);
    serverSays({ 'Aid station': http(404, 'Invalid or expired link') });

    const result = await flushScoutPending(TOKEN);

    expect(submittedTitles()).toEqual(['Aid station', 'Water']);
    expect(deletedIds()).toEqual([1, 2]);
    expect(result.flushed).toBe(1);
    expect(result.rejected).toHaveLength(1);
    expect(result.rejected[0]).toMatchObject({ title: 'Aid station', status: 404 });
    expect(result.rejected[0].error.kind).toBe('link');
    expect(result.rejected[0].error.title).toBe('This link no longer works');
  });

  it('drops pins that fail validation and reports each by title', async () => {
    readAll.mockResolvedValue([pin(1, 'A'.repeat(200)), pin(2, 'Water'), pin(3, 'Bad coords')]);
    serverSays({
      ['A'.repeat(200)]: http(400, 'Title too long (max 80)'),
      'Bad coords': http(400, 'Coordinates out of range'),
    });

    const result = await flushScoutPending(TOKEN);

    expect(deletedIds()).toEqual([1, 2, 3]);
    expect(result.flushed).toBe(1);
    expect(result.rejected.map((r) => r.title)).toEqual(['A'.repeat(200), 'Bad coords']);
  });

  it('stops at a network error and keeps that pin and everything behind it', async () => {
    readAll.mockResolvedValue([pin(1, 'Aid station'), pin(2, 'Water'), pin(3, 'Toilets')]);
    serverSays({ Water: offline() });

    const result = await flushScoutPending(TOKEN);

    expect(result).toEqual({ flushed: 1, rejected: [] });
    expect(submittedTitles()).toEqual(['Aid station', 'Water']);
    expect(deletedIds()).toEqual([1]);
  });

  it.each([
    ['500', http(500, 'Failed to save POI')],
    ['503', http(503, 'Service temporarily unavailable. Please retry in a moment.')],
    ['429', http(429, 'Rate limit exceeded: max 60 POIs per hour per scout link')],
    ['an unexpected throw', new Error('something odd')],
  ])('keeps the pin queued on %s', async (_label, err) => {
    readAll.mockResolvedValue([pin(1, 'Aid station'), pin(2, 'Water')]);
    serverSays({ 'Aid station': err });

    const result = await flushScoutPending(TOKEN);

    expect(result).toEqual({ flushed: 0, rejected: [] });
    expect(submittedTitles()).toEqual(['Aid station']);
    expect(del).not.toHaveBeenCalled();
  });

  it('does not touch the queue while the device is offline', async () => {
    onLine.mockReturnValue(false);

    const result = await flushScoutPending(TOKEN);

    expect(result).toEqual({ flushed: 0, rejected: [] });
    expect(readAll).not.toHaveBeenCalled();
    expect(submit).not.toHaveBeenCalled();
  });

  it('never sends the same pin twice when flushes overlap', async () => {
    readAll.mockResolvedValue([pin(1, 'Aid station')]);
    let release!: () => void;
    submit.mockImplementation(
      () => new Promise((resolve) => { release = () => resolve({} as Awaited<ReturnType<typeof submitScoutedPoi>>); }),
    );

    const first = flushScoutPending(TOKEN);
    await vi.waitFor(() => expect(submit).toHaveBeenCalledTimes(1));
    const second = await flushScoutPending(TOKEN);
    release();

    expect(second).toEqual({ flushed: 0, rejected: [] });
    expect(await first).toEqual({ flushed: 1, rejected: [] });
    expect(submit).toHaveBeenCalledTimes(1);

    // The lock is released once the first flush settles.
    readAll.mockResolvedValue([]);
    await flushScoutPending(TOKEN);
    expect(readAll).toHaveBeenCalledTimes(2);
  });

  it('returns what it got through if the queue itself fails mid-flush', async () => {
    readAll.mockResolvedValue([pin(1, 'Aid station'), pin(2, 'Water')]);
    serverSays({});
    del.mockResolvedValueOnce(undefined).mockRejectedValueOnce(new Error('QuotaExceededError'));

    const result = await flushScoutPending(TOKEN);

    expect(result).toEqual({ flushed: 1, rejected: [] });
  });
});

describe('flushResultToast', () => {
  const rejectedBy = async (pins: PendingPoi[], outcomes: Record<string, Error>): Promise<FlushResult> => {
    readAll.mockResolvedValue(pins);
    serverSays(outcomes);
    return flushScoutPending(TOKEN);
  };

  it('says nothing when nothing changed', () => {
    expect(flushResultToast({ flushed: 0, rejected: [] }, 2)).toBeNull();
  });

  it('confirms uploads and mentions what is still waiting', () => {
    expect(flushResultToast({ flushed: 1, rejected: [] }, 0)).toEqual({
      title: 'Uploaded 1 offline pin',
      description: undefined,
    });
    expect(flushResultToast({ flushed: 3, rejected: [] }, 2)).toEqual({
      title: 'Uploaded 3 offline pins',
      description: '2 still waiting for a better signal.',
    });
  });

  it('names a dead-link pin and sends the scout to their organizer (§3A)', async () => {
    const result = await rejectedBy([pin(1, 'Aid station')], { 'Aid station': http(404, 'Invalid or expired link') });

    const toast = flushResultToast(result, 0);

    expect(toast).toEqual({
      title: 'This link no longer works',
      description:
        "“Aid station” wasn't saved. The organizer may have turned it off or sent a new one. Ask your race organizer for a fresh link.",
      variant: 'destructive',
    });
  });

  it('uses the revoked wording for a revoked link', async () => {
    const result = await rejectedBy([pin(1, 'Aid station'), pin(2, 'Water')], {
      'Aid station': http(403, 'This scout link has been revoked'),
      Water: http(403, 'This scout link has been revoked'),
    });

    expect(flushResultToast(result, 0)?.description).toBe(
      "“Aid station” and “Water” weren't saved. The organizer turned this link off. Ask your race organizer for a fresh link.",
    );
  });

  it('asks the scout to drop a refused pin again, and credits the ones that made it', async () => {
    const result = await rejectedBy([pin(1, 'Aid station'), pin(2, 'Water')], {
      'Aid station': http(400, 'Invalid poi type'),
    });

    expect(flushResultToast(result, 0)).toEqual({
      title: "Couldn't save “Aid station”",
      description: "It was stored offline but wasn't accepted when it synced. Drop the pin again. Your other offline pin uploaded.",
      variant: 'destructive',
    });
  });

  it('lists several refused pins, folding a long list', async () => {
    const titles = ['Aid', 'Water', 'Toilets', 'Medic', 'Bag drop'];
    const result = await rejectedBy(
      titles.map((t, i) => pin(i + 1, t)),
      Object.fromEntries(titles.map((t) => [t, http(400, 'Invalid poi type')])),
    );

    expect(flushResultToast(result, 0)).toEqual({
      title: "Couldn't save 5 pins",
      description: "“Aid”, “Water” and 3 more were stored offline but weren't accepted when they synced. Drop them again.",
      variant: 'destructive',
    });
  });
});
