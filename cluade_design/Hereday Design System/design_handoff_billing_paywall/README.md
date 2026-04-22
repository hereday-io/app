# Handoff: Billing & Paywall

## Overview

This bundle adds **two billing surfaces** to the Hereday app:

1. **Billing page** — a new authenticated route at `/billing` where organizers manage their per-event Pro unlocks, view purchase history, update the card on file, and redeem promo codes.
2. **Paywall modal updates** — minor tweaks to the existing `src/components/UpgradeModal.tsx` to add reinforcing microcopy and a promo-code field.

Both surfaces respect Hereday's existing pricing model: **one-time $49 per event, no subscription**. The billing page is shaped around that — it does not look like a SaaS subscription console.

---

## About the design files

The HTML files in this bundle are **design references, not production code**. They show intended look, layout, copy, and behavior using inline styles + the project's existing CSS tokens (`colors_and_type.css`). Your job is to **recreate them in the Hereday codebase** using:

- React + TypeScript (existing stack)
- shadcn/ui primitives already in `src/components/ui/*`
- Tailwind utility classes (config in `tailwind.config.ts`)
- Lucide icons via `lucide-react`
- Supabase client + edge functions for any new server-side calls
- Stripe Checkout for the purchase flow (already wired via `create-checkout` edge function — see `src/components/UpgradeModal.tsx`)

Do **not** copy the inline styles or the bespoke SVG markup verbatim. Match the existing patterns from `src/pages/Refund.tsx` (header/footer chrome), `src/pages/Dashboard.tsx` (event row pattern), and `src/components/UpgradeModal.tsx` (paywall copy + Stripe call site).

## Fidelity

**High-fidelity.** Colors, typography, spacing, and copy are final. Recreate pixel-perfectly using the design tokens already in `src/index.css` and `tailwind.config.ts`.

---

## What's in this bundle

| File | What it is |
|---|---|
| `billing-page-v2.html` | The full Billing page. **Use this version** — it includes promo code support and the proper Stripe branding. |
| `billing-page.html` | Earlier v1 of the same page, no promo code, simpler Stripe footer. Kept for reference. |
| `paywall-modal.html` | All four `UpgradeModal` triggers rendered side by side so you can verify copy and feature-list parity. |
| `colors_and_type.css` | Design tokens — already present in your project. Linked here so the previews render standalone. |
| `screenshots/` | (Optional — not included by default. Ask the designer if you want them.) |

---

## Screen 1 — Billing page (`/billing`)

### Purpose
A signed-in organizer's home for everything money-related. Lets them: (a) see the unlock status of every event they own, (b) unlock more events, (c) download Stripe receipts, (d) update the card on file, (e) redeem promo codes.

### Route + auth
- New route: `/billing`
- Auth: **required** (use the same auth wrapper as `/dashboard`)
- Add a "Billing" link to wherever the existing settings nav lives (Dashboard header user menu is fine if there isn't a settings page yet).

### Layout
- Sticky top header — copy structure from `src/pages/Refund.tsx` (logo left, nav + avatar right). Active nav link is "Billing".
- Main content: `max-width: 1180px`, padding `36px 24px 64px`.
- Breadcrumb row (Settings › **Billing**) above the H1.
- H1 "Billing" + lede paragraph.
- An **information callout** (blue-tinted) reinforcing the per-event model. **This callout is load-bearing for the brand voice — do not remove or weaken it.**
- A **two-column grid**: main column (events list + purchase history) on the left, side rail (lifetime spend, payment method, promo code, help) on the right.
- Footer: identical to `src/pages/Refund.tsx`.

### Side rail — sticky
The aside on the right uses `position: sticky; top: 88px;` so it stays visible while the main column scrolls.

### Events list — main column

Pulled from the same data source as Dashboard's events. For each event:

- **Left bar (4px):** colored stripe — `hsl(217 91% 50%)` if the event has Pro (`is_paid = true`), `hsl(152 60% 42%)` if Live but Free, `hsl(var(--border))` if Draft.
- **Body:** event name + status chips (Live / Draft + Pro / Free plan), then a meta row showing date, location, route count, marker count. If the event is **Free and within 8 markers of the limit**, append a warning span in `hsl(38 92% 40%)`: "8 markers until limit".
- **Status column (right side):** if Pro, show "Unlocked {date}" + "Receipt #hd_xxxx · $XX.XX". If Free, show "Not unlocked" / "Free features only" in muted text.
- **Action button:**
  - Free events → primary button "Unlock — $49" (blue, with crown icon). Opens `UpgradeModal` with `trigger="publish"` and the event's ID.
  - Pro events → outline button "Receipt" (download icon). Calls a new edge function `get-receipt` (see below).

### Purchase history — main column

Below the events list, a card titled "Purchase history" with chronological transactions. Each row:
- Event name + (optional) green promo code chip if a code was applied
- Date + card brand/last-4 + (optional) "X% off applied" text
- Amount (right-aligned, tabular numerals, `$49.00` — or struck-through original + new price if a promo was applied or refunded)
- State chip: "Paid" (green) or "Refunded" (gray, struck-through amount)
- PDF download button on the right

Data source: list `Stripe Charge` objects for the customer. New edge function: `list-charges` (mirror the pattern of `create-checkout`).

### Side rail — Lifetime spend
Big tabular number showing total paid (excluding refunds). Sub-line: "Across N unlocked events. You'll never be charged unless you unlock another event." Below it, a 2-column split showing **Unlocked** count and **Refunded** count.

### Side rail — Payment method
- Single card on file (Hereday only ever stores one default Stripe `PaymentMethod` per customer).
- Render: card brand mark (Visa / Mastercard / Amex blocks) + masked PAN + expiry + "Default" badge.
- Two equal-width buttons under the card: **Update** (opens Stripe's hosted customer portal in a new tab → use Stripe Billing Portal) and **Remove** (confirmation modal → detaches the PaymentMethod).
- Below that, a footer pill: lock icon + "Powered by [Stripe wordmark]" — use the official Stripe wordmark SVG (included inline in `billing-page-v2.html`), color `#635BFF`, height 14px.

### Side rail — Promo code (NEW)
- Input field (uppercase, monospace styling for typed codes) + "Apply" button.
- When a code is active, show a green "applied" card above the input: green checkmark, code in monospace, expiration sub-text, and an X to remove.
- Server: validate + store on the customer record. New edge function: `apply-promo` (POST `{ code }` → returns `{ valid, percent_off, expires_at, error? }`).
- When checkout starts, pass the active promo code to `create-checkout` so Stripe applies it as a Coupon at checkout time.
- Microcopy: "Got a code from a partner race or community? Redeem it here — it'll auto-apply to your next unlock."

### Side rail — Need help
Short paragraph with refund window summary + a `mailto:legal@hereday.io` link styled with a small external-link icon. Refund window text comes from `src/pages/Refund.tsx` — keep the wording consistent.

---

## Screen 2 — Paywall modal updates

**The component already exists** at `src/components/UpgradeModal.tsx` with the four triggers (`routes`, `pois`, `branding`, `publish`). The handoff design only changes a few things:

1. **Add microcopy under the CTA** (when `PAYMENTS_LIVE = true`):
   ```
   One-time payment. No subscription, no auto-renew.
   ```
   Style: `text-xs text-muted-foreground text-center mt-2`. Bold the first sentence.

2. **Add an inline promo code link** below the "Maybe later" button:
   ```
   Have a code? [Redeem on Billing →]
   ```
   The link should `navigate('/billing#promo')`.

3. **Pre-fill the active promo code** when opening Stripe Checkout. Read it from the customer record (added by the new `apply-promo` edge function) and pass it to `create-checkout` as `body.discountCode`. The existing edge function needs to be updated to forward this as a Stripe `discounts: [{ coupon }]` parameter.

That's it for the modal — no visual restructure.

---

## Components & design tokens

**Reuse existing:**
- `Button`, `Dialog`, `Input`, `Card`, `Badge`, `Tooltip` from `src/components/ui/*`
- Color tokens — all values come from `src/index.css` CSS variables and `tailwind.config.ts`
- Type — `font-display` (Space Grotesk) for headings/buttons/numerics, `font-body` (DM Sans) for prose
- Lucide icons (already in `package.json`)

**New design tokens — none needed.** Every value used in the mocks already exists in your tokens.

**Specific Lucide icons used:**
- `Crown` — paywall medallion + Unlock buttons
- `Download` — Receipt + PDF buttons
- `Info` — top callout
- `ChevronRight` — breadcrumb
- `Lock` — Stripe footer pill
- `Check` — feature list + applied promo
- `X` — modal close + remove promo
- `ArrowUpRight` — external email link

**Stripe wordmark:** SVG path is inline in `billing-page-v2.html` (search for `class="stripe-wordmark"`). Lift the path data verbatim and wrap it in a small React component `<StripeWordmark />`. Color via `currentColor`, default `#635BFF`. Per Stripe's brand guidelines, the wordmark should never be recolored to brand colors — keep it lilac on neutral backgrounds.

---

## State management

New state (use whatever pattern matches the rest of the app — likely React Query + Supabase hooks):

| State | Source | Mutation |
|---|---|---|
| `events` (with `is_paid`, `unlocked_at`, `receipt_id`) | existing `events` table | none — already exists |
| `charges` | new edge function `list-charges` (Stripe API) | none |
| `defaultPaymentMethod` | new edge function `get-payment-method` (Stripe API) | `update` → opens Stripe Billing Portal in new tab; `remove` → calls `detach-payment-method` edge function |
| `activePromoCode` | new column on `customers` table (or `stripe_customer_metadata`) | `apply-promo` edge function (validates + stores), `remove-promo` edge function |

---

## New edge functions to create

Mirror the pattern of the existing `create-checkout` function (Supabase Edge Function calling Stripe SDK with the secret key).

1. **`list-charges`** — `GET` → returns the customer's Stripe Charges, sorted desc by date. Include amount, currency, status, card brand/last-4, receipt URL, applied coupon code.
2. **`get-receipt`** — `GET ?charge_id=xxx` → returns the Stripe-hosted receipt URL for download.
3. **`get-payment-method`** — `GET` → returns the default `PaymentMethod` for the customer (brand, last-4, exp).
4. **`open-billing-portal`** — `POST` → creates a Stripe Billing Portal session and returns the URL.
5. **`detach-payment-method`** — `POST` → detaches the customer's default `PaymentMethod`.
6. **`apply-promo`** — `POST { code }` → validates the code against Stripe's Coupon list, stores it on the customer record if valid, returns `{ valid, percent_off, expires_at, error? }`.
7. **`remove-promo`** — `POST` → clears the active promo code from the customer record.
8. **Update `create-checkout`** — accept an optional `discountCode` in the body and forward as `discounts: [{ coupon }]` to Stripe.

All functions: require auth (existing pattern), look up the user's `stripe_customer_id` from the `customers` table, fail safely with a 4xx + JSON error.

---

## Interactions & behavior

- **Unlock button click** → flush any pending edits → `create-checkout` (with `discountCode` if active) → `window.location.href = data.url` (Stripe Checkout).
- **On return from Stripe** → existing webhook flow flips `is_paid = true`. The Billing page should refetch on mount so the row shows "Unlocked {today}" immediately.
- **Update card** → `open-billing-portal` → open returned URL in a new tab.
- **Apply promo** → `apply-promo` → if valid, optimistically render the green "applied" card; if invalid, show a small error below the input in `hsl(0 72% 55%)`: "That code isn't valid or has expired."
- **Receipt PDF** → fetch `get-receipt` → open returned URL in new tab (Stripe-hosted PDF).

### Loading & empty states
- Events list: skeleton rows (4 of them) while loading.
- Purchase history: if zero charges, show a single muted line: "No purchases yet — your first event is on the house." Don't render an empty card.
- Payment method: if no card on file, replace the card display with a single "+ Add payment method" button (also opens Stripe Billing Portal).

### Mobile / responsive
- The two-column grid collapses to single-column under `1024px`. Side rail becomes its own section below the main column.
- Event rows: status column wraps under the body on small screens; action button stays on its own row.

---

## Copy reference (verbatim)

These strings are final. Do not paraphrase.

| Where | Copy |
|---|---|
| H1 | "Billing" |
| Lede | "Hereday Pro is a one-time $49 upgrade per event — **no subscription, no auto-renew**. Manage unlocked events, download receipts, and update the card on file for future unlocks." |
| Top callout title | "You'll only see a charge here when you unlock an event." |
| Top callout body | "Free events stay free forever. Upgrades unlock Pro features on a specific event — they don't renew and don't transfer. Got a promo code? Apply it on the right. See our [refund policy] for details on how refunds work." |
| Lifetime spend sub | "Across N unlocked events. You'll never be charged unless you unlock another event." |
| Promo description | "Got a code from a partner race or community? Redeem it here — it'll auto-apply to your next unlock." |
| Promo invalid error | "That code isn't valid or has expired." |
| Modal microcopy | "**One-time payment.** No subscription, no auto-renew." |
| Empty purchase history | "No purchases yet — your first event is on the house." |
| Stripe footer | "Powered by [Stripe wordmark]" |

Refund language and contact email — already in `src/pages/Refund.tsx`. Keep consistent.

---

## Implementation checklist

- [ ] Create `src/pages/Billing.tsx` with header/footer pattern from `Refund.tsx`
- [ ] Add `/billing` route in `src/App.tsx` (or wherever the routes live), auth-protected
- [ ] Add "Billing" link to user menu / settings nav
- [ ] Build the 8 edge functions listed above
- [ ] Add `active_promo_code` (and optionally `active_promo_expires_at`) columns to `customers` table
- [ ] Update `create-checkout` to accept + forward `discountCode`
- [ ] Update `UpgradeModal.tsx`: add the two microcopy lines + the promo Redeem link
- [ ] Wire React Query hooks for `events`, `charges`, `paymentMethod`, `activePromo`
- [ ] Implement Stripe Coupon validation in `apply-promo`
- [ ] Test end-to-end: unlock → return → row flips to Pro → receipt downloadable
- [ ] Test promo flow: apply code → unlock → Stripe checkout shows discount → receipt shows discounted amount
- [ ] Verify mobile layout collapses cleanly under 1024px

---

## Files in this bundle

- `billing-page-v2.html` — **primary reference** for the Billing page
- `billing-page.html` — v1 (no promo, simpler Stripe footer) — kept for diff reference
- `paywall-modal.html` — reference for the existing UpgradeModal's 4 triggers
- `colors_and_type.css` — design tokens (already in your repo as `src/index.css`)
- `assets/` — `hereday-logo.png` and `browserlogo.png` referenced by the HTML headers/footers
