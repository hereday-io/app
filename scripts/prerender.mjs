// Build-time prerender for the pre-login marketing pages.
//
// Runs after `vite build` and after `vite build --ssr`. For each route it
// renders the real React tree to HTML with renderToString and splices the
// result into the built shell, so a crawler that executes no JavaScript
// still sees the page's actual copy. The client then hydrates on top.
//
// Why not a headless browser: Vercel's build image has no Chromium, so
// Playwright would mean installing it on every deploy. This is pure Node.
//
// Output layout:
//   dist/index.html          prerendered homepage — served directly at /
//   dist/app-shell.html      the ORIGINAL un-prerendered shell, served by
//                            vercel.json's SPA fallback to every app route
//   prerendered/shell.html   the same clean shell, for the api handlers
//   prerendered/<name>.html  prerendered marketing routes
//
// shell.html matters more than it looks. api/page and api/event both read
// a shell off disk and splice meta tags into it. If they kept reading
// dist/index.html once it holds the prerendered homepage, then /faq — and
// every shared event link — would serve homepage body copy to crawlers.
// That is worse than serving an empty shell.
//
// dist/app-shell.html is the same idea for the static SPA fallback.
// Vercel can only rewrite to a file it serves, and while /login,
// /dashboard etc. fell back to dist/index.html they loaded the homepage
// markup, flashed it, and failed to hydrate it as the wrong page (React
// #418/#422/#421 on every load). Unlike the files below it carries no
// page copy, so publishing it is harmless; vercel.json marks a direct
// hit on it noindex.
//
// These land in `prerendered/` at the project root rather than inside
// dist/ on purpose: anything under dist/ is served as a static file, so
// dist/prerendered/faq.html would be publicly fetchable and a second
// crawlable copy of every page. The functions pick them up through
// vercel.json `includeFiles` instead, which does not require them to be
// web-served.

import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath, pathToFileURL } from 'url';
import { APP_SHELL_FILE, EMPTY_ROOT, spliceRoute } from './lib/prerender-html.mjs';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const DIST = join(ROOT, 'dist');
const OUT = join(ROOT, 'prerendered');
const SSR_ENTRY = join(ROOT, 'dist-ssr', 'entry-prerender.js');

// Keys match api/page/[name].ts PAGE_META and the vercel.json rewrites.
// `home` is special: it is written back over dist/index.html because
// Vercel serves `/` straight off the filesystem.
const ROUTES = [
  { name: 'home', url: '/' },
  { name: 'faq', url: '/faq' },
  { name: 'getting-started', url: '/getting-started' },
  { name: 'pro', url: '/pro' },
  { name: 'signup', url: '/signup' },
  { name: 'terms', url: '/terms' },
  { name: 'privacy', url: '/privacy' },
  { name: 'refund', url: '/refund' },
];

// A prerender that silently produces an empty body is the failure mode
// that matters — it looks like success and ships a blank page to
// crawlers. Anything under this many characters of rendered markup is
// treated as a broken render and fails the build.
const MIN_HTML_LENGTH = 2000;

function main() {
  if (!existsSync(SSR_ENTRY)) {
    throw new Error(
      `SSR bundle missing at ${SSR_ENTRY}. Run \`vite build --ssr src/entry-prerender.tsx --outDir dist-ssr\` first.`,
    );
  }

  const shellPath = join(DIST, 'index.html');
  const shell = readFileSync(shellPath, 'utf8');

  if (!shell.includes(EMPTY_ROOT)) {
    throw new Error(
      `Could not find \`${EMPTY_ROOT}\` in dist/index.html. The ` +
        'prerender splices into that exact string; if the shell markup ' +
        'changed, update this script rather than letting it no-op.',
    );
  }

  mkdirSync(OUT, { recursive: true });

  // Preserve the untouched shell BEFORE anything is written into it.
  writeFileSync(join(OUT, 'shell.html'), shell, 'utf8');
  writeFileSync(join(DIST, APP_SHELL_FILE), shell, 'utf8');

  return { shell, shellPath };
}

// Minimal browser globals for module-scope code that assumes a browser.
// The Supabase client configures `storage: localStorage` at import time,
// so this has to exist before the SSR bundle is imported, not just
// before render() is called.
//
// Scope is deliberately narrow — enough to get modules loaded, not a
// jsdom. If a component needs more than this at render time it is doing
// browser work during render, which would be a bug worth seeing rather
// than papering over.
function installBrowserGlobals() {
  const makeStorage = () => {
    const map = new Map();
    return {
      getItem: (k) => (map.has(k) ? map.get(k) : null),
      setItem: (k, v) => void map.set(k, String(v)),
      removeItem: (k) => void map.delete(k),
      clear: () => map.clear(),
      key: (i) => [...map.keys()][i] ?? null,
      get length() {
        return map.size;
      },
    };
  };
  if (typeof globalThis.localStorage === 'undefined') {
    globalThis.localStorage = makeStorage();
  }
  if (typeof globalThis.sessionStorage === 'undefined') {
    globalThis.sessionStorage = makeStorage();
  }
}

const { shell, shellPath } = main();
installBrowserGlobals();
const { render } = await import(pathToFileURL(SSR_ENTRY).href);

const results = [];
for (const route of ROUTES) {
  let html;
  try {
    html = render(route.url);
  } catch (err) {
    console.error(`[prerender] ${route.url} threw during render`);
    throw err;
  }

  if (!html || html.length < MIN_HTML_LENGTH) {
    throw new Error(
      `[prerender] ${route.url} rendered only ${html ? html.length : 0} chars ` +
        `(minimum ${MIN_HTML_LENGTH}). Treating as a broken render rather ` +
        `than shipping a blank page.`,
    );
  }

  // The route stamp tells main.tsx to hydrate rather than mount fresh —
  // but only when the browser is actually on this route.
  const out = spliceRoute(shell, route.url, html);

  const dest =
    route.name === 'home'
      ? shellPath
      : join(OUT, `${route.name}.html`);
  writeFileSync(dest, out, 'utf8');
  results.push({ route: route.url, chars: html.length });
}

console.log('[prerender] wrote prerendered/shell.html (clean shell for api handlers)');
console.log(`[prerender] wrote dist/${APP_SHELL_FILE} (clean shell for the SPA fallback)`);
for (const r of results) {
  console.log(`[prerender] ${r.route.padEnd(18)} ${r.chars} chars`);
}
