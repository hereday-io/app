import { createRoot, hydrateRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import App from "./App.tsx";
import "./index.css";
import { initPostHog } from "@/lib/posthog";
import { captureFirstTouch } from "@/lib/attribution";

// Before the router mounts: snapshot acquisition attribution (referrer,
// utm params, landing page — gone after the first navigation) and start
// PostHog if configured.
initPostHog();
captureFirstTouch();

const root = document.getElementById("root")!;

// BrowserRouter lives here rather than inside App so the build-time
// prerender can wrap the same tree in StaticRouter instead.
const tree = (
  <BrowserRouter>
    <App />
  </BrowserRouter>
);

// Marketing routes are prerendered to static HTML at build time, so on
// those the container already holds real markup and we hydrate it
// instead of throwing it away. Everything else mounts from empty as
// before. `data-prerendered` is stamped on by the prerender script.
if (root.dataset.prerendered === "true" && root.firstElementChild) {
  hydrateRoot(root, tree);
} else {
  createRoot(root).render(tree);
}
