import { readFileSync } from "fs";
import { act } from "react";
import { renderToString } from "react-dom/server";
import { hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import { StaticRouter } from "react-router-dom/server";
import { HOMEPAGE_SCHEMAS } from "../../api/_shared/homepageSchema";
import { PAGE_META, injectMetaTags } from "../../api/page/[name]";
import App from "@/App";

// The marketing routes in api/page/[name].ts reach the browser through
// three steps: scripts/prerender.mjs renders the route into the shell,
// the handler rewrites the shell's head for that page, and src/main.tsx
// hydrates the result. React hydrates node-for-node, so the handler must
// leave the prerendered markup in #root exactly as React rendered it.
// It once stripped every JSON-LD <script> in the document, including the
// one Faq renders through <JsonLd>, and /faq failed to hydrate on every
// load (React #418 + #422) and re-rendered from scratch.

vi.mock("@/integrations/supabase/client", () => ({
  supabase: {
    auth: {
      onAuthStateChange: () => ({ data: { subscription: { unsubscribe() {} } } }),
      getSession: () => Promise.resolve({ data: { session: null } }),
    },
  },
}));
// Signup logs a page view on mount; keep that off the network.
vi.mock("@/lib/analytics", () => ({ logEvent: vi.fn() }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

// What `vite build` makes of index.html: the source shell plus the
// homepage JSON-LD that vite.config.ts bakes into <head>, which the
// handler has to strip for every other page.
const builtShell = readFileSync("index.html", "utf8").replace(
  "</head>",
  HOMEPAGE_SCHEMAS.map(
    (s) => `<script type="application/ld+json">${JSON.stringify(s)}</script>`,
  ).join("") + "</head>",
);

// Mirrors spliceRoute in scripts/lib/prerender-html.mjs.
function prerender(url: string): string {
  const html = renderToString(
    <StaticRouter location={url}>
      <App />
    </StaticRouter>,
  );
  return builtShell.replace(
    '<div id="root"></div>',
    `<div id="root" data-prerendered-route="${url}">${html}</div>`,
  );
}

function rootMarkup(doc: string): string {
  const start = doc.indexOf('<div id="root"');
  return doc.slice(start, doc.lastIndexOf("</div>", doc.indexOf("</body>")) + 6);
}

const pages = Object.keys(PAGE_META);

describe("marketing pages served by api/page", () => {
  it.each(pages)("/%s: the handler leaves the prerendered #root untouched", (name) => {
    const prerendered = prerender(`/${name}`);
    const served = injectMetaTags(prerendered, PAGE_META[name], name);
    expect(rootMarkup(served)).toBe(rootMarkup(prerendered));
  });

  it("strips the homepage JSON-LD from <head>", () => {
    const served = injectMetaTags(prerender("/terms"), PAGE_META.terms, "terms");
    const head = served.slice(0, served.indexOf("</head>"));
    expect(head).not.toContain("application/ld+json");
  });

  it.each(pages)("/%s hydrates the served markup without a mismatch", async (name) => {
    const served = injectMetaTags(prerender(`/${name}`), PAGE_META[name], name);
    document.body.innerHTML = rootMarkup(served);
    window.history.replaceState(null, "", `/${name}`);
    const container = document.getElementById("root")!;
    const serverNode = container.querySelector("main") ?? container.lastElementChild;

    const errors: unknown[] = [];
    let root: ReturnType<typeof hydrateRoot> | undefined;
    await act(async () => {
      root = hydrateRoot(
        container,
        <BrowserRouter>
          <App />
        </BrowserRouter>,
        { onRecoverableError: (error) => errors.push(error) },
      );
    });

    expect(errors).toEqual([]);
    // A failed hydrate recovers by client-rendering and replacing the
    // server's nodes, so the original node surviving proves React adopted it.
    expect(serverNode?.isConnected).toBe(true);
    act(() => root?.unmount());
  });
});
