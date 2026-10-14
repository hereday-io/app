// Least privilege for anon and authenticated (20261014150000). Before it,
// anon could rewrite or delete any published event through the
// public_events view and forge revenue rows in product_events. After it,
// every signed-out flow (public page, subscribe, aid-station statuses,
// live tracking, analytics logging) and every signed-in flow the app has
// still works, and anon holds privileges on exactly five objects.
// It also proves the migration refuses to commit when prod has a policy
// it doesn't know about. Fixtures only; touches no real database.
//
//   npm run test:db
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { createDb, testKit, REPO_ROOT } from './pglite.mjs';

const MIGRATION = '20261014150000_anon_least_privilege.sql';
const migrationSql = readFileSync(join(REPO_ROOT, 'supabase', 'migrations', MIGRATION), 'utf8');

const { db, results } = await createDb(REPO_ROOT, { stopBefore: MIGRATION });
const failed = results.filter((r) => !r.ok);
if (failed.length) {
  for (const r of failed) console.log('MIGRATION FAIL', r.f, r.err);
  process.exit(1);
}
const { ok, as, asPostgres, rpc, expectError, mkUser, done } = testKit(db);

const asAnon = async () => {
  await asPostgres();
  await db.query(`SELECT set_config('request.jwt.claims', $1, false)`, [JSON.stringify({ role: 'anon' })]);
  await db.exec(`SET ROLE anon`);
};
const rows = async (sql, params) => (await db.query(sql, params)).rows;

const ME = await mkUser('director@example.org', 'email');
const OTHER = await mkUser('other@example.org', 'email');
const ADMIN = await mkUser('admin@hereday.io', 'google');
await db.query(`UPDATE public.profiles SET is_admin = true WHERE user_id = $1`, [ADMIN]);

const mkEvent = async (owner, slug, status) => (await db.query(
  `INSERT INTO public.events (user_id, name, slug, city, event_date, start_time, status,
                              registration_url, paid_at, tracking_start, tracking_end)
   VALUES ($1, 'Turkey Trot', $2, 'Lincolnwood', DATE '2099-11-22', TIME '08:00', $3,
           'https://runsignup.com/Race/IL/Lincolnwood/TurkeyTrot',
           now(), now() - interval '1 hour', now() + interval '1 hour')
   RETURNING id`, [owner, slug, status])).rows[0].id;
const LIVE = await mkEvent(ME, 'turkey-trot', 'published');
const DRAFT = await mkEvent(ME, 'draft-trot', 'draft');
const THEIRS = await mkEvent(OTHER, 'their-trot', 'published');
for (const ev of [LIVE, DRAFT]) {
  await db.query(
    `INSERT INTO public.poi_statuses (event_id, poi_id, state, note, updated_by_name)
     VALUES ($1, 'water-1', 'low', 'cups running out', 'Pat (volunteer)')`, [ev]);
}

console.log('\nBefore: chain state is exploitable');
await asAnon();
{
  const u = await db.query(`UPDATE public.public_events SET registration_url = 'https://evil.example' WHERE id = $1`, [THEIRS]);
  ok(u.affectedRows === 1, "anon rewrites someone's published event through public_events (the bug)");
  await db.query(`INSERT INTO public.product_events (event_type, user_id, properties)
                  VALUES ('purchase_completed', $1, '{"amount_cents": 4900}')`, [OTHER]);
  ok(true, 'anon forges a purchase_completed row for another user (the bug)');
  ok((await rows(`SELECT 1 FROM public.poi_statuses WHERE event_id = $1`, [DRAFT])).length === 1,
    "anon reads a draft event's aid-station notes (the bug)");
}
await asPostgres();
await db.query(`UPDATE public.events SET registration_url = 'https://runsignup.com/x' WHERE id = $1`, [THEIRS]);
await db.exec(`DELETE FROM public.product_events`);

console.log('\nRefuses to commit on an unreviewed policy');
await db.exec(`CREATE POLICY "Prod drift" ON public.profiles FOR SELECT TO anon USING (true)`);
try {
  await db.exec(migrationSql);
  ok(false, 'migration aborts');
} catch (e) {
  ok(/Unreviewed policies in public[\s\S]*profiles\|Prod drift/.test(e.message), 'migration aborts and names the policy', e.message);
  await db.exec('ROLLBACK');
}
ok((await rows(`SELECT 1 FROM information_schema.role_table_grants
                 WHERE table_schema = 'public' AND table_name = 'public_events'
                   AND grantee = 'anon' AND privilege_type = 'UPDATE'`)).length === 1,
  'and nothing in it was applied');
await db.exec(`DROP POLICY "Prod drift" ON public.profiles`);

await db.exec(migrationSql);
// Re-pasting it in the editor must be harmless.
await db.exec(migrationSql);
ok(true, 'applies cleanly, twice');

console.log('\nGrants');
{
  const anon = await rows(
    `SELECT table_name || ':' || privilege_type AS g FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND grantee = 'anon' ORDER BY 1`);
  ok(JSON.stringify(anon.map((r) => r.g)) === JSON.stringify([
    'event_subscribers:INSERT', 'poi_statuses:SELECT', 'product_events:INSERT', 'public_events:SELECT',
  ]), 'anon table grants are exactly the public flows', anon.map((r) => r.g));
  const anonCols = await rows(
    `SELECT privilege_type, string_agg(column_name, ',' ORDER BY column_name) AS cols
       FROM information_schema.column_privileges
      WHERE table_schema = 'public' AND grantee = 'anon' AND table_name = 'tracking_sessions'
      GROUP BY 1 ORDER BY 1`);
  ok(JSON.stringify(anonCols) === JSON.stringify([
    { privilege_type: 'INSERT', cols: 'color,event_id,runner_name,session_secret' },
    { privilege_type: 'SELECT', cols: 'color,created_at,event_id,id,is_active,last_lat,last_lng,last_ping_at,runner_name,started_at' },
  ]), 'anon on tracking_sessions: insert four columns, select everything but the secret', anonCols);
  const stray = await rows(
    `SELECT table_name, grantee, privilege_type FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND grantee IN ('anon', 'authenticated')
        AND privilege_type IN ('TRUNCATE', 'TRIGGER', 'REFERENCES')`);
  ok(stray.length === 0, 'no TRUNCATE / TRIGGER / REFERENCES for anon or authenticated anywhere', stray);
  const view = await rows(
    `SELECT grantee, privilege_type FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'public_events' AND grantee IN ('anon', 'authenticated', 'PUBLIC')
      ORDER BY 1, 2`);
  ok(view.every((g) => g.privilege_type === 'SELECT') && view.length === 2, 'public_events is SELECT-only', view);

  await db.exec(`CREATE TABLE public.zz_future (id int primary key)`);
  const fut = await rows(
    `SELECT grantee, privilege_type FROM information_schema.role_table_grants
      WHERE table_schema = 'public' AND table_name = 'zz_future' AND grantee IN ('anon', 'authenticated')`);
  ok(!fut.some((g) => g.grantee === 'anon'), 'a new table starts with nothing for anon', fut);
  ok(!fut.some((g) => ['TRUNCATE', 'TRIGGER', 'REFERENCES'].includes(g.privilege_type)),
    'and no TRUNCATE / TRIGGER / REFERENCES for authenticated');
  await db.exec(`DROP TABLE public.zz_future`);
}

console.log('\nAnon: public event page');
await asAnon();
{
  const page = await rows(`SELECT * FROM public.public_events WHERE slug = 'turkey-trot'`);
  ok(page.length === 1 && page[0].registration_url && page[0].start_time === '08:00:00',
    'EventPublic.tsx select * by slug', page[0]);
  const api = await rows(
    `SELECT id, name, slug, city, event_date, routes, route_count, poi_count, logo_url, has_ended
       FROM public.public_events WHERE slug = 'turkey-trot'`);
  ok(api.length === 1, 'api/event/[slug].ts column list');
  ok((await rows(`SELECT 1 FROM public.public_events WHERE slug = 'draft-trot'`)).length === 0, 'drafts stay hidden');
  await expectError(() => db.query(`UPDATE public.public_events SET name = 'pwned' WHERE id = $1`, [THEIRS]),
    '42501', 'update through public_events refused');
  await expectError(() => db.query(`DELETE FROM public.public_events WHERE id = $1`, [THEIRS]),
    '42501', 'delete through public_events refused');
  await expectError(() => db.query(`INSERT INTO public.public_events (id, name) VALUES (gen_random_uuid(), 'x')`),
    '42501', 'insert through public_events refused');

  const st = await rows(`SELECT * FROM public.poi_statuses WHERE event_id = $1`, [LIVE]);
  ok(st.length === 1 && st[0].state === 'low', 'usePoiStatuses reads statuses on a published event');
  ok((await rows(`SELECT * FROM public.poi_statuses WHERE event_id = $1`, [DRAFT])).length === 0,
    "but not a draft's");
  await expectError(() => db.query(`UPDATE public.poi_statuses SET state = 'closed'`), '42501', 'statuses are read-only');

  ok((await rpc('event_is_published', { p_event_id: LIVE })) === true, 'event_is_published still callable (policies use it)');
  await expectError(() => rpc('event_owner_is_paid', { owner_id: ME }), '42501', 'event_owner_is_paid no longer callable');
  await expectError(() => rpc('get_event_analytics', { p_event_id: LIVE }), '42501', 'get_event_analytics no longer callable');
}

console.log('\nAnon: logEvent');
{
  await db.query(`INSERT INTO public.product_events (event_type, user_id, event_id, properties)
                  VALUES ('public_view', NULL, $1, '{"mode": "runner"}')`, [LIVE]);
  ok(true, 'public_view with user_id null');
  await db.query(`INSERT INTO public.product_events (event_type, user_id, event_id, properties)
                  VALUES ('public_share', NULL, $1, '{}')`, [LIVE]);
  ok(true, 'other public event types');
  await expectError(() => db.query(`INSERT INTO public.product_events (event_type, properties)
                                    VALUES ('purchase_completed', '{"amount_cents": 4900}')`),
  '42501', "can't forge purchase_completed");
  await expectError(() => db.query(`INSERT INTO public.product_events (event_type) VALUES ('purchase_refunded')`),
    '42501', "can't forge purchase_refunded");
  await expectError(() => db.query(`INSERT INTO public.product_events (event_type, user_id) VALUES ('public_view', $1)`, [ME]),
    '42501', "can't stamp someone's user_id");
  await expectError(() => db.query(`SELECT * FROM public.product_events`), '42501', "can't read product_events");
}

console.log('\nAnon: subscribe');
{
  await db.query(`INSERT INTO public.event_subscribers (event_id, email, source) VALUES ($1, 'fan@example.org', 'runner')`, [LIVE]);
  ok(true, 'SubscribeButton insert');
  await db.query(`INSERT INTO public.event_subscribers (event_id, email, source) VALUES ($1, 'late@example.org', 'ended')`, [LIVE]);
  ok(true, 'EventEndedView insert');
  await expectError(
    () => db.query(`INSERT INTO public.event_subscribers (event_id, email, source) VALUES ($1, 'FAN@example.org', 'runner')`, [LIVE]),
    '23505', 'a repeat still comes back 23505, which the UI treats as success');
  await expectError(
    () => db.query(`INSERT INTO public.event_subscribers (event_id, email) VALUES ($1, 'fan@example.org')`, [DRAFT]),
    '42501', "can't subscribe to a draft");
  await expectError(() => db.query(`SELECT email FROM public.event_subscribers`), '42501', "can't read the list");
}

console.log('\nAnon: live tracking');
{
  const t = await rows(
    `INSERT INTO public.tracking_sessions (event_id, runner_name, color, session_secret)
     VALUES ($1, 'Kim', '#2563eb', 'secret') RETURNING id`, [LIVE]);
  ok(t.length === 1, 'useTracking insert … select id');
  const SESSION = t[0].id;
  ok((await rows(`SELECT id, is_active FROM public.tracking_sessions WHERE id = $1`, [SESSION]))[0]?.is_active === true,
    'resume reads id, is_active');
  ok((await rows(`SELECT id, runner_name, color, last_lng, last_lat, last_ping_at FROM public.tracking_sessions
                   WHERE event_id = $1 AND is_active = true`, [LIVE])).length === 1,
  'useTrackingSubscription spectator read');
  await expectError(() => db.query(`SELECT session_secret FROM public.tracking_sessions`), '42501', 'secret unreadable');
  await expectError(
    () => db.query(`INSERT INTO public.tracking_sessions (event_id, runner_name, session_secret, last_lat, last_lng)
                    VALUES ($1, 'Fake', 's', 41.9, -87.7)`, [LIVE]),
    '42501', "can't seed a position on insert");
  await expectError(() => db.query(`UPDATE public.tracking_sessions SET last_lat = 0 WHERE id = $1`, [SESSION]),
    '42501', "can't move a runner's pin");
}

console.log('\nAnon: everything else is closed');
for (const t of ['events', 'profiles', 'email_sends', 'poi_volunteer_tokens', 'poi_status_history', 'comp_grants',
  'event_transfers', 'scout_rate_limits', 'pro_waitlist', 'stripe_webhook_events', 'crm_deals', 'crm_contacts']) {
  await expectError(() => db.query(`SELECT 1 FROM public.${t} LIMIT 1`), '42501', `${t}: no access`);
}

console.log('\nSigned-in owner');
await as(ME);
{
  ok((await rows(`SELECT slug FROM public.events ORDER BY slug`)).map((r) => r.slug).join() === 'draft-trot,turkey-trot',
    'reads own events');
  ok((await db.query(`UPDATE public.events SET name = 'Turkey Trot 5K' WHERE id = $1`, [LIVE])).affectedRows === 1,
    'updates own event');
  const NEW = (await rows(`INSERT INTO public.events (user_id, name, slug, status) VALUES (auth.uid(), 'Jingle', 'jingle', 'draft') RETURNING id`))[0].id;
  ok((await db.query(`DELETE FROM public.events WHERE id = $1`, [NEW])).affectedRows === 1, 'creates and deletes own event');
  await expectError(() => db.query(`UPDATE public.public_events SET name = 'x' WHERE id = $1`, [THEIRS]),
    '42501', "can't write through public_events either");

  ok((await rows(`SELECT * FROM public.profiles WHERE user_id = auth.uid()`)).length === 1, 'reads own profile (select *)');
  ok((await db.query(`UPDATE public.profiles SET display_name = 'Dana' WHERE user_id = auth.uid()`)).affectedRows === 1,
    'updates display_name');
  await expectError(() => db.query(`DELETE FROM public.profiles WHERE user_id = auth.uid()`), '42501', "can't delete profile");

  await db.query(`INSERT INTO public.product_events (event_type, user_id, event_id) VALUES ('event_published', auth.uid(), $1)`, [LIVE]);
  ok(true, 'logEvent with own user_id');
  await expectError(() => db.query(`INSERT INTO public.product_events (event_type, user_id) VALUES ('paywall_hit', $1)`, [OTHER]),
    '42501', "logEvent with someone else's user_id refused");
  ok((await rows(`SELECT event_id, created_at FROM public.product_events WHERE event_type = 'event_published'`)).length === 1,
    'Dashboard reads own product_events');

  const subs = await rows(`SELECT id, email, source, created_at, unsubscribed_at FROM public.event_subscribers WHERE event_id = $1`, [LIVE]);
  ok(subs.length === 2, 'Ops Center reads subscriber list');
  ok((await db.query(`UPDATE public.event_subscribers SET unsubscribed_at = now() WHERE id = $1`, [subs[0].id])).affectedRows === 1,
    'Ops Center unsubscribes someone');
  await expectError(() => db.query(`DELETE FROM public.event_subscribers`), '42501', "can't delete subscribers");

  await db.query(
    `INSERT INTO public.poi_statuses (event_id, poi_id, state, updated_by_name) VALUES ($1, 'water-1', 'closed', 'Director')
     ON CONFLICT (event_id, poi_id) DO UPDATE SET state = EXCLUDED.state`, [DRAFT]);
  ok((await rows(`SELECT state FROM public.poi_statuses WHERE event_id = $1`, [DRAFT]))[0]?.state === 'closed',
    'Ops Center upserts and reads statuses on own draft');
  await db.query(`INSERT INTO public.poi_status_history (event_id, poi_id, state, updated_by_name) VALUES ($1, 'water-1', 'closed', 'Director')`, [DRAFT]);
  ok((await rows(`SELECT id, poi_id, state FROM public.poi_status_history WHERE event_id = $1`, [DRAFT])).length === 1,
    'status history insert + read');

  await db.query(`INSERT INTO public.poi_volunteer_tokens (token, event_id, purpose, created_by) VALUES ('tok_status', $1, 'status', auth.uid())`, [LIVE]);
  ok((await db.query(`UPDATE public.poi_volunteer_tokens SET revoked_at = now() WHERE token = 'tok_status'`)).affectedRows === 1,
    'Status/Scout link dialogs insert and revoke tokens');
  ok((await rows(`SELECT token, created_at, revoked_at FROM public.poi_volunteer_tokens`)).length === 1, 'and list them');

  await asPostgres();
  await db.query(`INSERT INTO public.email_sends (event_id, sent_by_user_id, subject, body_preview) VALUES ($1, $2, 'Packet pickup', 'Hi')`, [LIVE, ME]);
  await as(ME);
  ok((await rows(`SELECT id, subject, body_preview, audiences, recipient_count, sent_at FROM public.email_sends`)).length === 1,
    'SendUpdateDialog reads send history');
  await expectError(() => db.query(`INSERT INTO public.email_sends (event_id, sent_by_user_id, subject, body_preview) VALUES ($1, auth.uid(), 's', 'b')`, [LIVE]),
    '42501', "can't write send history (send-event-update does)");

  await db.query(`INSERT INTO public.pro_waitlist (email, event_id, trigger) VALUES ('director@example.org', $1, 'routes')`, [LIVE]);
  ok(true, 'ProWaitlistCapture insert');
  await expectError(() => db.query(`SELECT * FROM public.pro_waitlist`), '42501', "can't read the waitlist");

  const a = await rpc('get_event_analytics', { p_event_id: LIVE });
  ok(a && Number(a.subscribers_total) === 1, 'get_event_analytics for own event', a);
  ok((await rows(`SELECT 1 FROM public.public_events WHERE slug = 'their-trot'`)).length === 1, 'reads public_events');
  ok((await rows(`INSERT INTO public.tracking_sessions (event_id, runner_name, color, session_secret)
                  VALUES ($1, 'Dana', '#000', 's2') RETURNING id`, [LIVE])).length === 1,
  'can start tracking while signed in');
  await db.query(`INSERT INTO public.event_subscribers (event_id, email, source) VALUES ($1, 'me@example.org', 'runner')`, [THEIRS]);
  ok(true, "can subscribe to someone else's published event");
  await expectError(() => db.query(`SELECT 1 FROM public.scout_rate_limits`), '42501', 'scout_rate_limits is service-role only');
}

console.log('\nAdmin');
await as(ADMIN);
{
  const g = await rows(`INSERT INTO public.comp_grants (user_id, granted_by, grant_reason) VALUES ($1, auth.uid(), 'friend of the race') RETURNING id`, [OTHER]);
  ok(g.length === 1, 'CompGrantDialog insert');
  ok((await db.query(`UPDATE public.comp_grants SET revoked_at = now(), revoked_by = auth.uid(), revoke_reason = 'ended' WHERE id = $1`, [g[0].id])).affectedRows === 1,
    'CompRevokeDialog update');
  ok((await rows(`SELECT * FROM public.comp_grants`)).length === 1, 'AdminComps select');
  ok(Array.isArray(await rows(`SELECT * FROM public.event_transfers`)), 'AdminTransfers select');
  await expectError(() => db.query(`DELETE FROM public.comp_grants`), '42501', "comp grants can't be deleted, only revoked");
}

done();
