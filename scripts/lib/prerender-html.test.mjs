// npm run test:scripts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { APP_SHELL_FILE, EMPTY_ROOT, spliceRoute } from './prerender-html.mjs';

const shell = `<html><head></head><body>${EMPTY_ROOT}<script src="/assets/index.js"></script></body></html>`;

test('stamps the rendered route on the root', () => {
  const out = spliceRoute(shell, '/faq', '<main>FAQ</main>');
  assert.match(out, /<div id="root" data-prerendered-route="\/faq"><main>FAQ<\/main><\/div>/);
  assert.ok(!out.includes(EMPTY_ROOT));
});

test('inserts markup literally, even if it contains replace() patterns', () => {
  // String.replace with a string replacement would expand these.
  const html = "<p>Save $& and $' today</p>";
  assert.ok(spliceRoute(shell, '/pro', html).includes(html));
});

test('fails loudly when the shell has no empty root', () => {
  assert.throws(() => spliceRoute('<div id="root" class="x"></div>', '/', 'x'), /Could not find/);
});

test('the SPA fallback serves the clean shell, not the prerendered homepage', () => {
  // dist/index.html holds the prerendered homepage. If every app route
  // falls back to it, /login, /dashboard etc. load homepage markup and
  // fail to hydrate it (React #418/#422/#421).
  const vercel = JSON.parse(readFileSync(new URL('../../vercel.json', import.meta.url), 'utf8'));
  const fallback = vercel.rewrites.at(-1);
  assert.equal(fallback.source, '/((?!api/).*)', 'expected the catch-all to be the last rewrite');
  assert.equal(fallback.destination, `/${APP_SHELL_FILE}`);

  const noindex = vercel.headers.find((h) => h.source === `/${APP_SHELL_FILE}`);
  assert.ok(
    noindex?.headers.some((h) => h.key === 'X-Robots-Tag' && h.value === 'noindex'),
    'a direct hit on the shell should be noindex',
  );
});
