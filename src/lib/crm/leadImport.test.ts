import { describe, expect, it } from 'vitest';
import {
  duplicateSlugs,
  extractOrgName,
  isExampleRow,
  mapLeadsCsvRow,
  mapSheetRow,
  normalizeMapType,
  normalizeOrgType,
  real,
  resolveOwner,
} from './leadImport';
import { parseCsv, toCsv } from './csv';
import { parseEventRef } from './eventRef';

const KEVIN = '11111111-1111-1111-1111-111111111111';
const PAT = '22222222-2222-2222-2222-222222222222';

const leadsRow = (over: Record<string, string> = {}): Record<string, string> => ({
  slug: 'example-trot',
  race: 'Example Trot 5K',
  date: '2026-11-26',
  date_verified: 'Y',
  town: 'Crystal Lake',
  tier: '1',
  org_type: 'School booster club — CLC Booster Club (Crystal Lake Central)',
  director: 'Jane',
  email: 'jane@example.org',
  email_source: 'https://example.org/contact',
  phone: 'NOT_FOUND',
  phone_source: '',
  course_map_url: 'https://example.org/map.png',
  map_type: 'image',
  hereday_link: '',
  gmail_draft_id: 'r-123',
  status: 'sent',
  sent_date: '2026-10-11',
  followup_date: '',
  outcome: '',
  objection: '',
  notes: 'Two distances.',
  ...over,
});

describe('csv', () => {
  it('round-trips quotes, commas and newlines', () => {
    const header = ['a', 'b'];
    const rows = [{ a: 'one, two', b: 'say "hi"\nthere' }];
    const parsed = parseCsv(toCsv(header, rows));
    expect(parsed.header).toEqual(header);
    expect(parsed.rows).toEqual(rows);
  });

  it('strips a BOM and handles CRLF', () => {
    const parsed = parseCsv('﻿slug,race\r\nx,"Y, Z"\r\n\r\n');
    expect(parsed.header).toEqual(['slug', 'race']);
    expect(parsed.rows).toEqual([{ slug: 'x', race: 'Y, Z' }]);
  });
});

describe('parseEventRef', () => {
  it('reads public links, editor links, ids and slugs', () => {
    expect(parseEventRef('https://hereday.io/event/glenview-gobbler-ab12?x=1')).toBe('glenview-gobbler-ab12');
    expect(parseEventRef('https://hereday.io/editor?id=6F1E2D3C-1111-4222-8333-944455556666')).toBe(
      '6f1e2d3c-1111-4222-8333-944455556666',
    );
    expect(parseEventRef('  my-slug ')).toBe('my-slug');
  });
});

describe('vocabulary', () => {
  it('treats bookkeeping placeholders as empty', () => {
    expect(real('NOT_FOUND')).toBeNull();
    expect(real('pending')).toBeNull();
    expect(real(' n/a ')).toBeNull();
    expect(real('x')).toBe('x');
  });

  it('reconciles map types across trackers', () => {
    expect(normalizeMapType('googlemymaps')).toBe('google_my_maps');
    expect(normalizeMapType('mymaps')).toBe('google_my_maps');
    expect(normalizeMapType('Strava')).toBe('strava');
    expect(normalizeMapType('carrier pigeon')).toBe('unknown');
    expect(normalizeMapType('')).toBeNull();
  });

  it('classifies free-text org types', () => {
    expect(normalizeOrgType('All-volunteer 501(c)(3) high-school booster club')).toBe('school_booster');
    expect(normalizeOrgType('Municipal park district (Palatine Park District)')).toBe('park_district');
    expect(normalizeOrgType('For-profit race-management company')).toBe('race_mgmt_company');
    expect(normalizeOrgType('School-district education foundation')).toBe('school_foundation');
    expect(normalizeOrgType('Chamber of Commerce')).toBe('chamber');
    expect(normalizeOrgType('nonprofit clinic fundraiser')).toBe('charity');
    expect(normalizeOrgType('Unknown / unidentified. No host organisation, club, charity')).toBe('other');
    expect(normalizeOrgType('')).toBeNull();
  });

  it('extracts an org name only when one is there', () => {
    expect(extractOrgName('School booster club — GCHS Booster Club (Grayslake Central High)')).toBe('GCHS Booster Club');
    expect(extractOrgName('Race-management company. All Community Events, Inc. (Lake Zurich). Runs many.')).toBe(
      'All Community Events, Inc.',
    );
    expect(extractOrgName('Municipal park district (Palatine Park District) — race is run by staff')).toBe(
      'Palatine Park District',
    );
    expect(extractOrgName('Independent race-management / event company — "Run Carpe Diem" runs it')).toBe('Run Carpe Diem');
    expect(extractOrgName('School-district education foundation (two of them, jointly).')).toBeNull();
    expect(extractOrgName('Unknown / unidentified. No host organisation, club, charity')).toBeNull();
    expect(extractOrgName('service club')).toBeNull();
    // 60-character cells are cut off mid-name.
    expect(extractOrgName('Volunteer parish service club — Our Lady of Perpetual Help C')).toBeNull();
    expect(extractOrgName('Private PreK-12 Christian school (Parkview Christian Academy')).toBeNull();
  });
});

describe('mapLeadsCsvRow', () => {
  it('maps a sent row to Kevin with a synthetic-send date', () => {
    const r = mapLeadsCsvRow(leadsRow(), 4, KEVIN);
    expect(r.stage).toBe('sent');
    expect(r.owner_id).toBe(KEVIN);
    expect(r.priority).toBe(5);
    expect(r.sent_at).toBe('2026-10-11');
    expect(r.channel).toBe('email');
    expect(r.contact).toMatchObject({ full_name: 'Jane', email: 'jane@example.org', phone: null });
    expect(r.account).toMatchObject({ name: 'CLC Booster Club', org_type: 'school_booster' });
    expect(r.date_verified).toBe(true);
  });

  it('leaves new rows unclaimed', () => {
    expect(mapLeadsCsvRow(leadsRow({ status: 'new', sent_date: '' }), 0, KEVIN).owner_id).toBeNull();
  });

  it('turns excluded into not_a_fit on closed rows and fit flags on open ones', () => {
    const closed = mapLeadsCsvRow(
      leadsRow({ status: 'closed', outcome: 'excluded', org_type: 'Race-management company. All Community Events, Inc.', notes: 'EXCLUDED: race-management, 1,000 participants.' }),
      0,
      KEVIN,
    );
    expect(closed.stage).toBe('closed');
    expect(closed.outcome).toBe('not_a_fit');
    expect(closed.fit_flags).toEqual(['large_field', 'race_mgmt_company']);

    const open = mapLeadsCsvRow(leadsRow({ outcome: 'excluded', notes: 'FLAG: POSSIBLE EXCLUSION — size.' }), 0, KEVIN);
    expect(open.stage).toBe('sent');
    expect(open.outcome).toBeNull();
    expect(open.fit_flags).toEqual(['large_field']);
  });

  it('keeps published/paid as claims to check, not stored outcomes', () => {
    const r = mapLeadsCsvRow(leadsRow({ outcome: 'published' }), 0, KEVIN);
    expect(r.stage).toBe('replied');
    expect(r.outcome).toBeNull();
    expect(r.tracker_claims).toEqual(['published']);
  });

  it('reads fit flags from the flag sentence, not every mention', () => {
    const r = mapLeadsCsvRow(
      leadsRow({ outcome: 'excluded', org_type: 'Municipal park district (Palatine Park District)', notes: 'FLAG: Probably exclude on SIZE. NOT run by a race-management company.' }),
      0,
      KEVIN,
    );
    expect(r.fit_flags).toEqual(['large_field']);
    expect(r.account).toMatchObject({ name: 'Palatine Park District', org_type: 'park_district' });
    const hold = mapLeadsCsvRow(leadsRow({ notes: 'FLAG: Recommend HOLD — verify a human exists. Distance is fine and size is not the problem.' }), 0, KEVIN);
    expect(hold.fit_flags).toEqual(['no_named_contact']);
  });

  it('keeps the org type when the name is missing', () => {
    const r = mapLeadsCsvRow(leadsRow({ org_type: 'service club' }), 0, KEVIN);
    expect(r.account).toMatchObject({ name: '', org_type: 'service_club' });
  });

  it('maps no_reply to no_response and reads followup_date as done', () => {
    const r = mapLeadsCsvRow(leadsRow({ status: 'closed', outcome: 'no_reply', followup_date: '2026-10-18' }), 0, KEVIN);
    expect(r.outcome).toBe('no_response');
    expect(r.followed_up_at).toBe('2026-10-18');
    expect(r.next_step_at).toBeNull();
  });

  it('drops contact details that have no source URL', () => {
    const r = mapLeadsCsvRow(leadsRow({ email_source: '', phone: '555-0100', phone_source: 'a friend' }), 0, KEVIN);
    expect(r.contact).toMatchObject({ email: null, phone: null, full_name: 'Jane' });
    expect(r.warnings.filter((w) => /no source URL/.test(w))).toHaveLength(2);
  });

  it('ignores a PENDING hereday link', () => {
    expect(mapLeadsCsvRow(leadsRow({ hereday_link: 'PENDING' }), 0, KEVIN).hereday_link).toBeNull();
  });
});

describe('mapSheetRow', () => {
  const sheetRow = (over: Record<string, string> = {}) => ({
    owner: 'Pat',
    claimed_date: '2026-10-01',
    channel: 'phone',
    do_not_contact: 'N',
    ...leadsRow({ status: 'sent', followup_date: '2026-10-18' }),
    ...over,
  });

  it('reads followup_date as due on a sent row', () => {
    const r = mapSheetRow(sheetRow(), PAT);
    expect(r.owner_id).toBe(PAT);
    expect(r.claimed_at).toBe('2026-10-01');
    expect(r.channel).toBe('phone');
    expect(r.next_step_at).toBe('2026-10-18');
    expect(r.followed_up_at).toBeNull();
  });

  it('reads followup_date as done once followed up', () => {
    const r = mapSheetRow(sheetRow({ status: 'followed_up' }), PAT);
    expect(r.stage).toBe('followed_up');
    expect(r.followed_up_at).toBe('2026-10-18');
    expect(r.next_step_at).toBeNull();
  });

  it('turns published status into replied plus a claim', () => {
    const r = mapSheetRow(sheetRow({ status: 'published' }), PAT);
    expect(r.stage).toBe('replied');
    expect(r.tracker_claims).toEqual(['published']);
  });

  it('carries do_not_contact through to the contact and closes', () => {
    const r = mapSheetRow(sheetRow({ status: 'do_not_contact' }), PAT);
    expect(r.contact?.do_not_contact).toBe(true);
    expect(r.stage).toBe('closed');
    expect(r.outcome).toBe('do_not_contact');
    expect(mapSheetRow(sheetRow({ do_not_contact: 'Y' }), PAT).contact?.do_not_contact).toBe(true);
  });

  it('claim maps to new with an owner', () => {
    const r = mapSheetRow(sheetRow({ status: 'claimed' }), PAT);
    expect(r.stage).toBe('new');
    expect(r.owner_id).toBe(PAT);
  });

  it('spots the instructional example row', () => {
    expect(isExampleRow({ owner: 'EXAMPLE — delete this row', slug: 'example-turkey-trot' })).toBe(true);
    expect(isExampleRow({ owner: 'Pat', slug: 'real-race' })).toBe(false);
  });
});

describe('resolveOwner', () => {
  const staff = [
    { user_id: KEVIN, email: 'kevin@hereday.io', display_name: 'Kevin' },
    { user_id: PAT, email: 'pat@hereday.io', display_name: 'Pat Smith' },
  ];
  it('matches by name, first name or email', () => {
    expect(resolveOwner('pat', staff)).toBe(PAT);
    expect(resolveOwner('Pat Smith', staff)).toBe(PAT);
    expect(resolveOwner('kevin@hereday.io', staff)).toBe(KEVIN);
    expect(resolveOwner('Robin', staff)).toBeNull();
    expect(resolveOwner('', staff)).toBeNull();
  });
});

describe('duplicateSlugs', () => {
  it('finds repeats', () => {
    expect(duplicateSlugs([{ slug: 'a' }, { slug: 'b' }, { slug: 'a' }])).toEqual(['a']);
  });
});
