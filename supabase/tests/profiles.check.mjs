// Profile column lockdown (20261013120000): a signed-in user can still
// write their own name, organization, avatar and first-touch
// attribution, and nothing else — not billing, promo or role columns,
// and not anyone else's row. Fixtures only; touches no real database.
//
//   npm run test:db
import { createDb, testKit } from './pglite.mjs';

// createDb throws if any migration fails to replay.
const { db } = await createDb();

const { ok, as, asPostgres, expectError, mkUser, done } = testKit(db);

await asPostgres();
const ME = await mkUser('director@example.org', 'email');
const OTHER = await mkUser('victim@example.org', 'email');
await db.query(`UPDATE public.profiles SET stripe_customer_id = 'cus_victim' WHERE user_id = $1`, [OTHER]);

console.log('\nWhat a user can still write');
await as(ME);
{
  const r = await db.query(
    `UPDATE public.profiles SET display_name = 'Dana', organization_name = 'Glenview Parks', avatar_url = 'https://x/a.png'
      WHERE user_id = auth.uid()`);
  ok(r.affectedRows === 1, 'name, organization, avatar');
  // Exactly the update src/lib/attribution.ts makes.
  const a = await db.query(
    `UPDATE public.profiles
        SET first_referrer = 'https://google.com', first_landing_page = '/', utm_source = 's', utm_medium = 'm',
            utm_campaign = 'c', utm_term = 't', utm_content = 'x', attribution_captured_at = now()
      WHERE user_id = auth.uid() AND attribution_captured_at IS NULL`);
  ok(a.affectedRows === 1, 'first-touch attribution claim');
  const read = await db.query(`SELECT * FROM public.profiles WHERE user_id = auth.uid()`);
  ok(read.rows.length === 1 && read.rows[0].display_name === 'Dana', 'can still read the whole row (select *)');
}

console.log('\nWhat a user can no longer write');
for (const [col, value] of [
  ['stripe_customer_id', "'cus_victim'"],
  ['active_promo_code', "'FRIENDS_FAMILY_100'"],
  ['active_promo_percent_off', '100'],
  ['active_promo_expires_at', "now() + interval '1 year'"],
  ['active_promotion_code_id', "'promo_x'"],
  ['plan', "'pro'"],
  ['is_paid', 'true'],
  ['stripe_subscription_id', "'sub_x'"],
  ['current_period_end', "now() + interval '1 year'"],
  ['is_admin', 'true'],
  ['is_sales', 'true'],
  ['user_id', `'${OTHER}'`],
]) {
  await expectError(
    () => db.query(`UPDATE public.profiles SET ${col} = ${value} WHERE user_id = auth.uid()`),
    '42501',
    `${col} refused`,
  );
}
await expectError(
  () => db.query(`INSERT INTO public.profiles (user_id, display_name) VALUES (auth.uid(), 'dupe')`),
  '42501',
  'insert refused',
);

console.log("\nSomeone else's row");
{
  const r = await db.query(`UPDATE public.profiles SET display_name = 'pwned' WHERE user_id = $1`, [OTHER]);
  ok(r.affectedRows === 0, "allowed columns still only on your own row (RLS)");
}

console.log('\nServer-side writers are unaffected');
await asPostgres();
{
  await db.exec(`SET ROLE service_role`);
  const r = await db.query(
    `UPDATE public.profiles SET stripe_customer_id = 'cus_me', active_promo_code = 'C1', active_promotion_code_id = 'promo_1'
      WHERE user_id = $1`, [ME]);
  ok(r.affectedRows === 1, 'service role (edge functions) still writes billing columns');
  await asPostgres();
  const n = await mkUser('new@hereday.io', 'google');
  const p = await db.query(`SELECT is_sales FROM public.profiles WHERE user_id = $1`, [n]);
  ok(p.rows[0]?.is_sales === true, 'signup triggers still create the profile (definer)');
}

done();
