#!/usr/bin/env node
/**
 * Raw race lists for /lead-discover. Doesn't touch the CRM.
 *
 *   node scripts/lead-sources.mjs runsignup [--from YYYY-MM-DD] [--to YYYY-MM-DD]
 *                                           [--zip 60014] [--radius 50] [--out file]
 *
 * Default window: races 8–14 weeks out (the ICP). Default area: 50 miles
 * around Crystal Lake. Writes outreach/discovery/runsignup-<today>.json,
 * which `node scripts/crm.mjs screen <file>` takes as is.
 */

import dns from 'node:dns';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoveryWindow } from './lib/discovery.mjs';
import { fetchRaces } from './lib/runsignup.mjs';

// Kevin's network times out on IPv6 from Node.
dns.setDefaultResultOrder('ipv4first');

const OUTREACH = join(dirname(fileURLToPath(import.meta.url)), '..', 'outreach');
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());

const flags = {};
const [cmd, ...rest] = process.argv.slice(2);
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) flags[rest[i].slice(2)] = rest[i + 1]?.startsWith('--') ? true : rest[++i];
}

const day = (v, name) => {
  if (v !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`--${name} must be YYYY-MM-DD.`);
  return v;
};

try {
  if (cmd !== 'runsignup') {
    console.log('Usage: node scripts/lead-sources.mjs runsignup [--from d] [--to d] [--zip 60014] [--radius 50] [--out file]');
    process.exit(cmd ? 1 : 0);
  }
  const window = discoveryWindow(today);
  const from = day(flags.from, 'from') ?? window.from;
  const to = day(flags.to, 'to') ?? window.to;
  const zip = flags.zip ?? '60014';
  const radius = Number(flags.radius ?? 50);
  const leads = await fetchRaces({ zip, radius, from, to });

  const out = typeof flags.out === 'string' ? flags.out : join(OUTREACH, 'discovery', `runsignup-${today}.json`);
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(leads, null, 2) + '\n', 'utf8');
  console.log(`${leads.length} in-person races on RunSignup within ${radius} mi of ${zip}, ${from} .. ${to}`);
  console.log(`Written to ${out}`);
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exitCode = 1;
}
