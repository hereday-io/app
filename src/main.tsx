import { createRoot } from "react-dom/client";
import App from "./App.tsx";
import "./index.css";
import { initPostHog } from "@/lib/posthog";
import { captureFirstTouch } from "@/lib/attribution";

// Before the router mounts: snapshot acquisition attribution (referrer,
// utm params, landing page — gone after the first navigation) and start
// PostHog if configured.
initPostHog();
captureFirstTouch();

createRoot(document.getElementById("root")!).render(<App />);
