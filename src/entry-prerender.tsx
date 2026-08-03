// SSR entry used only by the build-time prerender (scripts/prerender.mjs).
// Never shipped to the browser.
//
// Renders the same <App /> the client mounts, wrapped in StaticRouter
// instead of BrowserRouter, so the markup React produces here matches
// what hydration expects on the client.

import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import App from './App.tsx';

export function render(url: string): string {
  return renderToString(
    <StaticRouter location={url}>
      <App />
    </StaticRouter>,
  );
}
