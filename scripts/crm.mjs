#!/usr/bin/env node
/**
 * The Hereday CRM from the command line — what the /outreach-* skills
 * use instead of outreach/leads.csv. Signs in as you (Google, or an
 * emailed code) and goes through the same crm_* RPCs as /admin/crm, so
 * claims, masking and do-not-contact all apply.
 *
 *   node scripts/crm.mjs login              Google sign-in in your browser
 *   node scripts/crm.mjs login --code       emailed 6-digit code instead
 *   node scripts/crm.mjs help               everything else
 *
 * Run `login` in your own terminal (it waits for you). Every other
 * command is safe for a skill to run. Add --json for machine output.
 */

import { createServer } from 'node:http';
import { exec } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { createInterface } from 'node:readline/promises';
import { join } from 'node:path';
import { CLI, CrmCliError, OUTREACH, SITE_URL, connect, makeClient } from './lib/crm-client.mjs';

const LOGIN_PORT = 5733;
const REDIRECT = `http://localhost:${LOGIN_PORT}/callback`;

/* ---------- args ---------- */

function parseArgs(argv) {
  const positional = [];
  const flags = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) {
      positional.push(a);
      continue;
    }
    const [key, inline] = a.slice(2).split(/=(.*)/s);
    if (inline !== undefined) flags[key] = inline;
    else if (argv[i + 1] !== undefined && !argv[i + 1].startsWith('--')) flags[key] = argv[++i];
    else flags[key] = true;
  }
  return { positional, flags };
}

/** --body "text" or --body-file path. Files avoid PowerShell 5.1 mangling quotes. */
const textArg = (flags, name) => {
  if (typeof flags[`${name}-file`] === 'string') return readFileSync(flags[`${name}-file`], 'utf8').trim();
  return typeof flags[name] === 'string' ? flags[name] : null;
};

const need = (value, usage) => {
  if (!value) throw new CrmCliError(`Usage: ${CLI} ${usage}`);
  return value;
};

/* ---------- dates ---------- */

const todayChicago = () =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());

/** Noon Chicago on a YYYY-MM-DD, as an ISO instant (for --date). */
const noonChicago = (day) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new CrmCliError(`--date must be YYYY-MM-DD, got "${day}".`);
  // 17:00Z is noon CDT / 11:00 CST — midday either way, never the wrong day.
  return `${day}T17:00:00Z`;
};

/* ---------- output ---------- */

const pad = (s, n) => (String(s ?? '').length > n ? `${String(s).slice(0, n - 1)}…` : String(s ?? '').padEnd(n));

function printDeals(deals) {
  if (!deals.length) {
    console.log('(none)');
    return;
  }
  console.log(`${pad('SLUG', 34)} ${pad('STAGE', 12)} ${pad('OWNER', 10)} ${pad('NEXT', 10)} RACE`);
  for (const d of deals) {
    console.log(
      `${pad(d.slug, 34)} ${pad(d.effective_stage + (d.is_dnc ? '!DNC' : ''), 12)} ${pad(d.is_mine ? 'you' : d.owner_name ?? '—', 10)} ` +
        `${pad(d.next_step_at ?? '', 10)} ${d.race_name}${d.town ? ` (${d.town})` : ''}`,
    );
  }
}

const out = (flags, data, human) => (flags.json ? console.log(JSON.stringify(data, null, 2)) : human(data));

/* ---------- lookups ---------- */

async function listDeals(client, includeClosed = false) {
  return client.call('crm_list_deals', { p_include_closed: includeClosed });
}

async function dealBySlug(client, slug) {
  const detail = await client.call('crm_get_deal', { p_slug: slug });
  return detail;
}

const loose = (s) => String(s ?? '').toLowerCase().replace(/[^a-z0-9]/g, '');

/* ---------- login ---------- */

const openBrowser = (url) => {
  const cmd =
    process.platform === 'win32' ? `start "" "${url}"` : process.platform === 'darwin' ? `open "${url}"` : `xdg-open "${url}"`;
  exec(cmd, () => {});
};

async function waitForCode() {
  return new Promise((resolve, reject) => {
    let timeout;
    const done = (fn, arg) => {
      clearTimeout(timeout);
      server.close();
      fn(arg);
    };
    const server = createServer((req, res) => {
      const q = new URL(req.url, REDIRECT).searchParams;
      const code = q.get('code');
      const err = q.get('error_description') || q.get('error');
      if (!code && !err) {
        res.writeHead(204);
        res.end();
        return;
      }
      res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
      res.end(`<!doctype html><meta charset="utf-8"><body style="font:16px/1.6 system-ui,sans-serif;max-width:30rem;margin:22vh auto;text-align:center">
        <h1 style="font-size:20px">${code ? 'Signed in to the Hereday CRM' : 'Sign-in failed'}</h1>
        <p style="color:#6b7280">${code ? 'Close this tab and go back to the terminal.' : String(err).replace(/</g, '&lt;')}</p>`);
      code ? done(resolve, code) : done(reject, new CrmCliError(`Sign-in failed: ${err}`));
    });
    server.on('error', (e) =>
      done(reject, e.code === 'EADDRINUSE' ? new CrmCliError(`Port ${LOGIN_PORT} is in use. Close whatever is on it and retry.`) : e),
    );
    server.listen(LOGIN_PORT, '127.0.0.1');
    timeout = setTimeout(
      () =>
        done(
          reject,
          new CrmCliError(
            `Timed out. If the browser ended up on ${SITE_URL} instead of a "Signed in" page, Supabase isn't allowed to ` +
              `redirect to the CLI yet: add ${`http://localhost:${LOGIN_PORT}/**`} under Authentication → URL Configuration ` +
              `→ Redirect URLs, then run login again.`,
          ),
        ),
      300_000,
    );
  });
}

async function login(flags) {
  const supabase = makeClient();

  if (flags.code) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    try {
      const email = (await rl.question('Your hereday.io email: ')).trim();
      const { error } = await supabase.auth.signInWithOtp({ email, options: { shouldCreateUser: false } });
      if (error) throw new CrmCliError(error.message);
      const token = (await rl.question('The 6-digit code from the email: ')).trim();
      const { error: verifyErr } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
      if (verifyErr) throw new CrmCliError(verifyErr.message);
    } finally {
      rl.close();
    }
  } else {
    const { data, error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: REDIRECT, skipBrowserRedirect: true, queryParams: { prompt: 'select_account' } },
    });
    if (error) throw new CrmCliError(error.message);
    console.log('Opening your browser to sign in with Google. If it does not open, paste this:\n');
    console.log(`${data.url}\n`);
    console.log(`Waiting on ${REDIRECT} …`);
    openBrowser(data.url);
    const code = await waitForCode();
    const { error: exErr } = await supabase.auth.exchangeCodeForSession(code);
    if (exErr) throw new CrmCliError(exErr.message);
  }

  const { data: role } = await supabase.rpc('staff_role');
  const { data: userData } = await supabase.auth.getUser();
  if (!role) {
    await supabase.auth.signOut({ scope: 'local' });
    throw new CrmCliError(`${userData.user?.email ?? 'That account'} isn't staff, so it has no CRM access. Signed out.`);
  }
  console.log(`\nSigned in as ${userData.user?.email} (${role}). The session is saved in outreach/.crm-session.json.`);
}

async function logout() {
  const supabase = makeClient();
  // scope 'local' revokes this session only — not your browser sign-ins.
  await supabase.auth.signOut({ scope: 'local' });
  console.log('Signed out of the CRM CLI.');
}

/* ---------- commands ---------- */

const commands = {
  async whoami(_, flags) {
    const c = await connect();
    const role = await c.call('staff_role');
    out(flags, { email: c.user.email, role, expires_at: new Date(c.session.expires_at * 1000).toISOString() }, (d) =>
      console.log(`${d.email} (${d.role})`),
    );
  },

  async list({ positional }, flags) {
    const c = await connect();
    let deals = await listDeals(c, !!flags.closed);
    if (flags.mine) deals = deals.filter((d) => d.is_mine);
    if (flags.unclaimed) deals = deals.filter((d) => d.claim_open && !d.is_dnc && d.stage !== 'closed');
    if (flags.due) deals = deals.filter((d) => d.is_due);
    if (typeof flags.stage === 'string') deals = deals.filter((d) => d.effective_stage === flags.stage || d.stage === flags.stage);
    out(flags, deals, printDeals);
  },

  async find({ positional }, flags) {
    const q = loose(need(positional.join(' '), 'find <race, town, org or person>'));
    const c = await connect();
    const deals = (await listDeals(c, true)).filter((d) =>
      [d.slug, d.race_name, d.town, d.account_name, d.contact_name, d.contact_email].some((v) => loose(v).includes(q)),
    );
    out(flags, deals, printDeals);
  },

  async get({ positional }, flags) {
    const slug = need(positional[0], 'get <slug>');
    const c = await connect();
    const detail = await dealBySlug(c, slug);
    out(flags, detail, (d) => {
      const x = d.deal;
      console.log(`${x.race_name} — ${x.slug}`);
      console.log(`  stage      ${x.effective_stage}${x.outcome ? ` (${x.outcome})` : ''}${x.is_dnc ? '  DO NOT CONTACT' : ''}`);
      console.log(`  owner      ${x.is_mine ? 'you' : x.owner_name ?? 'unclaimed'}${x.claim_expires_at ? `, claim ends ${x.claim_expires_at.slice(0, 10)}` : ''}`);
      console.log(`  race       ${[x.race_date, x.town, x.tier && `tier ${x.tier}`].filter(Boolean).join(' · ')}`);
      if (d.allowed.view_details) {
        const ct = d.contact ?? {};
        console.log(`  contact    ${[ct.full_name, ct.email, ct.phone].filter(Boolean).join(' · ') || '—'}`);
        console.log(`  next       ${x.next_step ?? '—'}${x.next_step_at ? ` (${x.next_step_at})` : ''}`);
      } else {
        console.log('  contact    (claim it to see)');
      }
      console.log(`  hereday    ${x.hereday_link ?? '—'}  map ${x.map_built ? 'built' : 'not built'}${x.signed_up_at ? ', director signed up' : ''}${x.paid_at ? ', PAID' : ''}`);
      if (d.timeline.length) {
        console.log('  timeline');
        for (const t of d.timeline.slice(0, 12)) {
          console.log(`    ${t.occurred_at.slice(0, 10)}  ${t.type}${t.quote ? `  "${t.quote}"` : t.body ? `  ${t.body.split('\n')[0].slice(0, 80)}` : ''}`);
        }
      }
    });
  },

  /** The next N leads to research: yours still at New first, then unclaimed by priority. */
  async next({ positional }, flags) {
    const n = Number(positional[0] ?? 5);
    if (!Number.isInteger(n) || n < 1) throw new CrmCliError(`Usage: ${CLI} next <count> [--claim]`);
    const c = await connect();
    const deals = await listDeals(c);
    const open = (d) => d.stage === 'new' && !d.is_dnc;
    const picked = [
      ...deals.filter((d) => open(d) && d.is_mine),
      ...deals.filter((d) => open(d) && !d.is_mine && d.claim_open),
    ].slice(0, n);
    const result = [];
    for (const d of picked) {
      if (!d.is_mine) {
        if (!flags.claim) {
          result.push({ ...d, claimed: false });
          continue;
        }
        await c.call('crm_claim_deal', { p_deal_id: d.id });
      }
      result.push({ ...(await dealBySlug(c, d.slug)).deal, claimed: true });
    }
    out(flags, result, (rows) => {
      printDeals(rows);
      if (!flags.claim && rows.some((r) => !r.claimed)) console.log(`\nAdd --claim to claim the unowned ones.`);
    });
  },

  /**
   * Applies outreach/research/<slug>.md frontmatter: contact (with
   * sources), race and map details, and the stage (researched or
   * no_contact). Only the keys present are written.
   */
  async research({ positional }, flags) {
    const slug = need(positional[0], 'research <slug> [--from outreach/research/<slug>.md]');
    const file = typeof flags.from === 'string' ? flags.from : join(OUTREACH, 'research', `${slug}.md`);
    if (!existsSync(file)) throw new CrmCliError(`No research file at ${file}.`);
    const meta = frontmatter(readFileSync(file, 'utf8'));
    if (!Object.keys(meta).length) throw new CrmCliError(`${file} has no frontmatter (--- key: value --- at the top).`);

    const c = await connect();
    const { deal } = await dealBySlug(c, slug);
    if (!deal.can_view_details) throw new CrmCliError(`${slug} is owned by ${deal.owner_name}. Claim it first.`);

    // Empty values and NOT_FOUND-style placeholders are skipped, never
    // written: research adds what it found and doesn't erase what's there.
    // Clear a field in /admin/crm if it's genuinely wrong.
    const value = (k) => {
      const v = String(meta[k] ?? '').trim();
      return /^(NOT_FOUND|NONE|N\/?A|-|PENDING|)$/i.test(v) ? null : v;
    };
    const take = (pairs) =>
      Object.fromEntries(pairs.map(([field, key]) => [field, value(key)]).filter(([, v]) => v !== null));

    const contact = take([
      ['full_name', 'director'], ['role_title', 'role'],
      ['email', 'email'], ['email_source', 'email_source'],
      ['phone', 'phone'], ['phone_source', 'phone_source'],
    ]);
    const patch = {
      ...take([
        ['race_date', 'race_date'], ['town', 'town'], ['channel', 'channel'],
        ['course_map_url', 'course_map_url'], ['map_type', 'map_type'],
        ['account_name', 'org_name'], ['org_type', 'org_type'], ['notes', 'notes'],
      ]),
      ...(value('date_verified') !== null ? { date_verified: /^(y|yes|true)$/i.test(value('date_verified')) } : {}),
      ...(value('fit_flags') !== null
        ? { fit_flags: value('fit_flags').split(',').map((x) => x.trim()).filter(Boolean) }
        : {}),
    };
    const stage = value('stage') ?? 'researched';
    if (!['researched', 'no_contact'].includes(stage)) throw new CrmCliError(`stage in ${file} must be researched or no_contact.`);

    if (Object.keys(contact).length) await c.call('crm_upsert_contact', { p_deal_id: deal.id, p_contact: contact });
    if (Object.keys(patch).length) await c.call('crm_update_deal', { p_deal_id: deal.id, p_patch: patch });
    if (['new', 'no_contact', 'researched'].includes(deal.stage) && deal.stage !== stage) {
      await c.call('crm_set_stage', { p_deal_id: deal.id, p_stage: stage, p_note: `From ${file.replace(/\\/g, '/').split('/outreach/').pop()}` });
    }
    await c.call('crm_log_activity', {
      p_deal_id: deal.id,
      p_type: 'research',
      p_body: `Research notes: outreach/research/${slug}.md`,
      p_meta: { dedupe_key: `research:${todayChicago()}` },
    });
    const after = await dealBySlug(c, slug);
    out(flags, after, (d) => console.log(`${slug}: ${d.deal.stage}. Contact ${d.contact?.email ?? 'no email'}${d.contact?.phone ? `, ${d.contact.phone}` : ''}.`));
  },

  /** A new race, owned by you. Refused (with who has it) if it's already in the CRM. */
  async add(_, flags) {
    const race = need(
      typeof flags.race === 'string' && flags.race,
      'add --race "Name" [--date YYYY-MM-DD] [--town T] [--tier 1-3] [--org "Org"] [--org-type t] [--slug s]',
    );
    const c = await connect();
    const res = await c.call('crm_create_deal', {
      p_deal: {
        race_name: race,
        ...(typeof flags.slug === 'string' ? { slug: flags.slug } : {}),
        ...(typeof flags.date === 'string' ? { race_date: flags.date } : {}),
        ...(typeof flags.town === 'string' ? { town: flags.town } : {}),
        ...(typeof flags.tier === 'string' ? { tier: Number(flags.tier) } : {}),
        ...(typeof flags.org === 'string' ? { account_name: flags.org } : {}),
        ...(typeof flags['org-type'] === 'string' ? { org_type: flags['org-type'] } : {}),
      },
    });
    out(flags, res, (d) => console.log(`Added ${d.deal.slug} (${d.deal.race_name}). It's yours.`));
  },

  async stage({ positional }, flags) {
    const [slug, stage] = positional;
    need(slug && stage, 'stage <slug> <stage> [--outcome x] [--note "…"|--note-file f] [--date YYYY-MM-DD]');
    const c = await connect();
    const { deal } = await dealBySlug(c, slug);
    const res = await c.call('crm_set_stage', {
      p_deal_id: deal.id,
      p_stage: stage,
      p_outcome: typeof flags.outcome === 'string' ? flags.outcome : null,
      p_note: textArg(flags, 'note'),
      p_occurred_on: typeof flags.date === 'string' ? flags.date : null,
    });
    out(flags, res, (d) => console.log(`${slug}: ${d.stage}${d.outcome ? ` (${d.outcome})` : ''}.`));
  },

  async log({ positional }, flags) {
    const [slug, type] = positional;
    need(slug && type, 'log <slug> <type> [--body "…"|--body-file f] [--quote "…"|--quote-file f] [--date YYYY-MM-DD]');
    const c = await connect();
    const { deal } = await dealBySlug(c, slug);
    const res = await c.call('crm_log_activity', {
      p_deal_id: deal.id,
      p_type: type,
      p_body: textArg(flags, 'body'),
      p_quote: textArg(flags, 'quote'),
      p_occurred_at: typeof flags.date === 'string' ? noonChicago(flags.date) : null,
      p_meta: typeof flags.dedupe === 'string' ? { dedupe_key: flags.dedupe } : {},
    });
    out(flags, res, (d) =>
      console.log(
        d.duplicate
          ? `${slug}: already logged (${flags.dedupe}).`
          : `${slug}: ${type} logged. Now ${d.deal.stage}${d.deal.next_step_at ? `, next step ${d.deal.next_step_at}` : ''}.`,
      ),
    );
  },

  async link({ positional }, flags) {
    const [slug, ref] = positional;
    need(slug && ref, 'link <slug> <hereday link, slug or id>');
    const c = await connect();
    const { deal } = await dealBySlug(c, slug);
    const res = await c.call('crm_update_deal', { p_deal_id: deal.id, p_patch: { hereday_link: ref } });
    out(flags, res, (d) =>
      console.log(
        d.event_link === 'linked' || d.event_link === 'already_linked'
          ? `${slug}: map linked. It shows as built${d.deal.map_published ? ' and published' : ''}.`
          : d.event_link === 'not_found'
            ? `${slug}: link saved, but no Hereday event matches it yet. Is the map published?`
            : `${slug}: link saved (${d.event_link}).`,
      ),
    );
  },

  async dnc({ positional }, flags) {
    const slug = need(positional[0], 'dnc <slug> --reason "what they said" [--account]');
    const reason = need(textArg(flags, 'reason'), 'dnc <slug> --reason "what they said" [--account]');
    const c = await connect();
    const { deal } = await dealBySlug(c, slug);
    const res = await c.call('crm_mark_dnc', { p_deal_id: deal.id, p_scope: flags.account ? 'account' : 'contact', p_reason: reason });
    out(flags, res, (d) => {
      console.log(`Do not contact recorded. ${d.closed_deal_ids.length} open deal(s) closed.`);
      if (d.draft_ids.length) console.log(`Delete these Gmail drafts: ${d.draft_ids.join(', ')}`);
    });
  },

  /** What's due: first follow-ups, deals to close after a silent follow-up, and anything else scheduled. */
  async due(_, flags) {
    const c = await connect();
    const deals = (await listDeals(c)).filter((d) => d.is_due && (flags.all || d.is_mine));
    const groups = {
      follow_up: deals.filter((d) => d.stage === 'sent'),
      close_no_response: deals.filter((d) => d.stage === 'followed_up'),
      other: deals.filter((d) => !['sent', 'followed_up'].includes(d.stage)),
    };
    out(flags, groups, (g) => {
      console.log(`Follow up once (call if there's a phone): ${g.follow_up.length}`);
      printDeals(g.follow_up);
      console.log(`\nFollowed up, still silent. Close as no_response: ${g.close_no_response.length}`);
      printDeals(g.close_no_response);
      if (g.other.length) {
        console.log(`\nOther next steps due: ${g.other.length}`);
        printDeals(g.other);
      }
    });
  },

  async funnel(_, flags) {
    const c = await connect();
    const deals = await listDeals(c, true);
    const stats = {
      deals: deals.length,
      contacted: deals.filter((d) => d.sent_at).length,
      // Replied, objected, or became a customer (which needs them to have answered).
      replied: deals.filter(
        (d) => d.stage === 'replied' || d.objection || ['signed_up', 'published', 'paid'].includes(d.effective_stage),
      ).length,
      signed_up: deals.filter((d) => d.signed_up_at).length,
      published: deals.filter((d) => ['published', 'paid'].includes(d.effective_stage)).length,
      paid: deals.filter((d) => d.paid_at).length,
      closed_no_response: deals.filter((d) => d.outcome === 'no_response').length,
      by_stage: Object.fromEntries(
        [...new Set(deals.map((d) => d.effective_stage))].map((s) => [s, deals.filter((d) => d.effective_stage === s).length]),
      ),
    };
    out(flags, stats, (s) => {
      for (const [k, v] of Object.entries(s)) if (k !== 'by_stage') console.log(`${pad(k, 20)} ${v}`);
      console.log(`${pad('by stage', 20)} ${Object.entries(s.by_stage).map(([k, v]) => `${k} ${v}`).join(', ')}`);
    });
  },

  async objections(_, flags) {
    const c = await connect();
    const rows = await c.call('crm_list_objections');
    out(flags, rows, (r) => {
      if (!r.length) return console.log('(none logged yet)');
      for (const o of r) console.log(`${o.occurred_at.slice(0, 10)}  ${pad(o.race_name, 32)} "${o.quote}"`);
    });
  },

  async 'set-draft'({ positional }, flags) {
    const [slug, draftId] = positional;
    need(slug && draftId, 'set-draft <slug> <gmail draft id> [--thread id] [--mailbox address]');
    const c = await connect();
    const { deal } = await dealBySlug(c, slug);
    await c.call('crm_update_deal', {
      p_deal_id: deal.id,
      p_patch: {
        gmail_draft_id: draftId,
        ...(typeof flags.thread === 'string' ? { gmail_thread_id: flags.thread } : {}),
        ...(typeof flags.mailbox === 'string' ? { gmail_draft_mailbox: flags.mailbox } : {}),
      },
    });
    console.log(`${slug}: draft ${draftId} recorded.`);
  },

  /** Full backup as CSV (admin). Default: outreach/backups/crm-YYYY-MM-DD.csv */
  async export({ positional }) {
    const c = await connect();
    const rows = await c.call('crm_export');
    const cols = [
      'slug', 'race_name', 'race_date', 'date_verified', 'town', 'tier', 'stage', 'effective_stage', 'outcome',
      'owner_name', 'claimed_at', 'account_name', 'org_type', 'org_description', 'contact_name', 'contact_role',
      'contact_email', 'email_source', 'contact_phone', 'phone_source', 'channel', 'course_map_url', 'map_type',
      'hereday_link', 'gmail_draft_id', 'sent_at', 'followed_up_at', 'next_step', 'next_step_at', 'objection',
      'fit_flags', 'is_dnc', 'dnc_reason', 'map_built', 'signed_up_at', 'paid_at', 'notes',
    ];
    const cell = (v) => {
      const s = v === null || v === undefined ? '' : Array.isArray(v) ? v.join('|') : String(v);
      return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const csv = [cols.join(','), ...rows.map((r) => cols.map((k) => cell(r[k])).join(','))].join('\n') + '\n';
    const dir = join(OUTREACH, 'backups');
    mkdirSync(dir, { recursive: true });
    const path = positional[0] ?? join(dir, `crm-${todayChicago()}.csv`);
    writeFileSync(path, csv, 'utf8');
    console.log(`${rows.length} deals written to ${path}`);
  },

  help() {
    console.log(`Hereday CRM

  ${CLI} login [--code]           sign in (Google in the browser, or an emailed code)
  ${CLI} logout | whoami

  ${CLI} list [--mine] [--due] [--unclaimed] [--stage s] [--closed]
  ${CLI} find <text>                race, town, organization or person
  ${CLI} get <slug>
  ${CLI} next <n> [--claim]         next leads to research, claimed for you
  ${CLI} add --race "Name" [--date d] [--town t] [--tier n] [--org o] [--org-type t]
  ${CLI} research <slug> [--from file]   apply outreach/research/<slug>.md frontmatter
  ${CLI} stage <slug> <stage> [--outcome x] [--note "…"] [--date YYYY-MM-DD]
  ${CLI} log <slug> <type> [--body "…"] [--quote "…"] [--date YYYY-MM-DD]
        types: note email_sent followup_sent call voicemail form_submitted reply
               objection research handoff_requested backlink_asked backlink_live
  ${CLI} link <slug> <hereday link>
  ${CLI} dnc <slug> --reason "…" [--account]
  ${CLI} due [--all]                follow-ups due, and silent ones to close
  ${CLI} funnel | objections
  ${CLI} set-draft <slug> <draft id> [--thread id] [--mailbox address]
  ${CLI} export [path]              CSV backup (admin)

Long text: use --body-file / --quote-file / --note-file / --reason-file.
Add --json to any read for machine output.`);
  },
};

/** `---\\nkey: value\\n---` at the top of a file. */
function frontmatter(text) {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
  if (!m) return {};
  const meta = {};
  for (const line of m[1].split(/\r?\n/)) {
    const at = line.indexOf(':');
    if (at > 0) meta[line.slice(0, at).trim()] = line.slice(at + 1).trim();
  }
  return meta;
}

/* ---------- main ---------- */

const [cmd = 'help', ...rest] = process.argv.slice(2);
const args = parseArgs(rest);

try {
  if (cmd === 'login') await login(args.flags);
  else if (cmd === 'logout') await logout();
  else if (commands[cmd]) await commands[cmd](args, args.flags);
  else {
    commands.help();
    process.exitCode = 1;
  }
} catch (e) {
  const code = e.code ? ` [${e.code}]` : '';
  console.error(`error${code}: ${e.message}`);
  process.exitCode = 1;
}
