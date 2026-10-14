// Pure helpers for scripts/prerender.mjs, split out so they can be tested
// without a build.

// The exact empty root in Vite's built index.html that the prerender
// splices into.
export const EMPTY_ROOT = '<div id="root"></div>';

// The clean, un-prerendered shell, published as a static file so
// vercel.json's SPA fallback can serve it to every route that isn't
// prerendered (/login, /dashboard, /editor, ...). Those routes used to
// fall back to dist/index.html, which holds the prerendered *homepage* —
// so each loaded homepage markup, flashed it, and failed to hydrate it.
// vercel.json must name this same file; scripts/lib/prerender-html.test.mjs
// checks that it does.
export const APP_SHELL_FILE = 'app-shell.html';

// Splice a route's rendered markup into the shell. The route is stamped
// on the root so src/main.tsx only hydrates when the browser is on the
// route the markup was rendered for (src/lib/prerenderMount.ts).
export function spliceRoute(shell, route, html) {
  if (!shell.includes(EMPTY_ROOT)) {
    throw new Error(
      `Could not find \`${EMPTY_ROOT}\` in the shell. The prerender ` +
        'splices into that exact string; if the shell markup changed, ' +
        'update this script rather than letting it no-op.',
    );
  }
  const attr = route.replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  return shell.replace(
    EMPTY_ROOT,
    () => `<div id="root" data-prerendered-route="${attr}">${html}</div>`,
  );
}
