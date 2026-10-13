/**
 * The CRM from Node: a Supabase client signed in as a real staff user,
 * for scripts/crm.mjs and the outreach scripts. It calls the same crm_*
 * RPCs the admin UI does, so every rule (claims, masking, do-not-contact)
 * applies here too. There is no service-role key anywhere in this path.
 *
 * The session lives in outreach/.crm-session.json (outreach/ is
 * gitignored). It's a normal Supabase session: the access token expires
 * hourly and is refreshed from the refresh token on the next command.
 * `node scripts/crm.mjs logout` revokes it.
 */

import dns from 'node:dns';
import { existsSync, mkdirSync, openSync, closeSync, readFileSync, renameSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';

// Kevin's network times out on IPv6 for Google and Supabase from Node.
dns.setDefaultResultOrder('ipv4first');

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const OUTREACH = join(ROOT, 'outreach');
const SESSION_FILE = join(OUTREACH, '.crm-session.json');
const LOCK_FILE = join(OUTREACH, '.crm-session.lock');
const STORAGE_KEY = 'hereday-crm-cli';
export const SITE_URL = 'https://hereday.io';
export const CLI = 'node scripts/crm.mjs';

/* ---------- config ---------- */

function config() {
  const envFile = join(ROOT, '.env');
  if (existsSync(envFile)) process.loadEnvFile(envFile);
  const url = process.env.VITE_SUPABASE_URL;
  const key = process.env.VITE_SUPABASE_PUBLISHABLE_KEY;
  if (!url || !key) {
    throw new CrmCliError(`No VITE_SUPABASE_URL / VITE_SUPABASE_PUBLISHABLE_KEY in ${envFile}.`);
  }
  return { url, key };
}

export class CrmCliError extends Error {
  constructor(message, code = null) {
    super(message);
    this.code = code;
  }
}

/* ---------- session storage ---------- */

const readStore = () => {
  try {
    return JSON.parse(readFileSync(SESSION_FILE, 'utf8'));
  } catch {
    return {};
  }
};

// Write to a temp file and rename, so a crash mid-write can't leave a
// half-written session (and a refresh token rotated away from under us).
const writeStore = (store) => {
  mkdirSync(OUTREACH, { recursive: true });
  const tmp = `${SESSION_FILE}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(store, null, 2), { encoding: 'utf8', mode: 0o600 });
  renameSync(tmp, SESSION_FILE);
};

const fileStorage = {
  getItem: (key) => readStore()[key] ?? null,
  setItem: (key, value) => writeStore({ ...readStore(), [key]: value }),
  removeItem: (key) => {
    const store = readStore();
    delete store[key];
    Object.keys(store).length ? writeStore(store) : existsSync(SESSION_FILE) && unlinkSync(SESSION_FILE);
  },
};

/**
 * Supabase rotates refresh tokens and revokes a session when a used one
 * is replayed, so two commands refreshing at once (the Gmail push and a
 * skill, say) could sign each other out. Serialize the refresh.
 */
async function withSessionLock(fn) {
  const deadline = Date.now() + 15_000;
  for (;;) {
    try {
      closeSync(openSync(LOCK_FILE, 'wx'));
      break;
    } catch (e) {
      if (e.code !== 'EEXIST') throw e;
      try {
        if (Date.now() - statSync(LOCK_FILE).mtimeMs > 30_000) unlinkSync(LOCK_FILE);
      } catch {
        /* someone else just removed it */
      }
      if (Date.now() > deadline) throw new CrmCliError(`Timed out waiting for ${LOCK_FILE}. Delete it if no other crm command is running.`);
      await new Promise((r) => setTimeout(r, 150));
    }
  }
  try {
    return await fn();
  } finally {
    try {
      unlinkSync(LOCK_FILE);
    } catch {
      /* already gone */
    }
  }
}

/* ---------- client ---------- */

export function makeClient() {
  const { url, key } = config();
  return createClient(url, key, {
    auth: {
      storage: fileStorage,
      storageKey: STORAGE_KEY,
      persistSession: true,
      // No background timer: it would keep Node alive after the command
      // finishes. getSession() refreshes an expired token on demand.
      autoRefreshToken: false,
      detectSessionInUrl: false,
      flowType: 'pkce',
    },
  });
}

/**
 * A signed-in client, or a clear "run login" error. Every command but
 * login goes through here.
 */
export async function connect() {
  const supabase = makeClient();
  const session = await withSessionLock(async () => {
    const { data, error } = await supabase.auth.getSession();
    if (error) throw new CrmCliError(`Session refresh failed: ${error.message}. Run \`${CLI} login\` again.`);
    return data.session;
  });
  if (!session) {
    throw new CrmCliError(`Not signed in. Run \`${CLI} login\` in your own terminal first.`);
  }

  const call = async (name, args = {}) => {
    const { data, error } = await supabase.rpc(name, args);
    if (error) throw new CrmCliError(error.message, error.code ?? null);
    return data;
  };

  return { supabase, session, user: session.user, call };
}

/* ---------- shared shapes ---------- */

/**
 * CRM deals in the row shape scripts/lib/outreach-csv.mjs#readDrafts and
 * the queue page were written against when leads.csv was the source of
 * truth. Only deals whose details the caller can see carry contact
 * fields; `mine` limits it to deals the caller owns (the Gmail token is
 * one person's mailbox, so drafts only ever go out for their own deals).
 */
export async function legacyRows({ mine = false, includeClosed = true, client = null } = {}) {
  const { call, user } = client ?? (await connect());
  const deals = await call('crm_list_deals', { p_include_closed: includeClosed });
  return deals
    .filter((d) => !mine || d.owner_id === user.id)
    .map((d) => ({
      slug: d.slug,
      race: d.race_name,
      date: d.race_date ?? '',
      town: d.town ?? '',
      tier: d.tier ? String(d.tier) : '',
      director: d.contact_name ?? '',
      email: d.contact_email ?? '',
      phone: d.contact_phone ?? '',
      hereday_link: d.hereday_link ?? '',
      gmail_draft_id: d.gmail_draft_id ?? '',
      gmail_thread_id: d.gmail_thread_id ?? '',
      status: d.stage,
      sent_date: d.sent_at ?? '',
      followup_date: d.followed_up_at ?? '',
      outcome:
        d.effective_stage === 'paid' ? 'paid' : d.effective_stage === 'published' ? 'published' : d.outcome ?? '',
      objection: d.objection ?? '',
      effective_stage: d.effective_stage,
      is_dnc: d.is_dnc,
      deal_id: d.id,
    }));
}

/** Records the Gmail draft pushed for a deal. */
export async function setGmailDraft(client, dealId, { draftId, threadId = null, mailbox = null }) {
  return client.call('crm_update_deal', {
    p_deal_id: dealId,
    p_patch: { gmail_draft_id: draftId, gmail_thread_id: threadId, gmail_draft_mailbox: mailbox },
  });
}
