# Pre-Launch Readiness Report — 2026-05-01

Multi-agent review run for first-paying-customer outreach readiness. Scope: UX audit, onboarding 4-agent suite, backend/security review, marketing readiness sweep. Findings consolidated below into P0/P1/P2.

**Pro tier copy reconciliation (Phase 2 — done):** Index.tsx, Faq.tsx, UpgradeModal.tsx, CLAUDE.md, feature_roadmap.md all now match the canonical Pro feature list. Three previously-silent Pro features are now advertised: Event Ops Center, Live volunteer status reporting, All branded sponsors visible.

**Stripe status reconciliation (Phase 2 — done):** feature_roadmap.md now reflects `PAYMENTS_LIVE = true` end-to-end. Bank cleared, secrets set, real $49 charges work.

---

## P0 — LAUNCH BLOCKERS (must fix before outreach)

### Security / RLS — would cause first-customer disaster

| ID | Location | Issue | Fix |
|---|---|---|---|
| **C-1** | `supabase/migrations/20260404120000_db_audit_hardening.sql:41-45` | `FOR SELECT TO anon USING (status='published')` on `events` table has NO column filter. Anon can `?select=*` and read `stripe_session_id`, `paid_at`, `emergency_contacts`, `volunteer_roster`, `scouted_pois` for every published event. View's column filter is moot — PostgREST hits the table directly. | New migration: drop anon SELECT on `events`; recreate `public_events` view as SECURITY DEFINER (or column-grant); GRANT SELECT only on view. |
| **C-2** | `supabase/migrations/20260410120000_poi_volunteer_tokens_and_scouted_pois.sql:47-52` | `FOR SELECT TO anon USING (revoked_at IS NULL)` — no PK predicate. Anon can dump every active volunteer/scout token across the platform; each token unlocks `submit-scouted-poi` + `update-poi-status`. | Drop the policy. Edge functions validate via service role; anon never needs direct read. |
| **C-3** | `supabase/migrations/20260406120000_tracking_sessions.sql:53-56` | `FOR UPDATE TO anon, authenticated USING (true) WITH CHECK (true)` — any spectator can PATCH any runner's tracking row. UUIDs are returned by the SELECT policy, so they're not unguessable. GPS pins can be redirected anywhere. | Drop UPDATE policy. Add `session_secret` column. Route writes through new edge function that validates secret (or reuse a session-scoped HMAC). |
| **C-4** | client-side `usePaywall.ts` only; no DB constraint | Free user can `PATCH /events?id=eq.<own>` setting `logo_url`, `branding_style`, exceeding routes/POIs limits. Server only enforces tracking INSERT (via the 20260413 fix). | Add CHECK constraint or BEFORE UPDATE trigger that rejects branding/logo/excessive route or POI counts unless `paid_at IS NOT NULL`. |
| **C-5** | `supabase/functions/_shared/billing.ts:8-12` (and duplicated across 19 edge functions) | `Access-Control-Allow-Origin: *` allows any third-party site to invoke billing endpoints with leaked tokens. | Origin-aware allowlist: `hereday.io`, `*.vercel.app` previews, `localhost`. |

### Edge function correctness — financial / abuse risk

| ID | Location | Issue | Fix |
|---|---|---|---|
| **H-2** | `supabase/functions/submit-scouted-poi/index.ts:198-211` | Rate-limit query failure falls back to a permissive count path that ignores submissions from new tokens. One DB blip lets an attacker flood. | Fail-closed: return 503 on the rate-limit table error path. |
| **H-3** | `supabase/functions/apply-promo/index.ts:54-65` | Fallback path retrieves coupons by ID, exposing operator-only coupons (e.g., `FRIENDS_FAMILY_100`) if a user guesses the ID. | Remove the coupon-ID fallback. Only accept codes resolved via `promotionCodes.list`. |

### Frontend UX — would break the first user's session

| ID | Location | Issue | Fix |
|---|---|---|---|
| **UX-1** | `src/pages/Signup.tsx:250` | Placeholder says "At least 8 characters" but `minLength={6}` allows 6-char passwords. Mixed signal undermines trust. | Set `minLength={8}` to match the placeholder (already 8 in copy). |
| **UX-2** | `src/components/CreateEventDialog.tsx:49` | Slug uses `Math.random().toString(36).slice(2, 7)` — 5 chars, ~60M combinations. Two near-simultaneous creates can collide → DB unique-constraint violation surfaced as a generic error to user. | Use `crypto.randomUUID().slice(0, 8)` or full UUID. |
| **UX-3** | `src/pages/EventPublic.tsx:55-58` | `localStorage.getItem` runs without try/catch on initial mount. In private mode / quota-exceeded, throws and breaks page. | Wrap in try/catch with fallback to `'runner'`. |

### Marketing — would lose cold visitors

| ID | Location | Issue | Fix |
|---|---|---|---|
| **MKT-1** | `src/pages/Index.tsx` plans array | Pro plan CTA labeled `"Start for free"` — identical to Free plan label. Visual variant differs but copy doesn't. | Change Pro CTA to clarify intent without breaking the "no plan-pick before build" design intent. Recommended: "Start free • $49 to publish" or "Build free, upgrade to publish". |

---

## P1 — CRITICAL POLISH (fix before scaling outreach)

| ID | Location | Issue | Fix |
|---|---|---|---|
| **H-1** | `supabase/functions/stripe-webhook/index.ts` | No event-id replay guard; refund-then-recharge cycles could race. Lower risk because `paid_at = COALESCE(...)` is idempotent for the success path. | Add `webhook_events` table with `event_id` PK; `INSERT ON CONFLICT DO NOTHING` short-circuit. |
| **H-5** | `supabase/functions/update-poi-status/index.ts:91-100` | `state='moved'` accepted with NULL `moved_to` coords. Corrupts public map. | Reject with 400 when `state='moved'` and `moved_to` invalid. |
| **MKT-2** | `src/pages/Faq.tsx` | No FAQ entry for "what if my event is cancelled?" — biggest cold-visitor refund concern. | Add FAQ entry pointing at refund policy + case-by-case for post-publish cancellations. |
| **MKT-3** | `src/pages/Index.tsx` hero | Hero leads with "Type a name. Draw a route. Share a link." — action without "why bother". | Add subtitle clarifying the user problem ("Help runners navigate. Show spectators where the action is."). |
| **OB-1** | `src/components/editor/EditorCoachMark.tsx:64` (and adjacent status text in RouteEditor) | First-paint coach mark says "Click anywhere on the map to start your route" — vague. | Rewrite: "Click on the map to place the first waypoint of your race course." |
| **OB-2** | `src/pages/Dashboard.tsx:612` | Email-verification banner copy "Verify your email to publish" doesn't explain *why now*. | "Check your inbox — we sent a confirmation link. You'll need it to publish." |
| **UX-4** | `src/pages/EventPublic.tsx:76-93` | Dark mode classList cleanup on unmount can flash light mode during navigation. | Save/restore prior classList state in cleanup, not unconditional remove. |
| **M-3** | `supabase/functions/get-mapbox-token/index.ts:13-23` | Mapbox token returned to any authenticated user; reusable for any Mapbox API. | Switch to URL-restricted public token in bundle, OR proxy tile requests through edge function. (Token rotation step required.) |

---

## P2 — DEFER (post-first-customer)

- **H-4**: Stale `event_owner_is_paid()` function — no current callers but leaves a future foot-gun. Drop the function once no policy references it.
- **M-1**: Race on `events.scouted_pois` array writes. Low real-world frequency.
- **M-2**: subscriber/event ID logging — drop verbose unsubscribe logs (no PII risk; defense-in-depth only).
- **M-4**: CLAUDE.md `verify_jwt` table mentions `unsubscribe` and `sitemap` inconsistently with `config.toml`.
- **M-5**: Anonymous insert throttling on `pro_waitlist` and `event_subscribers` (DOS / cost control).
- **Polish-pile (existing roadmap):** thin-sidebar rail, universal Escape handler, snap-to-roads dashed fallback, drag-drop reorder slide, POI grid below map, publish-success-modal carousel.
- **Onboarding agent's "preview line on click"**: do NOT re-implement — was reverted permanently due to RouteEditor.tsx Mapbox source/layer fragility (4 attempted implementations all caused regressions). Documented in `feature_roadmap.md`.
- **Marketing agent's "no demo event"**: defer — once the first paying customer publishes, link to that real event in outreach.
- **Marketing agent's social-proof gap**: defer the testimonial/counter until the first customer; placeholder testimonials are worse than no testimonials.

---

## VERIFIED ✅ (already solid — do not refactor)

These are explicitly confirmed working from the agents:

- **Stripe webhook signature verification**: `constructEventAsync` with raw body, returns 400 on failure, COALESCE-style idempotency on `paid_at`.
- **`create-checkout` ownership check**: returns 403 when caller != event.user_id.
- **Cross-customer leak prevention**: `get-receipt`, `list-charges`, `get-payment-method`, `open-billing-portal`, `detach-payment-method` all scope to caller's `stripe_customer_id`.
- **Unsubscribe HMAC token**: HMAC-SHA256, 365-day expiry, key length validated.
- **`profiles` RLS**: owner-only SELECT/UPDATE.
- **`public_events` view content**: no email, no Stripe IDs, no PII (the leak is the underlying table policy, not the view).
- **`event_subscribers` SELECT**: owner-only.
- **`scout_rate_limits`**: service-role only.
- **`pro_waitlist`**: no SELECT policy (anon INSERT only).
- **Service-role key**: not present in `src/`.
- **Tracking INSERT**: per-event `paid_at` enforcement.
- **Editor pre-publish validation** (`canPublish` requires routes with ≥2 waypoints).
- **Editor geolocation fallback** (localStorage → navigator.geolocation → continental default).
- **Email verification gate on publish** (`handlePublish` blocks unverified users).
- **Password strength meter** in Signup.tsx (lines 14-25 + 207-238).
- **Confirmation toast / undo** for clear/delete actions.
- **OG tags on landing page** (index.html lines 12-26).
- **MadeWithHeredayBadge** UTM tracking.

---

## DEPLOYMENT ORDER FOR FIXES

1. **Migrations** (security RLS + Pro feature triggers) — apply via Supabase MCP. Schema must be ready before edge functions reference new tables.
2. **Edge functions** (CORS allowlist, rate-limit fail-closed, coupon fallback removal, replay guard, moved_to validation) — redeploy via Supabase MCP.
3. **Frontend** (UX-1/2/3, MKT-1/2/3, OB-1/2, UX-4) — git push to main, Vercel auto-deploys.

Each layer requires its own pre-flight check. Frontend pre-flight: `npx tsc --noEmit && npx vite build` from `My Project/`.

---

## VERIFICATION CHECKLIST (run before outreach)

1. [ ] `curl '/rest/v1/events?status=eq.published&select=stripe_session_id'` returns 401/empty (C-1 fixed)
2. [ ] `curl '/rest/v1/poi_volunteer_tokens?select=*'` returns 401/empty (C-2 fixed)
3. [ ] PATCH on someone else's `tracking_sessions` row returns 403 (C-3 fixed)
4. [ ] Free user PATCH setting `branding_style='full'` rejected by trigger (C-4 fixed)
5. [ ] Cross-origin call to `create-checkout` from non-allowlisted origin returns CORS error (C-5 fixed)
6. [ ] End-to-end Stripe checkout: create event → hit paywall → complete $49 → `paid_at` set → Pro features unlock immediately
7. [ ] Free tier ceilings (3 routes, 30 POIs) trigger UpgradeModal with correct trigger copy
8. [ ] Custom branding, live tracking, Ops Center, live-status POIs, all-sponsors visibility all work on a paid event
9. [ ] "Made with Hereday" footer hidden on paid event public page + checklist PDF
10. [ ] Production smoke test on hereday.io after deploy
