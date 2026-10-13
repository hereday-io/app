#!/usr/bin/env node
/**
 * Raw race lists for /lead-discover. Doesn't touch the CRM.
 *
 *   node scripts/lead-sources.mjs runsignup --national [--states VT,WY] [--max 150]
 *                                           [--from YYYY-MM-DD] [--to YYYY-MM-DD] [--out file]
 *   node scripts/lead-sources.mjs runsignup --zip 60014 --radius 50 [...]
 *
 * --national (what the weekly run uses):
 *   1. pulls every in-person US race in the window (8–14 weeks out),
 *   2. drops management series by name (scripts/lib/icp.mjs),
 *   3. size-checks this week's states — --states, or the rotation in
 *      outreach/discovery/state-rotation.json, which walks every state once
 *      every ROTATION_WEEKS weeks — by counting last year's finishers,
 *   4. keeps races with MIN_FINISHERS–MAX_FINISHERS, stopping at --max.
 *
 * Writes outreach/discovery/runsignup-<today>.json (sized, in the ICP's
 * range) and runsignup-unsized-<today>.json (no results on RunSignup;
 * research can size them by hand). Both take `crm.mjs screen` as is.
 * Finisher counts are cached in outreach/discovery/cache/.
 */

import dns from 'node:dns';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { discoveryWindow } from './lib/discovery.mjs';
import {
  MAX_FINISHERS, MIN_FINISHERS, STATES, rotationStates, seriesLeads,
} from './lib/icp.mjs';
import { fetchRaces, fetchState, lastYearFinishers, throttled } from './lib/runsignup.mjs';

// Kevin's network times out on IPv6 from Node.
dns.setDefaultResultOrder('ipv4first');

const DISCOVERY = join(dirname(fileURLToPath(import.meta.url)), '..', 'outreach', 'discovery');
const CACHE_FILE = join(DISCOVERY, 'cache', 'runsignup-results.json');
const ROTATION_FILE = join(DISCOVERY, 'state-rotation.json');
const today = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Chicago' }).format(new Date());

const flags = {};
const [cmd, ...rest] = process.argv.slice(2);
for (let i = 0; i < rest.length; i++) {
  if (rest[i].startsWith('--')) flags[rest[i].slice(2)] = rest[i + 1] === undefined || rest[i + 1].startsWith('--') ? true : rest[++i];
}

const day = (v, name) => {
  if (v !== undefined && !/^\d{4}-\d{2}-\d{2}$/.test(v)) throw new Error(`--${name} must be YYYY-MM-DD.`);
  return v;
};
const readJson = (file, fallback) => (existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : fallback);
const writeJson = (file, data) => {
  mkdirSync(dirname(file), { recursive: true });
  writeFileSync(file, JSON.stringify(data, null, 2) + '\n', 'utf8');
};

/** Drop management series (scripts/lib/icp.mjs seriesLeads). */
function dropSeries(leads) {
  const series = seriesLeads(leads);
  return { kept: leads.filter((l) => !series.has(l)), dropped: leads.filter((l) => series.has(l)) };
}

async function national({ from, to }) {
  const max = Number(flags.max ?? 150);
  const http = throttled(fetch, 300);

  // The whole-US list is reused for the day: series detection needs all of it.
  const usFile = join(DISCOVERY, `runsignup-us-${today}.json`);
  let all = from === discoveryWindow(today).from && existsSync(usFile) ? readJson(usFile, null) : null;
  if (!all) {
    // State by state: anonymous callers only get 1,000 results per query.
    all = [];
    for (const state of STATES) all.push(...(await fetchState({ state, from, to }, http)));
    writeJson(usFile, all);
  }
  const { kept: noSeries, dropped } = dropSeries(all);

  let states;
  let rotation = null;
  if (typeof flags.states === 'string') {
    states = flags.states.split(',').map((s) => s.trim().toUpperCase()).filter(Boolean);
    const bad = states.filter((s) => !STATES.includes(s));
    if (bad.length) throw new Error(`Unknown state codes: ${bad.join(', ')}.`);
  } else {
    rotation = readJson(ROTATION_FILE, { next_slot: 0, history: [] });
    states = rotationStates(rotation.next_slot);
  }

  const pool = noSeries.filter((l) => states.includes(l.state));
  const cache = readJson(CACHE_FILE, {});
  const sized = [];
  const unsized = [];
  let outOfRange = 0;
  let checked = 0;
  for (const lead of pool) {
    if (sized.length >= max) break;
    checked++;
    try {
      const f = await lastYearFinishers(lead, { fetchImpl: http, cache });
      if (f.count === null) unsized.push(lead);
      else if (f.count < MIN_FINISHERS || f.count > MAX_FINISHERS) outOfRange++;
      else sized.push({ ...lead, last_year_finishers: f.count, participants_source: f.source_url, finisher_events: f.events });
    } catch (e) {
      console.error(`  skipped ${lead.race_name}: ${e.message}`);
    }
    if (checked % 50 === 0) {
      writeJson(CACHE_FILE, cache);
      console.log(`  ${checked}/${pool.length} checked, ${sized.length} in range`);
    }
  }
  writeJson(CACHE_FILE, cache);

  const out = typeof flags.out === 'string' ? flags.out : join(DISCOVERY, `runsignup-${today}.json`);
  writeJson(out, sized);
  writeJson(join(DISCOVERY, `runsignup-unsized-${today}.json`), unsized);
  if (rotation) {
    rotation.history = [...(rotation.history ?? []), { on: today, slot: rotation.next_slot, states }].slice(-12);
    rotation.next_slot = rotation.next_slot + 1;
    writeJson(ROTATION_FILE, rotation);
  }

  console.log(`${all.length} in-person US races on RunSignup, ${from} .. ${to}; ${dropped.length} dropped as series.`);
  console.log(`States this run: ${states.join(', ')} (${pool.length} races).`);
  console.log(`Size-checked ${checked}: ${sized.length} with ${MIN_FINISHERS}–${MAX_FINISHERS} finishers last year, ${outOfRange} outside that, ${unsized.length} with no results on RunSignup.`);
  console.log(`Written to ${out}`);
}

try {
  if (cmd !== 'runsignup') {
    console.log('Usage: node scripts/lead-sources.mjs runsignup --national [--states VT,WY] [--max 150] [--from d] [--to d] [--out file]');
    console.log('       node scripts/lead-sources.mjs runsignup --zip 60014 --radius 50 [--from d] [--to d] [--out file]');
    process.exit(cmd ? 1 : 0);
  }
  const window = discoveryWindow(today);
  const from = day(flags.from, 'from') ?? window.from;
  const to = day(flags.to, 'to') ?? window.to;

  if (flags.national) {
    await national({ from, to });
  } else if (flags.zip) {
    const radius = Number(flags.radius ?? 50);
    const leads = await fetchRaces({ zip: flags.zip, radius, from, to });
    const out = typeof flags.out === 'string' ? flags.out : join(DISCOVERY, `runsignup-${today}.json`);
    writeJson(out, leads);
    console.log(`${leads.length} in-person races on RunSignup within ${radius} mi of ${flags.zip}, ${from} .. ${to}`);
    console.log(`Written to ${out}`);
  } else {
    throw new Error('Pass --national, or --zip with --radius.');
  }
} catch (e) {
  console.error(`error: ${e.message}`);
  process.exitCode = 1;
}
