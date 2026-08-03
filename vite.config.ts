import { defineConfig } from "vite";
import react from "@vitejs/plugin-react-swc";
import path from "path";
import { HOMEPAGE_SCHEMAS } from "./api/_shared/homepageSchema";

// Bake the homepage JSON-LD into index.html at build time.
//
// Why here and not in api/page/[name].ts like the other meta tags:
// Vercel checks the filesystem BEFORE applying `rewrites`, and
// dist/index.html exists at `/`. A `{ source: "/", destination:
// "/api/page/home" }` rewrite is therefore never reached — the static
// file wins. (Confirmed on a preview deploy: /api/page/home served the
// schema correctly while / served the untouched shell.) Since `/` is
// always the static shell, the shell is where the schema has to live.
//
// Consequence: every route that falls through to index.html inherits
// these blocks. api/page and api/event both strip JSON-LD before
// injecting their own, so marketing and event pages are unaffected. The
// remaining inheritors are /dashboard, /editor, /login and friends,
// which are all disallowed in robots.txt.
//
// `<` is escaped so a string value containing "</script>" cannot break
// out of the tag.
function homepageJsonLd() {
  return {
    name: "homepage-jsonld",
    transformIndexHtml() {
      return HOMEPAGE_SCHEMAS.map((schema) => ({
        tag: "script",
        attrs: { type: "application/ld+json" },
        children: JSON.stringify(schema).replace(/</g, "\\u003c"),
        injectTo: "head" as const,
      }));
    },
  };
}

// https://vitejs.dev/config/
export default defineConfig(() => ({
  server: {
    host: "localhost",
    port: 8080,
  },
  plugins: [react(), homepageJsonLd()],
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "./src"),
    },
    dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
  },
}));
