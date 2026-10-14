// Decides whether main.tsx hydrates the server markup in #root or mounts
// from empty.
//
// scripts/prerender.mjs stamps each prerendered page's root with the
// route it was rendered for (`data-prerendered-route="/faq"`). Hydration
// is only correct when that route is the one the browser is actually on:
// hydrating the homepage's markup as the Login tree fails with React
// #418/#422/#421, throws the markup away anyway, and flashes homepage
// copy before Login draws. That happened on every app route while
// Vercel's SPA fallback served the prerendered homepage, and could again
// if any HTML is ever served at a path it wasn't rendered for (e.g. a
// direct hit on /index.html).

// `/faq/` and `/faq` render the same route, so compare them as equal.
// Case is left alone: a mismatch only costs a fresh mount, never a
// broken hydrate.
function normalizePath(path: string): string {
  return path.length > 1 ? path.replace(/\/+$/, "") || "/" : path;
}

export function shouldHydrate(root: HTMLElement, pathname: string): boolean {
  const route = root.dataset.prerenderedRoute;
  return (
    route !== undefined &&
    root.firstElementChild !== null &&
    normalizePath(route) === normalizePath(pathname)
  );
}
