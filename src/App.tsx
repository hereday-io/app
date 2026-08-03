import { Suspense, lazy } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { Route, Routes } from "react-router-dom";
import { Toaster as Sonner } from "@/components/ui/sonner";
import { Toaster } from "@/components/ui/toaster";
import { TooltipProvider } from "@/components/ui/tooltip";
import { AuthProvider } from "@/hooks/useAuth";

// ─── Eager: the pre-login marketing surface ──────────────────────────
// These are the routes we prerender to static HTML at build time, so
// they must stay eagerly imported — React.lazy resolves through a
// promise, which renderToString cannot await. They're also small.
import Index from "./pages/Index.tsx";
import Login from "./pages/Login.tsx";
import Signup from "./pages/Signup.tsx";
import ForgotPassword from "./pages/ForgotPassword.tsx";
import ResetPassword from "./pages/ResetPassword.tsx";
import Privacy from "./pages/Privacy.tsx";
import Terms from "./pages/Terms.tsx";
import Refund from "./pages/Refund.tsx";
import GettingStarted from "./pages/GettingStarted.tsx";
import Faq from "./pages/Faq.tsx";
import Unsubscribe from "./pages/Unsubscribe.tsx";
import NotFound from "./pages/NotFound.tsx";

// ─── Lazy: the map-heavy app surface ─────────────────────────────────
// EventPublic, RouteEditor and ScoutPage pull in mapbox-gl, which
// touches `window` at module scope. Eagerly importing them put Mapbox in
// every route's graph, which (a) made build-time SSR impossible — Node
// throws on import — and (b) shipped a ~3.5MB bundle to visitors reading
// the FAQ. Dashboard, Ops Center, Billing and Admin are split for size
// alone. Anything added here must not be a prerendered route.
const Dashboard = lazy(() => import("./pages/Dashboard.tsx"));
const EventOpsCenter = lazy(() => import("./pages/EventOpsCenter.tsx"));
const RouteEditor = lazy(() => import("./pages/RouteEditor.tsx"));
const ScoutPage = lazy(() => import("./pages/ScoutPage.tsx"));
const VolunteerStatusPage = lazy(() => import("./pages/VolunteerStatusPage.tsx"));
const EventPublic = lazy(() => import("./pages/EventPublic.tsx"));
const Billing = lazy(() => import("./pages/Billing.tsx"));
const AdminComps = lazy(() => import("./pages/AdminComps.tsx"));

const queryClient = new QueryClient();

// Deliberately blank rather than a spinner. These chunks resolve in
// milliseconds on a warm connection, and a flashed-then-removed spinner
// reads as jank — especially on /event/:slug, which is the link
// participants open on race day.
const RouteFallback = () => null;

// BrowserRouter is supplied by the entry point, not here: the client
// mounts this inside BrowserRouter while the prerender wraps it in
// StaticRouter. Keeping the router out of App is what lets one tree
// serve both.
const App = () => (
  <QueryClientProvider client={queryClient}>
    <AuthProvider>
      <TooltipProvider>
        <Toaster />
        <Sonner />
        <Suspense fallback={<RouteFallback />}>
          <Routes>
            <Route path="/" element={<Index />} />
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<Signup />} />
            <Route path="/forgot-password" element={<ForgotPassword />} />
            <Route path="/reset-password" element={<ResetPassword />} />
            <Route path="/dashboard" element={<Dashboard />} />
            <Route path="/dashboard/events/:id" element={<EventOpsCenter />} />
            <Route path="/editor" element={<RouteEditor />} />
            <Route path="/scout/:token" element={<ScoutPage />} />
            <Route path="/v/:token" element={<VolunteerStatusPage />} />
            <Route path="/event/:slug" element={<EventPublic />} />
            <Route path="/privacy" element={<Privacy />} />
            <Route path="/terms" element={<Terms />} />
            <Route path="/refund" element={<Refund />} />
            <Route path="/billing" element={<Billing />} />
            <Route path="/admin/comps" element={<AdminComps />} />
            <Route path="/getting-started" element={<GettingStarted />} />
            <Route path="/faq" element={<Faq />} />
            <Route path="/unsubscribe/:token" element={<Unsubscribe />} />
            <Route path="*" element={<NotFound />} />
          </Routes>
        </Suspense>
      </TooltipProvider>
    </AuthProvider>
  </QueryClientProvider>
);

export default App;
