// npm run test:scripts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fetchRaces, rsuDay, toLead } from './runsignup.mjs';

const window = { from: '2026-12-14', to: '2027-01-25' };
const race = (over = {}) => ({
  race_id: 1, name: 'Jingle Bell Jog', is_private_race: 'F', is_draft_race: 'F', is_registration_open: 'T',
  url: 'https://runsignup.com/Race/IL/Cary/JingleBellJog', external_race_url: null,
  address: { city: 'Cary', zipcode: '60013' },
  events: [
    { name: '5K', start_time: '12/20/2026 09:00', distance: '5K', event_type: 'running_race' },
    { name: 'Kids Dash', start_time: '12/20/2026 10:00', distance: '', event_type: 'running_race' },
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
    race_name: 'Jingle Bell Jog', race_date: '2026-12-20', town: 'Cary', zipcode: '60013',
    url: 'https://runsignup.com/Race/IL/Cary/JingleBellJog', external_url: null,
    distances: ['5K', 'Kids Dash'], event_types: ['running_race'], registration_open: true,
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
  const leads = await fetchRaces({ zip: '60014', radius: 50, ...window }, fake);
  assert.equal(calls.length, 2);
  assert.equal(leads.length, 103);
  assert.match(calls[0], /zipcode=60014&radius=50&start_date=2026-12-14&end_date=2027-01-25/);
});
