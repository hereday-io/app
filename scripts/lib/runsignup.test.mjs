// npm run test:scripts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchRaces, fetchState, lastYearFinishers, previousEvents, rsuDay, toLead } from './runsignup.mjs';

const window = { from: '2026-12-14', to: '2027-01-25' };
const race = (over = {}) => ({
  race_id: 1, name: 'Jingle Bell Jog', is_private_race: 'F', is_draft_race: 'F', is_registration_open: 'T',
  url: 'https://runsignup.com/Race/IL/Cary/JingleBellJog', external_race_url: null,
  address: { city: 'Cary', state: 'IL', zipcode: '60013' },
  events: [
    { event_id: 11, name: '5K', start_time: '12/20/2026 09:00', distance: '5K', event_type: 'running_race' },
    { event_id: 12, name: 'Kids Dash', start_time: '12/20/2026 10:00', distance: '', event_type: 'running_race' },
  ],
  ...over,
});

test('dates', () => {
  assert.equal(rsuDay('1/9/2027 08:00'), '2027-01-09');
  assert.equal(rsuDay('12/19/2026'), '2026-12-19');
  assert.equal(rsuDay(null), null);
});

test('an in-person race in the window becomes a lead', () => {
  assert.deepEqual(toLead(race(), window), {
    race_name: 'Jingle Bell Jog', race_date: '2026-12-20', town: 'Cary', state: 'IL', zipcode: '60013',
    url: 'https://runsignup.com/Race/IL/Cary/JingleBellJog', external_url: null,
    distances: ['5K', 'Kids Dash'], event_types: ['running_race'], event_ids: [11, 12], registration_open: true,
    runsignup_race_id: 1, source: 'runsignup',
  });
});

test('noise is dropped', () => {
  assert.equal(toLead(race({ name: 'Virtual Elf Run' }), window), null);
  assert.equal(toLead(race({ is_private_race: 'T' }), window), null);
  assert.equal(toLead(race({ events: [{ name: '5K', start_time: '12/20/2026 09:00', event_type: 'virtual_race' }] }), window), null);
  assert.equal(toLead(race({ events: [{ name: '5K', start_time: '3/1/2027 09:00', event_type: 'running_race' }] }), window), null);
});

test('a series takes its first in-window event', () => {
  const series = race({ events: [
    { name: '3 Mile', start_time: '11/21/2026 10:00', distance: '3 Miles', event_type: 'trail_race' },
    { name: '6 Mile', start_time: '1/16/2027 10:00', distance: '6 Miles', event_type: 'trail_race' },
  ] });
  const lead = toLead(series, window);
  assert.equal(lead.race_date, '2027-01-16');
  assert.deepEqual(lead.distances, ['6 Miles']);
});

test('fetch pages until a short page', async () => {
  const calls = [];
  const page = (n) => Array.from({ length: n }, (_, i) => ({ race: race({ race_id: i, name: `Race ${String(i).padStart(3, '0')}` }) }));
  const fake = async (url) => {
    calls.push(url);
    const p = Number(new URL(url).searchParams.get('page'));
    return { ok: true, json: async () => ({ races: p === 1 ? page(100) : page(3) }) };
  };
  const leads = await fetchRaces({ zip: '60014', radius: 50, perPage: 100, ...window }, fake);
  assert.equal(calls.length, 2);
  assert.equal(leads.length, 103);
  assert.match(calls[0], /zipcode=60014&radius=50&start_date=2026-12-14&end_date=2027-01-25/);
});

test('a state query that hits the anonymous 1,000 cap splits its window', async () => {
  const calls = [];
  const fake = async (url) => {
    const q = new URL(url).searchParams;
    calls.push([q.get('state'), q.get('start_date'), q.get('end_date')]);
    const wide = q.get('start_date') === window.from && q.get('end_date') === window.to;
    const n = wide ? 4 : 2;
    const races = Array.from({ length: n }, (_, i) => ({ race: race({
      race_id: i === 0 ? 1 : 100 + i + (q.get('start_date') === window.from ? 0 : 10),
      name: `Race ${i}`,
      events: [{ event_id: i, name: '5K', start_time: q.get('start_date').replace(/^(\d{4})-(\d{2})-(\d{2})$/, '$2/$3/$1 09:00'), event_type: 'running_race' }],
    }) }));
    return { ok: true, json: async () => ({ races }) };
  };
  const leads = await fetchState({ state: 'VT', perPage: 4, ...window }, fake);
  assert.deepEqual(calls.map((c) => c[0]), ['VT', 'VT', 'VT']);
  assert.deepEqual(calls.slice(1).map((c) => [c[1], c[2]]), [['2026-12-14', '2027-01-04'], ['2027-01-05', '2027-01-25']]);
  assert.equal(leads.filter((l) => l.runsignup_race_id === 1).length, 1, 'a race returned by both halves is kept once');
  assert.equal(leads.length, 3);
});

test('previous editions: the RunSignup link, else same name a year earlier', () => {
  const all = [
    { event_id: 11, name: '5K', start_time: '12/20/2026 09:00', previous_year_event_id: 1 },
    { event_id: 12, name: 'Kids Dash', start_time: '12/20/2026 10:00' },
    { event_id: 1, name: '5K', start_time: '12/21/2025 09:00' },
    { event_id: 2, name: 'Kids Dash', start_time: '12/21/2025 10:00' },
    { event_id: 3, name: 'Kids Dash', start_time: '6/1/2026 10:00' },
  ];
  assert.deepEqual(previousEvents(all, [11, 12]), [
    { event_id: 11, name: '5K', prev_event_id: 1 },
    { event_id: 12, name: 'Kids Dash', prev_event_id: 2 },
  ]);
  assert.deepEqual(previousEvents(all, [99]), []);
});

test("last year's finishers add up across events, and are cached", async () => {
  const calls = [];
  const fake = async (url) => {
    calls.push(url);
    if (!url.includes('/results/')) {
      return { ok: true, json: async () => ({ race: { events: [
        { event_id: 11, name: '5K', start_time: '12/20/2026 09:00', previous_year_event_id: 1 },
        { event_id: 12, name: 'Kids Dash', start_time: '12/20/2026 10:00', previous_year_event_id: 2 },
      ] } }) };
    }
    const id = new URL(url).searchParams.get('event_id');
    const sets = id === '1'
      ? [{ individual_result_set_name: 'Overall', num_finishers: 310 }, { individual_result_set_name: 'Chip', num_finishers: 300 }]
      : [{ individual_result_set_name: 'Kids', num_finishers: 45 }];
    return { ok: true, json: async () => ({ individual_results_sets: sets }) };
  };
  const cache = {};
  const lead = toLead(race(), window);
  const f = await lastYearFinishers(lead, { fetchImpl: fake, cache });
  assert.equal(f.count, 355);
  assert.equal(f.source_url, 'https://runsignup.com/Race/Results/1');
  assert.deepEqual(cache, { '1:1': 310, '1:2': 45 });
  assert.match(calls[1], /event_id=1&include_total_finishers=T/);

  calls.length = 0;
  assert.equal((await lastYearFinishers(lead, { fetchImpl: fake, cache })).count, 355);
  assert.equal(calls.length, 1, 'results come from the cache; only the race lookup is repeated');
});

test('no results posted → null, and that is cached too', async () => {
  const fake = async (url) => ({ ok: true, json: async () => (url.includes('/results/')
    ? { individual_results_sets: [] }
    : { race: { events: [{ event_id: 11, name: '5K', start_time: '12/20/2026 09:00', previous_year_event_id: 1 }] } }) });
  const cache = {};
  const f = await lastYearFinishers({ runsignup_race_id: 7, event_ids: [11] }, { fetchImpl: fake, cache });
  assert.equal(f.count, null);
  assert.equal(f.source_url, null);
  assert.deepEqual(cache, { '7:1': null });
});
