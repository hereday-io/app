// Source-map cleanup for the production build.
//
// vite.config.ts uploads hidden source maps to PostHog and the PostHog
// plugin deletes them after a successful upload. This is the backstop
// that runs last in `npm run build`: whatever happened upstream (upload
// failed, plugin changed behaviour, someone turned `build.sourcemap` on
// for debugging), no .map file leaves the build. Anything under dist/ is
// served publicly by Vercel, and a map hands out the original source.

import { readdirSync, rmSync } from 'fs';
import { join } from 'path';

/** Delete every *.map under `dir`, recursively. Returns the deleted paths. */
export function removeSourceMaps(dir) {
  const removed = [];
  let entries;
  try {
    entries = readdirSync(dir, { withFileTypes: true });
  } catch (err) {
    if (err.code === 'ENOENT') return removed;
    throw err;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      removed.push(...removeSourceMaps(path));
    } else if (entry.name.endsWith('.map')) {
      rmSync(path, { force: true });
      removed.push(path);
    }
  }
  return removed;
}
