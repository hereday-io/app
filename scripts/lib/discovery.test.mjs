// npm run test:scripts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { discoveryWindow, prioritise, raceKey, screenRace, slugFor, toImportRow, validateCandidate } from './discovery.mjs';

const window = discoveryWindow('2026-10-19');

const good = () => ({
  race_name: 'Woodstock Reindeer Run',
  race_date: '2027-01-09',
  date_source: 'https://woodstockrotary.org/reindeer',
  date_verified: true,
  town: 'Woodstock',
  tier: 1,
  distances: ['5K', '1 mile'],
  est_participants: 350,
  participants_source: 'https://runsignup.com/Race/Results/1',
  org: { name: 'Woodstock Rotary', type: 'service_club', description: null },
  contact: {
    full_name: 'Lee', role: 'Race director',
    email: 'lee@woodstockrotary.org', email_source: 'https://woodstockrotary.org/reindeer',
    phone: '815-555-0142', phone_source: 'https://woodstockrotary.org/reindeer',
  },
  course_map_url: null,
  map_type: 'none',
  fit_flags: [],
  found_via: ['https://runsignup.com/Race/IL/Woodstock/ReindeerRun'],
  why: 'Rotary-run 5K, ~350 finishers, no published map.',
});

test('window is 8–14 weeks out', () => {
  assert.deepEqual(window, { from: '2026-12-14', to: '2027-01-25' });
});

test('slug and race key match the database helpers', () => {
  assert.equal(slugFor('Woodstock Reindeer Run!', '2027-01-09'), 'woodstock-reindeer-run-2027');
  assert.equal(slugFor('St. Mary’s  Turkey Trot', null), 'st-mary-s-turkey-trot');
  assert.ok(slugFor('x'.repeat(59) + ' run', '2027-01-01').length <= 60);
  assert.ok(!slugFor('a'.repeat(59) + ' b', '2027-01-01').endsWith('-'));
  assert.equal(raceKey('Glenview  Gobbler!'), 'glenviewgobbler');
});

test('a complete candidate passes', () => {
  assert.deepEqual(validateCandidate(good(), { window }), []);
});

test('validation catches what would break or pollute the import', () => {
  const cases = [
    [{ race_date: '2026-11-01' }, /outside the window/],
    [{ race_date: 'Jan 9' }, /YYYY-MM-DD/],
    [{ date_source: null }, /date_verified needs date_source/],
    [{ tier: 4 }, /tier/],
    [{ org: { name: '', type: 'church' } }, /org.name/],
    [{ org: { name: 'X', type: 'nonprofit' } }, /org.type/],
    [{ org: { name: 'RaceCo', type: 'race_mgmt_company' } }, /race-management/],
    [{ fit_flags: ['large_field'] }, /Outside the ICP/],
    [{ fit_flags: ['shiny'] }, /Unknown fit_flags/],
    [{ est_participants: 2500 }, /outside 200–800/],
    [{ est_participants: 150 }, /outside 200–800/],
    [{ est_participants: null }, /est_participants is missing/],
    [{ participants_source: null }, /participants_source/],
    [{ org: { name: 'Stroll Magazine', type: 'business' } }, /business host is outside the ICP/],
    [{ org: { name: 'X', type: null } }, /org.type is missing/],
    [{ map_type: 'png' }, /map_type/],
    [{ map_type: 'unknown' }, /map_type is missing or unknown/],
    [{ map_type: 'pdf', course_map_url: 'https://x.org/map.pdf' }, /add the has_published_map/],
    [{ map_type: 'pdf', course_map_url: 'https://x.org/map.pdf', fit_flags: ['has_published_map'] }, /tier is 1 but the ICP makes it tier 2/],
    [{ map_type: 'pdf', fit_flags: ['has_published_map'], tier: 2 }, /needs course_map_url/],
    [{ fit_flags: ['has_published_map'] }, /drop the has_published_map/],
    [{ tier: 3 }, /tier must be 1 or 2/],
    [{ contact: { full_name: 'Lee' } }, /No contact/],
    [{ contact: { form_url: 'their website' } }, /form_url/],
    [{ contact: { email: 'lee@x.org', email_source: 'their facebook' } }, /email_source/],
    [{ contact: { phone: '815-555-0142' } }, /phone_source/],
    [{ found_via: [] }, /found_via/],
  ];
  for (const [patch, re] of cases) {
    const errors = validateCandidate({ ...good(), ...patch }, { window });
    assert.ok(errors.some((e) => re.test(e)), `${JSON.stringify(patch)} → ${re}, got ${JSON.stringify(errors)}`);
  }
});

test('import row lands unclaimed at New, with the research kept', () => {
  const row = toImportRow(good(), { discoveredOn: '2026-10-19' });
  assert.equal(row.slug, 'woodstock-reindeer-run-2027');
  assert.equal(row.stage, 'new');
  assert.equal(row.owner_id, null);
  assert.equal(row.channel, 'email');
  assert.deepEqual(row.account, { name: 'Woodstock Rotary', org_type: 'service_club', org_description: null });
  assert.equal(row.contact.email_source, 'https://woodstockrotary.org/reindeer');
  assert.match(row.notes, /Found by weekly discovery on 2026-10-19/);
  assert.match(row.notes, /Contact: Lee, Race director/);
  assert.equal(row.raw.found_via, 'https://runsignup.com/Race/IL/Woodstock/ReindeerRun');
  assert.equal(row.raw.est_participants, '350');
  assert.match(row.notes, /350 finishers last year/);
  for (const v of Object.values(row.raw)) assert.equal(typeof v, 'string');

  const phoneOnly = toImportRow({ ...good(), contact: { phone: '815-555-0142', phone_source: 'https://x.org' } }, { discoveredOn: '2026-10-19' });
  assert.equal(phoneOnly.channel, 'phone');
  assert.equal(phoneOnly.contact.email_source, null);

  const formOnly = { ...good(), contact: { form_url: 'https://race.org/contact' } };
  assert.deepEqual(validateCandidate(formOnly, { window }), []);
  const formRow = toImportRow(formOnly, { discoveredOn: '2026-10-19' });
  assert.equal(formRow.channel, 'form');
  assert.ok(formRow.notes.includes('Contact form: https://race.org/contact'));
});

test('a race that publishes a map is a valid tier 2 lead', () => {
  const tier2 = { ...good(), tier: 2, map_type: 'pdf', course_map_url: 'https://x.org/map.pdf', fit_flags: ['has_published_map'] };
  assert.deepEqual(validateCandidate(tier2, { window }), []);
  assert.deepEqual(validateCandidate({ ...good(), map_type: 'description' }, { window }), [], 'a text route is still tier 1');
});

test('import order: tier 1 first, then more distances, numbered after the CRM', () => {
  const row = (slug, tier, distances) => ({ slug, tier, raw: distances ? { distances } : {} });
  const out = prioritise([row('a', 2, '5K'), row('b', 1, '5K'), row('c', 1, '5K, 10K, Kids dash'), row('d', 2, null)], 40);
  assert.deepEqual(out.map((r) => [r.slug, r.priority]), [['c', 41], ['b', 42], ['a', 43], ['d', 44]]);
});

test('screening skips known, burned and rejected races', () => {
  const deals = [
    { slug: 'glenview-gobbler', race_name: 'Glenview Gobbler', race_date: '2026-11-26', stage: 'sent', effective_stage: 'sent' },
    { slug: 'elgin-elf-run-2025', race_name: 'Elgin Elf Run', race_date: '2025-12-06', stage: 'closed', outcome: 'not_interested' },
    { slug: 'lake-zurich-jingle-2025', race_name: 'Lake Zurich Jingle', race_date: '2025-12-13', stage: 'closed', outcome: 'no_response' },
    { slug: 'dnc-dash', race_name: 'DNC Dash', race_date: '2025-05-01', stage: 'closed', outcome: 'other', is_dnc: true },
    { slug: 'mapped-mile-2025', race_name: 'Mapped Mile', race_date: '2025-12-06', stage: 'closed', outcome: 'has_map' },
  ];
  const rejected = [{ race_name: 'Huge Holiday Half', year: 2027, reason: '4,000 runners', on: '2026-10-12' }];
  const known = { deals, rejected };

  assert.match(screenRace({ race_name: 'Glenview  Gobbler!', race_date: '2026-11-26' }, known), /glenview-gobbler/);
  assert.match(screenRace({ race_name: 'Elgin Elf Run', race_date: '2026-12-05' }, known), /closed as not_interested/);
  assert.equal(screenRace({ race_name: 'Lake Zurich Jingle', race_date: '2026-12-12' }, known), null, 'no reply last year → pitch again');
  assert.match(screenRace({ race_name: 'DNC Dash', race_date: '2027-05-01' }, known), /Do not contact/);
  assert.match(screenRace({ race_name: 'Huge Holiday Half', race_date: '2027-01-02' }, known), /4,000 runners/);
  assert.equal(screenRace({ race_name: 'Huge Holiday Half', race_date: '2028-01-01' }, known), null, 'rejections are per year');
  assert.equal(screenRace({ race_name: 'Mapped Mile', race_date: '2026-12-05' }, known), null, 'has a map → tier 2 next year');
  assert.equal(screenRace({ race_name: 'Brand New 5K', race_date: '2027-01-02' }, known), null);
});
