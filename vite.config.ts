import { defineConfig, type Plugin } from "vite";
import react from "@vitejs/plugin-react-swc";
import posthog from "@posthog/rollup-plugin";
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

// Upload source maps to PostHog so Error Tracking shows real file names
// and lines instead of minified bundle positions.
//
// Maps are built "hidden" (no sourceMappingURL comment in the bundle),
// uploaded with a personal API key, then deleted by the plugin.
// scripts/strip-sourcemaps.mjs deletes any that survive, because
// everything in dist/ is publicly served.
//
// Runs only when POSTHOG_PERSONAL_API_KEY is set (Vercel Production).
// Preview deploys, CI and local builds skip it and build no maps at
// all, rather than generating maps nobody uploads.
//
// An upload failure is logged and the deploy carries on: a PostHog
// outage or revoked key must not block shipping a fix. The cost is that
// that release's stack traces stay minified.
//
// Env (Vercel → Settings → Environment Variables, Production only):
//   POSTHOG_PERSONAL_API_KEY  personal API key (phx_…) limited to this
//                             project, scopes "Error tracking: Write" and
//                             "Organization: Read". Never VITE_-prefixed:
//                             it must not reach the bundle.
//   POSTHOG_PROJECT_ID        optional, defaults to Hereday's project.
const POSTHOG_PROJECT_ID = "466228";

function posthogSourcemaps(): Plugin[] {
  const personalApiKey = process.env.POSTHOG_PERSONAL_API_KEY?.trim();
  if (!personalApiKey) {
    console.warn(
      "[posthog-sourcemaps] POSTHOG_PERSONAL_API_KEY not set; skipping source map upload (stack traces stay minified)",
    );
    return [];
  }
  const plugin = posthog({
    personalApiKey,
    projectId: process.env.POSTHOG_PROJECT_ID?.trim() || POSTHOG_PROJECT_ID,
    host: "https://us.i.posthog.com",
    sourcemaps: {
      releaseName: "hereday",
      releaseVersion: process.env.VERCEL_GIT_COMMIT_SHA,
      // Binds the release to the symbol sets at upload time, so the CLI
      // runs only in writeBundle (wrapped below) and never mid-render,
      // where a failure would abort the build.
      releaseMode: "symbol-set",
      deleteAfterUpload: true,
    },
  }) as Plugin;

  const upload = plugin.writeBundle;
  if (upload && typeof upload === "object") {
    plugin.writeBundle = {
      ...upload,
      async handler(...args) {
        try {
          await upload.handler.apply(this, args);
        } catch (err) {
          this.warn(
            `source map upload to PostHog failed, deploying without it: ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      },
    };
  }
  return [{ ...plugin, apply: "build" }];
}

// https://vitejs.dev/config/
export default defineConfig(({ command, isSsrBuild }) => {
  // The SSR bundle only feeds scripts/prerender.mjs and never runs in a
  // browser, so there is nothing of it to upload.
  const sourcemapPlugins = command === "build" && !isSsrBuild ? posthogSourcemaps() : [];
  return {
    server: {
      host: "localhost",
      port: 8080,
    },
    build: {
      sourcemap: sourcemapPlugins.length > 0 ? "hidden" : false,
    },
    plugins: [react(), homepageJsonLd(), ...sourcemapPlugins],
    resolve: {
      alias: {
        "@": path.resolve(__dirname, "./src"),
      },
      dedupe: ["react", "react-dom", "react/jsx-runtime", "react/jsx-dev-runtime"],
    },
  };
});
