// npm run test:scripts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { STATES, computeTier, looksLikeSeries, rotationStates, seriesKey, seriesLeads } from './icp.mjs';

const race = (over = {}) => ({ org: { type: 'park_district' }, est_participants: 400, map_type: 'none', ...over });

test('tier comes from host, size and map', () => {
  assert.equal(computeTier(race()), 1);
  assert.equal(computeTier(race({ map_type: 'description' })), 1, 'a text route is not a map');
  assert.equal(computeTier(race({ map_type: 'pdf' })), 2);
  assert.equal(computeTier(race({ map_type: 'strava' })), 2);
  assert.equal(computeTier(race({ est_participants: 200 })), 1);
  assert.equal(computeTier(race({ est_participants: 800 })), 1);
  assert.equal(computeTier(race({ est_participants: 199 })), null);
  assert.equal(computeTier(race({ est_participants: 801 })), null);
  assert.equal(computeTier(race({ est_participants: null })), null);
  assert.equal(computeTier(race({ map_type: 'unknown' })), null);
  assert.equal(computeTier(race({ org: { type: 'business' } })), null);
  assert.equal(computeTier(race({ org: { type: 'race_mgmt_company' } })), null);
  for (const type of ['chamber', 'municipal', 'school_booster', 'school_foundation']) {
    assert.equal(computeTier(race({ org: { type } })), 1, type);
  }
});

test('series names are spotted', () => {
  for (const name of [
    'Sunrise Marathon 5K/10K/13.1 CHICAGO/EVANSTON', 'Candy Cane Course - Greater Chicago',
    'Run Houston Race Series', 'Iowa Runs', 'MN Runs', 'Missouri Runs Race Series',
  ]) assert.ok(looksLikeSeries(name), name);
  for (const name of [
    'Woodstock Reindeer Run', 'Park Ridge Santa Stroll 5k - Stroll Mile - Jingle Jog', 'Turkey Trot',
    'MIKE WALSH MEMORIAL 5K RUN/WALK', 'Roxbury Road Race Series Season Pass', 'Frosty Fun Runs',
  ]) {
    assert.ok(!looksLikeSeries(name), name);
  }
  assert.equal(seriesKey('Candy Cane Course - Milwaukee'), seriesKey('Candy Cane Course – Greater Chicago'));
  assert.equal(seriesKey('2026 Jingle Bell Run - Chicago, IL'), 'jingle bell run');
});

test('a travelling series names its stops; shared generic names are not a series', () => {
  const lead = (race_name, town, state) => ({ race_name, town, state });
  const leads = [
    lead('Candy Cane Course - Orlando', 'Orlando', 'FL'),
    lead('Candy Cane Course - Tampa', 'Tampa', 'FL'),
    lead('Candy Cane Course - Little Rock', 'Little Rock', 'AR'),
    lead('Holiday 5K, 10K, & 13.1M at Gadsden, AL (50)', 'Gadsden', 'AL'),
    lead('Ugly Sweater 5K', 'Belgrade', 'MT'),
    lead('Ugly Sweater 5K', 'Akron', 'OH'),
    lead('Ugly Sweater 5k', 'Reno', 'NV'),
    lead('Resolution Run - Fort Collins', 'Fort Collins', 'CO'),
    lead('Resolution Run', 'Las Vegas', 'NV'),
  ];
  const dropped = [...seriesLeads(leads)].map((l) => l.race_name);
  assert.deepEqual(dropped, ['Candy Cane Course - Orlando', 'Candy Cane Course - Tampa', 'Candy Cane Course - Little Rock']);
});

test('the rotation covers every state once', () => {
  const seen = [0, 1, 2, 3].flatMap(rotationStates);
  assert.deepEqual([...seen].sort(), [...STATES].sort());
  assert.deepEqual(rotationStates(4), rotationStates(0));
});
