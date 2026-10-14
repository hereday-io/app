import { describe, expect, it } from "vitest";
import { shouldHydrate } from "./prerenderMount";

function root(attrs: Record<string, string>, inner = "<main>copy</main>") {
  const el = document.createElement("div");
  el.id = "root";
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  el.innerHTML = inner;
  return el;
}

describe("shouldHydrate", () => {
  it("hydrates when the markup was rendered for the current route", () => {
    expect(shouldHydrate(root({ "data-prerendered-route": "/" }), "/")).toBe(true);
    expect(shouldHydrate(root({ "data-prerendered-route": "/faq" }), "/faq")).toBe(true);
  });

  it("mounts fresh when the homepage markup is served on another route", () => {
    // The 2026-10-14 bug: SPA fallback served the prerendered homepage
    // on /login, /dashboard, /editor, ...
    const home = root({ "data-prerendered-route": "/" });
    expect(shouldHydrate(home, "/login")).toBe(false);
    expect(shouldHydrate(home, "/dashboard")).toBe(false);
    expect(shouldHydrate(home, "/index.html")).toBe(false);
  });

  it("treats a trailing slash as the same route", () => {
    expect(shouldHydrate(root({ "data-prerendered-route": "/faq" }), "/faq/")).toBe(true);
    expect(shouldHydrate(root({ "data-prerendered-route": "/" }), "/")).toBe(true);
  });

  it("does not let a shared prefix count as a match", () => {
    expect(shouldHydrate(root({ "data-prerendered-route": "/pro" }), "/projects")).toBe(false);
  });

  it("mounts fresh on the clean shell", () => {
    expect(shouldHydrate(root({}, ""), "/login")).toBe(false);
  });

  it("mounts fresh when the route stamp is missing", () => {
    // HTML from a build before the route stamp existed only says
    // data-prerendered="true" — not enough to know it's safe.
    expect(shouldHydrate(root({ "data-prerendered": "true" }), "/")).toBe(false);
  });

  it("mounts fresh when the stamped root is empty", () => {
    expect(shouldHydrate(root({ "data-prerendered-route": "/" }, ""), "/")).toBe(false);
  });
});
