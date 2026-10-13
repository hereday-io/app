// CRM migration checks against real Postgres (PGlite): the Workspace
// trigger, table lockdown, role masking, claims and expiry, do-not-contact,
// append-only history, import dry run / apply, signups triage, transfers
// and paid / refunded state. Fixtures only; touches no real database.
//
//   npm run test:db
import { createDb, testKit } from './pglite.mjs';

const { db, results } = await createDb();
const crmFails = results.filter((r) => !r.ok && r.f >= '20261012');
if (crmFails.length) {
  for (const r of crmFails) console.log('MIGRATION FAIL', r.f, r.err);
  process.exit(1);
}

const { ok, as, asPostgres, rpc, expectError, mkUser, done } = testKit(db);

// ── Fixtures ───────────────────────────────────────────────────────
await asPostgres();
const KEVIN = await mkUser('founder@gmail.com', 'google');
await db.query(`UPDATE public.profiles SET is_admin = true, display_name = 'Kevin' WHERE user_id = $1`, [KEVIN]);
const REP = await mkUser('pat@hereday.io', 'google');
const REP2 = await mkUser('sam@hereday.io', 'google');
const OUTSIDER = await mkUser('someone@gmail.com', 'google');
const SPOOF = await mkUser('ops@hereday.io', 'email');
const DIRECTOR = await mkUser('director@parkdistrict.org', 'email');
await db.query(`UPDATE public.profiles SET organization_name = 'Glenview Park District', display_name = 'Dana' WHERE user_id = $1`, [DIRECTOR]);

console.log('\nWorkspace trigger');
{
  const { rows } = await db.query(
    `SELECT u.email, p.is_admin, p.is_sales FROM auth.users u JOIN public.profiles p ON p.user_id = u.id ORDER BY u.email`);
  const by = Object.fromEntries(rows.map((r) => [r.email, r]));
  ok(by['pat@hereday.io'].is_sales && !by['pat@hereday.io'].is_admin, 'hereday.io Google sign-in gets sales, not admin');
  ok(!by['someone@gmail.com'].is_sales && !by['someone@gmail.com'].is_admin, 'gmail Google sign-in gets nothing');
  ok(!by['ops@hereday.io'].is_sales && !by['ops@hereday.io'].is_admin, 'hereday.io password sign-up gets nothing');
}

// Kevin's outreach map, published, in his account.
const { rows: [mapRow] } = await db.query(
  `INSERT INTO public.events (user_id, name, status, slug, event_date, city)
   VALUES ($1, 'Glenview Gobbler 5K', 'published', 'glenview-gobbler-5k-ab12', '2026-11-26', 'Glenview') RETURNING id`, [KEVIN]);
const MAP = mapRow.id;
await db.query(`INSERT INTO public.product_events (event_type, user_id, event_id) VALUES ('event_published', $1, $2)`, [KEVIN, MAP]);
// The director's own event (an inbound signup).
const { rows: [ownRow] } = await db.query(
  `INSERT INTO public.events (user_id, name, status, slug, event_date, city)
   VALUES ($1, 'Glenview Gobbler', 'draft', 'glenview-gobbler-x9', '2026-11-26', 'Glenview') RETURNING id`, [DIRECTOR]);
const OWN_EVENT = ownRow.id;
// A stranger's event that nobody has triaged.
const STRANGER = await mkUser('runclub@example.com', 'email');
await db.query(`INSERT INTO public.events (user_id, name, status, slug) VALUES ($1, 'Lakeside Fun Run', 'draft', 'lakeside-fun-run')`, [STRANGER]);

console.log('\nLockdown');
{
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM information_schema.role_table_grants
      WHERE table_name LIKE 'crm\\_%' AND grantee IN ('anon', 'authenticated')`);
  ok(rows[0].n === 0, 'no table grants to anon/authenticated on crm_*', rows[0]);
  const { rows: rls } = await db.query(
    `SELECT relname, relrowsecurity FROM pg_class WHERE relname LIKE 'crm\\_%' AND relkind = 'r'`);
  ok(rls.length === 5 && rls.every((r) => r.relrowsecurity), 'RLS on every crm_ table', rls);
  const { rows: fns } = await db.query(
    `SELECT p.proname, p.prosecdef, p.proconfig FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname LIKE 'crm\\_%'`);
  ok(fns.length >= 18 && fns.every((f) => f.prosecdef && f.proconfig?.some((c) => c.startsWith('search_path='))),
    `every public crm_ RPC is definer with search_path (${fns.length})`);
  const { rows: anonExec } = await db.query(
    `SELECT p.proname FROM pg_proc p JOIN pg_namespace n ON n.oid = p.pronamespace
      WHERE n.nspname = 'public' AND p.proname LIKE 'crm\\_%' AND has_function_privilege('anon', p.oid, 'execute')`);
  ok(anonExec.length === 0, 'anon can execute no crm_ RPC', anonExec);
  const { rows: schemaUse } = await db.query(
    `SELECT has_schema_privilege('authenticated', 'crm_internal', 'usage') AS a,
            has_schema_privilege('anon', 'crm_internal', 'usage') AS b`);
  ok(!schemaUse[0].a && !schemaUse[0].b, 'crm_internal not usable by client roles');
}

console.log('\nNormal user');
await as(OUTSIDER);
await expectError(() => db.query(`SELECT * FROM public.crm_deals`), '42501', 'table read refused');
await expectError(() => rpc('crm_list_deals'), '42501', 'crm_list_deals refused');
await expectError(() => rpc('crm_get_deal', { p_slug: 'x' }), '42501', 'crm_get_deal refused');
{
  const r = await db.query(`UPDATE public.profiles SET is_sales = true WHERE user_id = auth.uid()`).catch((e) => e);
  ok(r instanceof Error && r.code === '42501', 'cannot self-promote to sales', r.code ?? r);
  const r2 = await db.query(`UPDATE public.profiles SET utm_source = 'x' WHERE user_id = auth.uid()`);
  ok(r2.affectedRows === 1, 'can still update own attribution');
  const role = await rpc('staff_role');
  ok(role === null, 'staff_role() is null');
}

console.log('\nImport (admin)');
await as(KEVIN);
const rows = [
  { slug: 'glenview-gobbler', race_name: 'Glenview Gobbler', race_date: '2026-11-26', date_verified: true,
    town: 'Glenview', tier: 1, priority: 1, stage: 'sent', sent_at: '2026-10-01', owner_id: KEVIN,
    account: { name: 'Glenview Park District', org_type: 'park_district' },
    contact: { full_name: 'Dana', email: 'director@parkdistrict.org', email_source: 'https://glenviewparks.org/contact',
               phone: '847-555-0100', phone_source: 'https://glenviewparks.org/contact' },
    hereday_link: 'https://hereday.io/event/glenview-gobbler-5k-ab12', map_type: 'image',
    raw: { status: 'sent' } },
  { slug: 'pool-race', race_name: 'Pool Race', race_date: '2026-12-05', tier: 2, priority: 2, stage: 'new',
    contact: { email: 'pool@example.org', email_source: 'https://example.org' } },
  { slug: 'kevins-researched', race_name: 'Kevins Researched', race_date: '2026-12-06', priority: 3,
    stage: 'researched', owner_id: KEVIN, contact: { email: 'kr@example.org', email_source: 'not a url' } },
  { slug: 'mgmt-a', race_name: 'Mgmt Race A', stage: 'closed', outcome: 'not_a_fit', fit_flags: ['race_mgmt_company'],
    contact: { email: 'ops@racemgmt.com', email_source: 'https://racemgmt.com' } },
  { slug: 'mgmt-b', race_name: 'Mgmt Race B', stage: 'closed',
    contact: { email: 'OPS@racemgmt.com', email_source: 'https://racemgmt.com' } },
  { slug: 'Bad Slug', race_name: 'x' },
];
{
  const dry = await rpc('crm_import', { p_rows: JSON.stringify(rows), p_source: 'leads_csv', p_dry_run: true });
  ok(dry.dry_run === true && dry.counts.created === 5 && dry.counts.error === 1, 'dry run: 5 created, 1 error', dry.counts);
  await asPostgres();
  const { rows: c } = await db.query(`SELECT (SELECT count(*) FROM public.crm_deals)::int AS n,
                                             (SELECT count(*) FROM public.crm_contacts)::int AS c,
                                             (SELECT count(*) FROM public.crm_event_links)::int AS l`);
  ok(c[0].n === 0 && c[0].c === 0 && c[0].l === 0, 'dry run wrote nothing', c[0]);
  await as(KEVIN);
  const r1 = dry.rows.find((r) => r.slug === 'glenview-gobbler');
  ok(r1.event_link === 'linked', 'dry run links the map from hereday_link', r1);
  const r3 = dry.rows.find((r) => r.slug === 'kevins-researched');
  ok(r3.warnings.some((w) => /no source URL/.test(w)), 'email without a source URL is dropped with a warning', r3);
  const r5 = dry.rows.find((r) => r.slug === 'mgmt-b');
  ok(r5.outcome === 'other' && r5.warnings.some((w) => /Shares a contact with mgmt-a/.test(w)),
    'shared contact reused; closed without outcome → other', r5);

  await expectError(() => rpc('crm_import', { p_rows: JSON.stringify(rows), p_source: 'leads_csv', p_dry_run: false }),
    '22023', 'apply with an error row writes nothing');
  const good = rows.filter((r) => r.slug !== 'Bad Slug');
  const applied = await rpc('crm_import', { p_rows: JSON.stringify(good), p_source: 'leads_csv', p_dry_run: false });
  ok(applied.counts.created === 5, 'apply: 5 created', applied.counts);
  const again = await rpc('crm_import', { p_rows: JSON.stringify(good), p_source: 'leads_csv', p_dry_run: true });
  ok(again.counts.exists === 5, 're-run: 5 exists', again.counts);
  const conflict = await rpc('crm_import', {
    p_rows: JSON.stringify([{ slug: 'glenview-gobbler-turkey', race_name: 'Glenview  Gobbler!', race_date: '2026-11-26' }]),
    p_source: 'sales_sheet', p_dry_run: true });
  ok(conflict.rows[0].action === 'conflict' && conflict.rows[0].conflict_with === 'glenview-gobbler',
    'same race under another slug is a conflict', conflict.rows[0]);
}

const dealId = async (slug) => (await db.query(`SELECT public.crm_get_deal($1) AS r`, [slug])).rows[0].r.deal.id;

console.log('\nAdmin view');
{
  const d = await rpc('crm_get_deal', { p_slug: 'glenview-gobbler' });
  ok(d.deal.contact_email === 'director@parkdistrict.org', 'admin sees contact details');
  ok(d.deal.map_built && d.deal.map_published, 'linked staff map shows built + published', d.deal);
  ok(d.deal.effective_stage === 'signed_up', 'director already has an account → signed_up', d.deal.effective_stage);
  ok(d.timeline.some((t) => t.type === 'email_sent' && t.meta.synthetic), 'synthetic email_sent from sent date');
  ok(d.deal.next_step_at === '2026-10-08' && d.deal.is_due, 'imported send gets a follow-up 5 business days out', d.deal);
  ok(d.timeline.some((t) => t.type === 'app_event_published'), 'timeline merges app publish');
  ok(d.events.length === 1 && d.events[0].owner_email === 'founder@gmail.com', 'events list with owner for admin');
}

console.log('\nSales rep');
await as(REP);
{
  ok((await rpc('staff_role')) === 'sales', 'staff_role() = sales');
  await expectError(() => db.query(`SELECT * FROM public.crm_deals`), '42501', 'table read refused');
  const list = await rpc('crm_list_deals');
  const g = list.find((x) => x.slug === 'glenview-gobbler');
  ok(g && g.contact_email === undefined && g.notes === undefined && g.can_view_details === false,
    "Kevin's deal is masked", g);
  ok(g.has_email === true && g.owner_name === 'Kevin', 'but shows has_email and owner');
  ok(!list.some((x) => x.slug === 'mgmt-a'), 'closed deals hidden by default');
  const d = await rpc('crm_get_deal', { p_slug: 'glenview-gobbler' });
  ok(d.timeline.length === 0 && d.contact.email === undefined && d.events[0].owner_email == null,
    'detail is masked too', d.contact);
  await expectError(() => rpc('crm_claim_deal', { p_deal_id: g.id }), 'CR001', "claiming Kevin's sent deal → CR001");
  await expectError(() => rpc('crm_log_activity', { p_deal_id: g.id, p_type: 'note', p_body: 'hi' }),
    '42501', "logging on Kevin's deal → 42501");
  const pool = list.find((x) => x.slug === 'pool-race');
  const claimed = await rpc('crm_claim_deal', { p_deal_id: pool.id });
  ok(claimed.is_mine && claimed.contact_email === 'pool@example.org', 'claiming the pool unlocks details', claimed);
  for (const fn of ['get_admin_overview', 'crm_list_signups']) {
    await expectError(() => (fn === 'get_admin_overview' ? rpc(fn, { p_days: 30 }) : rpc(fn)), '42501', `${fn} → 42501`);
  }
  await expectError(() => rpc('admin_get_event', { p_ref: 'x' }), '42501', 'admin_get_event → 42501');
  await expectError(() => rpc('admin_transfer_event', { p_event_id: MAP, p_to_email: 'x@y.z' }), '42501', 'admin_transfer_event → 42501');
  await expectError(() => rpc('crm_import', { p_rows: '[]', p_source: 'leads_csv' }), '42501', 'crm_import → 42501');
  const cg = await db.query(`SELECT count(*)::int n FROM public.comp_grants`);
  ok(cg.rows[0].n === 0, 'comp_grants reads empty');

  // Email already on Kevin's deal.
  const mine = await rpc('crm_create_deal', { p_deal: JSON.stringify({ race_name: 'Rep Race', race_date: '2027-03-01' }) });
  ok(mine.deal.slug === 'rep-race-2027' && mine.deal.is_mine, 'rep creates a deal and owns it', mine.deal);
  await expectError(() => rpc('crm_upsert_contact', { p_deal_id: mine.deal.id,
    p_contact: JSON.stringify({ email: 'Director@ParkDistrict.org', email_source: 'https://x.org' }) }),
    'CR001', "email already on Kevin's deal → CR001");
  await expectError(() => rpc('crm_upsert_contact', { p_deal_id: mine.deal.id,
    p_contact: JSON.stringify({ email: 'new@x.org', email_source: 'from a friend' }) }),
    '23514', 'email without a source URL → CHECK violation');
  await expectError(() => rpc('crm_create_deal', { p_deal: JSON.stringify({ race_name: 'GLENVIEW gobbler', race_date: '2026-11-01' }) }),
    'CR004', 'duplicate race → CR004');

  // Stage side effects.
  const sent = await rpc('crm_log_activity', { p_deal_id: pool.id, p_type: 'email_sent', p_occurred_at: '2026-10-01T15:00:00Z' });
  ok(sent.deal.stage === 'sent' && sent.deal.sent_at === '2026-10-01' && sent.deal.next_step_at === '2026-10-08',
    'email_sent → sent, follow-up 5 business days out', sent.deal);
  const call = await rpc('crm_log_activity', { p_deal_id: pool.id, p_type: 'call', p_occurred_at: '2026-10-08T15:00:00Z' });
  ok(call.deal.stage === 'followed_up' && call.deal.followed_up_at === '2026-10-08', 'call after send → followed_up', call.deal);
  const obj = await rpc('crm_log_activity', { p_deal_id: pool.id, p_type: 'objection', p_quote: 'We already have a map.' });
  ok(obj.deal.stage === 'replied' && obj.deal.objection === 'We already have a map.' && obj.deal.next_step_at === null,
    'objection → replied, stored verbatim', obj.deal);
  await expectError(() => rpc('crm_log_activity', { p_deal_id: pool.id, p_type: 'objection' }), '22023', 'objection needs a quote');
  const closed = await rpc('crm_set_stage', { p_deal_id: pool.id, p_stage: 'closed', p_outcome: 'has_map' });
  ok(closed.stage === 'closed' && closed.outcome === 'has_map', 'manual close with outcome');
  await expectError(() => rpc('crm_set_stage', { p_deal_id: pool.id, p_stage: 'closed' }), '22023', 'close without outcome refused');

  // DNC.
  const dnc = await rpc('crm_mark_dnc', { p_deal_id: mine.deal.id, p_scope: 'contact', p_reason: 'asked' }).catch((e) => e);
  ok(dnc instanceof Error && dnc.code === '22023', 'DNC needs a contact');
  await rpc('crm_upsert_contact', { p_deal_id: mine.deal.id, p_contact: JSON.stringify({ full_name: 'Robin', phone: '(847) 555-0199', phone_source: 'https://rep.example' }) });
  const marked = await rpc('crm_mark_dnc', { p_deal_id: mine.deal.id, p_scope: 'contact', p_reason: 'Asked us to stop.' });
  ok(marked.closed_deal_ids.length === 1, 'DNC closes the open deal', marked);
  await expectError(() => rpc('crm_log_activity', { p_deal_id: mine.deal.id, p_type: 'email_sent' }), 'CR002', 'outbound after DNC → CR002');
  const reply = await rpc('crm_log_activity', { p_deal_id: mine.deal.id, p_type: 'reply', p_quote: 'Please stop.' });
  ok(reply.deal.stage === 'closed' && reply.deal.outcome === 'do_not_contact', 'a reply never reopens a DNC close', reply.deal);
  const other = await rpc('crm_create_deal', { p_deal: JSON.stringify({ race_name: 'Another Rep Race' }) });
  const sup = await rpc('crm_upsert_contact', { p_deal_id: other.deal.id, p_contact: JSON.stringify({ phone: '847.555.0199', phone_source: 'https://rep.example/2' }) });
  ok(sup.dnc_match === true && sup.deal.is_dnc && sup.deal.stage === 'closed', 'same phone as a DNC contact is suppressed', sup);
}

console.log('\nClaim expiry');
await asPostgres();
await db.query(`INSERT INTO public.crm_deals (slug, race_name, source, stage, owner_id, claimed_at)
                VALUES ('stale-claim', 'Stale Claim', 'manual', 'new', $1, now() - interval '8 days'),
                       ('fresh-claim', 'Fresh Claim', 'manual', 'new', $1, now() - interval '2 days')`, [REP2]);
await as(REP);
{
  const stale = await rpc('crm_claim_deal', { p_deal_id: await dealId('stale-claim') });
  ok(stale.is_mine, 'expired claim (8 days, still new) can be taken over');
  await expectError(async () => rpc('crm_claim_deal', { p_deal_id: await dealId('fresh-claim') }), 'CR001', 'fresh claim → CR001');
  const d = await rpc('crm_get_deal', { p_slug: 'stale-claim' });
  ok(d.timeline.some((t) => t.type === 'claim' && t.meta.took_over_expired), 'takeover logged');
}

console.log('\nAppend-only and DNC permanence (as postgres)');
await asPostgres();
await expectError(() => db.query(`DELETE FROM public.crm_activities`), '42501', 'deleting activities raises');
await expectError(() => db.query(`UPDATE public.crm_activities SET body = 'edited'`), '42501', 'editing activities raises');
await expectError(() => db.query(`UPDATE public.crm_contacts SET do_not_contact = false, dnc_at = NULL WHERE do_not_contact`), 'CR002', 'un-setting DNC raises');
await expectError(() => db.query(`UPDATE public.crm_deals SET slug = 'renamed' WHERE slug = 'pool-race'`), '22023', 'renaming a slug raises');
{
  await db.exec(`BEGIN; SET LOCAL crm.maintenance = 'on'; UPDATE public.crm_deals SET slug = 'renamed' WHERE slug = 'pool-race'; ROLLBACK;`);
  ok(true, 'maintenance escape hatch works');
}

console.log('\nSignups, transfer, triage (admin)');
await as(KEVIN);
{
  const signups = await rpc('crm_list_signups');
  const dir = signups.find((s) => s.email === 'director@parkdistrict.org');
  ok(dir && dir.suggestions.some((s) => s.slug === 'glenview-gobbler' && s.reason === 'contact'),
    'director appears untriaged with a contact match', dir);
  ok(signups.some((s) => s.email === 'runclub@example.com'), 'stranger appears untriaged');
  ok(!signups.some((s) => s.email === 'founder@gmail.com'), 'staff are not listed as signups');

  await rpc('admin_transfer_event', { p_event_id: MAP, p_to_email: 'director@parkdistrict.org' });
  const d = await rpc('crm_get_deal', { p_slug: 'glenview-gobbler' });
  ok(d.deal.handed_off_at && d.deal.customer_published && d.deal.effective_stage === 'published',
    'after transfer: handed off, customer published', d.deal);
  ok(d.timeline.some((t) => t.type === 'app_transferred'), 'transfer appears on the timeline');

  const linked = await rpc('crm_triage_event', { p_event_id: OWN_EVENT, p_action: 'link', p_deal_id: d.deal.id });
  ok(linked.deal.slug === 'glenview-gobbler', 'triage link');
  const after = await rpc('crm_list_signups');
  ok(!after.some((s) => s.email === 'director@parkdistrict.org'), 'director leaves the untriaged queue');

  const stranger = after.find((s) => s.email === 'runclub@example.com');
  const created = await rpc('crm_triage_event', { p_event_id: stranger.events[0].event_id, p_action: 'create' });
  ok(created.deal.source === 'inbound' && created.deal.effective_stage === 'signed_up' && created.deal.is_mine,
    'triage create → inbound deal, signed up', created.deal);

  await asPostgres();
  await db.query(`UPDATE public.events SET paid_at = now(), stripe_payment_id = 'pi_test' WHERE id = $1`, [OWN_EVENT]);
  await as(KEVIN);
  const paid = await rpc('crm_get_deal', { p_slug: 'glenview-gobbler' });
  ok(paid.deal.effective_stage === 'paid', 'Stripe-paid linked event → paid', paid.deal.effective_stage);
  await asPostgres();
  await db.query(`UPDATE public.events SET paid_at = NULL, plan = 'free' WHERE id = $1`, [OWN_EVENT]);
  await as(KEVIN);
  const refunded = await rpc('crm_get_deal', { p_slug: 'glenview-gobbler' });
  ok(refunded.deal.effective_stage === 'published' && refunded.deal.refunded, 'refund moves it back and flags refunded', refunded.deal);
}

console.log('\nAssign, void');
{
  const id = await dealId('kevins-researched');
  const a = await rpc('crm_assign_deal', { p_deal_id: id, p_owner_id: REP });
  ok(a.owner_id === REP, 'admin assigns to a rep');
  await expectError(() => rpc('crm_assign_deal', { p_deal_id: id, p_owner_id: OUTSIDER }), '22023', 'cannot assign to a non-staff user');
  const d = await rpc('crm_get_deal', { p_slug: 'kevins-researched' });
  const act = d.timeline.find((t) => t.type === 'assign');
  const v = await rpc('crm_void_activity', { p_activity_id: act.id, p_reason: 'test' });
  ok(v.activity_id === act.id, 'admin voids an activity');
}

console.log('\nCLI RPCs (20261013121000)');
{
  const g = await dealId('glenview-gobbler');
  const r = await rpc('crm_update_deal', {
    p_deal_id: g,
    p_patch: JSON.stringify({ gmail_draft_id: 'r-1', gmail_thread_id: 't-1', gmail_draft_mailbox: 'kevin@hereday.io' }),
  });
  ok(r.deal.gmail_draft_id === 'r-1' && r.deal.gmail_thread_id === 't-1', 'draft and thread ids saved');
  await expectError(
    async () => rpc('crm_update_deal', { p_deal_id: await dealId('rep-race-2027'), p_patch: JSON.stringify({ gmail_draft_id: 'r-2' }) }),
    'CR002',
    'no Gmail draft on a do-not-contact deal',
  );
  const objs = await rpc('crm_list_objections');
  ok(objs.some((o) => o.deal_slug === 'pool-race' && o.quote === 'We already have a map.'), 'admin sees every objection');
  const exp = await rpc('crm_export');
  ok(exp.some((d) => d.slug === 'glenview-gobbler' && d.email_source === 'https://glenviewparks.org/contact'),
    'export carries contact sources');
}
await as(REP2);
{
  const objs = await rpc('crm_list_objections');
  ok(objs.length === 0, "a rep doesn't see objections on deals they don't own");
  await expectError(() => rpc('crm_export'), '42501', 'export is admin-only');
}

done();
