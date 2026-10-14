// Error reporting for edge functions: a `server_error` event sent to
// PostHog's capture API, so a failure that only reached console.error
// (a webhook that couldn't grant Pro, a checkout that 500'd) can raise
// an alert instead of waiting for a customer email.
//
// Fire-and-forget by contract. reportError never throws and callers
// never await it: a slow or down PostHog must not delay or fail the
// response it is reporting on. The send is handed to
// EdgeRuntime.waitUntil so it survives the response being returned.
//
// Secrets (Edge Functions → Secrets):
//   POSTHOG_KEY   the project API key (phc_…), the same public value as
//                 the frontend's VITE_POSTHOG_KEY. Unset = no-op.
//   POSTHOG_HOST  optional, defaults to https://us.i.posthog.com.

const DEFAULT_HOST = "https://us.i.posthog.com";
const SEND_TIMEOUT_MS = 3000;

/**
 * critical: a customer may have paid without getting Pro, or Stripe is
 *           retrying a delivery we failed. Alert on these.
 * error:    a request failed and the caller saw a 500.
 * warning:  degraded but nothing owed (a label or log row was lost).
 */
export type Severity = "critical" | "error" | "warning";

export interface ErrorContext {
  severity?: Severity;
  /** Where in the function it failed, e.g. "handler", "ledger_claim". */
  stage?: string;
  /** The Hereday user the failure affects, when known. */
  userId?: string | null;
  [key: string]: unknown;
}

let warnedMissingKey = false;

/** The capture-API body for one failure. Exported for tests. */
export function buildErrorEvent(
  fn: string,
  err: unknown,
  context: ErrorContext,
  env: { key: string; supabaseUrl?: string },
): Record<string, unknown> {
  const { severity = "error", stage, userId, ...extra } = context;
  const error = err instanceof Error ? err : null;
  const message = error?.message
    ?? (typeof (err as { message?: unknown } | null)?.message === "string"
      ? (err as { message: string }).message
      : String(err));
  return {
    api_key: env.key,
    event: "server_error",
    // Tie the error to the customer's person when we know them, so it
    // shows up on their PostHog timeline; otherwise group by function.
    distinct_id: userId || `edge:${fn}`,
    timestamp: new Date().toISOString(),
    properties: {
      ...extra,
      function: fn,
      severity,
      stage: stage ?? null,
      message: message.slice(0, 1000),
      error_name: error?.name ?? null,
      // PostgrestError and Stripe errors carry a code alongside message.
      error_code: (err as { code?: unknown } | null)?.code ?? null,
      stack: error?.stack?.slice(0, 4000) ?? null,
      hereday_user_id: userId ?? null,
      environment: projectRef(env.supabaseUrl),
      // Server-side events must not create or update person profiles.
      $process_person_profile: false,
    },
  };
}

/**
 * Send `err` to PostHog under the function's name. Doesn't log it:
 * callers keep their own console.error, which stays the detailed record
 * in the function logs. Never throws; the returned promise never
 * rejects and exists for tests — callers must not await it.
 */
export function reportError(fn: string, err: unknown, context: ErrorContext = {}): Promise<void> {
  try {
    // Read through globalThis: stripe-webhook/handlers.ts imports this
    // module and also runs under Node in tests, where there's no Deno and
    // nothing to report to.
    const deno = (globalThis as { Deno?: { env: { get(key: string): string | undefined } } }).Deno;
    if (!deno) return Promise.resolve();
    const key = deno.env.get("POSTHOG_KEY");
    if (!key) {
      if (!warnedMissingKey) {
        warnedMissingKey = true;
        console.warn("[report] POSTHOG_KEY not set; errors are logged but not reported");
      }
      return Promise.resolve();
    }
    const host = (deno.env.get("POSTHOG_HOST") || DEFAULT_HOST).replace(/\/+$/, "");
    const body = buildErrorEvent(fn, err, context, { key, supabaseUrl: deno.env.get("SUPABASE_URL") });
    const send = fetch(`${host}/capture/`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(SEND_TIMEOUT_MS),
    })
      .then((res) => {
        if (!res.ok) console.warn(`[report] PostHog capture returned ${res.status}`);
      })
      .catch((sendErr) => console.warn("[report] PostHog capture failed", sendErr));
    // Without waitUntil the runtime may stop the isolate as soon as the
    // response is returned, dropping the request mid-flight.
    (globalThis as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } }).EdgeRuntime?.waitUntil(send);
    return send;
  } catch (reportErr) {
    console.warn("[report] could not report error", reportErr);
    return Promise.resolve();
  }
}

// "https://<ref>.supabase.co" → "<ref>", so prod and a local
// `supabase functions serve` (http://127.0.0.1:54321) can be told apart.
function projectRef(supabaseUrl: string | undefined): string {
  if (!supabaseUrl) return "unknown";
  try {
    const { hostname } = new URL(supabaseUrl);
    return hostname.endsWith(".supabase.co") ? hostname.split(".")[0] : "local";
  } catch {
    return "unknown";
  }
}
