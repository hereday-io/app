# PRD: Organizer Experience Separation

**Status:** Draft · 2026-04-18
**Author:** Product team (Claude + Kevin)
**Problem owner:** Kevin

---

## Problem

Hereday's surfaces today mix organizer-facing and participant/spectator-facing concerns on the same page. Every new organizer feature ships onto the public runner/watch views by default because that's where the live map already is — and the public page keeps getting heavier as a result.

Recent examples of the bleed-through:
- **Live-status POIs** shipped their status row + dot overlay on the public popover, with the explicit intent of giving the organizer confirmation that volunteers are updating. Runners don't need to know *who* updated a status or when they last pinged.
- **Sponsor analytics** lives in a sheet accessed from Dashboard — the access pattern is fine, but the organizer has to remember that the "stats" sheet contains sponsor data and the public view contains the sponsor markers, and those are two different places.
- **Scout review** is a banner inside the editor — awkward because "review pending submissions" isn't really an editing task.

If we keep this trajectory, the public page becomes the default catch-all for any new feature, and the runner experience degrades under the weight.

---

## Principle

Each surface has a single audience and a single job.

| Surface | Audience | Job |
|---|---|---|
| `/event/:slug` (runner / watch) | Participants + spectators | Find their way, see key info, fast |
| `/editor?id=...` | Organizer | Edit content (routes, POIs, branding) |
| `/dashboard/events/:id` (NEW) | Organizer | Monitor event operations during + around race day |
| `/v/:token` | Volunteers | Report POI statuses, drop pins |

The rule: **if a feature answers a question only the organizer cares about, it doesn't live on the public view.**

---

## Current state (what exists today)

### On the public runner/watch views
- Route rendering, mile markers, weather forecast
- POI markers with popover
- POI status indicators (dots, popover row) — ⚠️ organizer-oriented details currently showing here
- Subscribe button
- Share button

### On the editor
- Route builder, POI placement, branding
- Autosave, publish toggle
- Scout review banner (⚠️ ops concern, not editing concern)
- Scout link dialog
- Status link dialog (NEW)
- Upgrade/paywall flow
- Event tour, keyboard shortcuts

### On the dashboard
- Event list grid
- At-a-glance stats (4 cards)
- Event analytics sheet (opens from dropdown per event) — contains views, subscribers, QR, tracking, sponsor activity

### Scattered organizer concerns (no unified home)
- Volunteer link generation → editor dialog
- Scout review → editor banner
- Event analytics → dashboard sheet
- Current POI statuses → nowhere visible to organizer today
- Status history → nowhere visible today
- Subscriber list → not visible; we only know the count
- Sending updates to subscribers → not built

---

## Proposed solution

A new **Event Ops Center** at `/dashboard/events/:id`. One page that is the organizer's home for everything happening on a single event after it's been edited and published.

The editor stays focused on editing. The public view stays focused on participants. The dashboard grid stays focused on "which of my events." Ops center fills the gap: "what's happening on this one event."

### What's on the Ops Center (MVP)

**Header strip**
- Event name, date, city
- Status chip: Live / Draft + Pro / Free
- Primary actions: Open editor · Copy share link · View live · Generate volunteer link · Send update (stubbed for v2)

**Live operations column (left, primary)**
- **Live statuses panel** — every POI with a status, live-updating via existing `usePoiStatuses` subscription
  - Grouped: "Needs attention" (low / closed / moved) pinned first, then "Reported open" collapsed
  - Each row: POI icon + title + state pill + "updated 5 min ago by Kevin" + optional note + "Fly to" button (opens editor focused on that POI)
  - Empty state when no reports: "No volunteer updates yet. Share the volunteer link above."
- **Scouted POIs panel** — pending review queue (moves from today's editor banner)
  - "Approve & place" / "Approve as-is" / "Dismiss" per row
  - Empty state when zero: hidden entirely

**Analytics column (right, secondary)**
- Shrunk version of EventAnalyticsSheet's content
- Keeps the 4 stat cards (views, subscribers, QR, tracking)
- Keeps the views-over-time chart
- Keeps the sponsors card when sponsors are configured
- Click-through "Full analytics →" if we want a deeper report later

**Activity feed (footer, tertiary)**
- Flat timeline of recent events: "Kevin marked Water Station Low — 2 min ago" / "New subscriber: bob@example.com — 14 min ago" / "Scouted: Aid Station by Sarah — 32 min ago"
- Powered by the existing `product_events` + `poi_status_history` + `event_subscribers` tables
- Last 50 entries, scrollable

### What moves OFF the public view

Simplify POI popover on public runner/watch:
- **Current state** (dot color) **stays** — runners genuinely benefit from knowing a water station is low
- **Metadata** (who updated, when, full note) **goes** — the organizer's audit trail shouldn't clutter the participant's map popover
- After simplification, the public popover's status row shrinks to just a colored pill: "Low · running low" (truncated note OK for runners) or just "Closed"

### What stays in the editor

- All content editing (routes, POIs, branding) — unchanged
- Volunteer / scout link dialogs — unchanged (they're author tools)
- Upgrade / paywall flows — unchanged
- The "Generate volunteer link" button inside `PoiEditPopover` — unchanged (contextual entry)

### What stays in the dashboard grid

- Event list — unchanged
- At-a-glance stats — unchanged
- Dropdown actions per event — unchanged, but **"View stats" becomes "Open ops center"** and routes to `/dashboard/events/:id` instead of opening the sheet

### Deprecated

- `EventAnalyticsSheet` as a side-sheet. Its contents move into the Ops Center analytics column. The sheet can be retired once the Ops Center ships.
- Scout review banner in the editor. Moves to Ops Center. Editor no longer shows pending scouted POIs inline — we add a small badge in the editor topbar saying "N pending scouted POIs · open in Ops Center" as a breadcrumb, but the review happens on the Ops Center.

---

## MVP (v1, ~1 week)

Ship order:
1. **Route + scaffold** (0.5d) — `/dashboard/events/:id` route, page shell, header strip, navigation from dashboard
2. **Live statuses panel** (1d) — pulls from `poi_statuses`, uses existing `usePoiStatuses` hook, "Needs attention" sorting
3. **Move scouted review** (1d) — relocate ScoutReviewPanel to new page, update dashboard/editor entry points
4. **Analytics column** (0.5d) — port the 4 stat cards + sponsors card + chart out of EventAnalyticsSheet
5. **Public popover cleanup** (0.5d) — drop the organizer metadata from the status row; keep the state pill + short note only
6. **Activity feed** (1d) — new query aggregating product_events + poi_status_history + event_subscribers into a unified timeline
7. **Dashboard wiring** (0.5d) — "View stats" → "Open ops center"; deprecate EventAnalyticsSheet route of entry
8. **Polish + test** (0.5d) — empty states, mobile responsive, loading skeletons

~5 days focused. Nothing new on the Supabase side; entirely frontend + route additions.

---

## Later (v2+)

- **Send update composer** (gated on email provider integration — see feature_roadmap.md)
- **Status history full timeline** with filtering by POI / volunteer / date range
- **Subscriber list view** (who's subscribed, source attribution, unsubscribe anyone)
- **Organizer status override** — let organizer change a POI's status directly from the Ops Center (not just via volunteer link)
- **Volunteer roster** — named volunteers per event, assign volunteers to POIs, track who's been active vs silent
- **Export / print race-day ops sheet** (single-page PDF with every POI's current status, for the race director's clipboard)
- **Real-time push notifications to organizer** when a status goes to "closed" (urgent escalation)

---

## Success metrics

How we know the split is working:

1. **Public view stays clean** — we can ship new organizer features for 6 months without adding anything to `/event/:slug`. That's the core commitment.
2. **Ops Center adoption** — in telemetry, organizers who publish a Pro event open the Ops Center ≥1x per event (tracked via new `ops_center_viewed` product_event).
3. **Status updates yield visible behavior** — when a volunteer reports a POI status, the organizer views the Ops Center within 1 hour (→ means the live panel is useful)
4. **Scouted POI processing time** — median time from submission → approve/dismiss decreases after the move from banner to Ops Center (hypothesis: dedicated surface = faster triage)

---

## Risks & tradeoffs

1. **Feature duplication during transition.** While we're moving scout review and analytics from their current homes to the Ops Center, both exist temporarily. Mitigate with a single release that deletes the old entry points; don't ship in halves.
2. **Mobile access.** Organizers on race day are on their phones. The Ops Center must be mobile-first (or at least not hostile) from day one. Don't ship a desktop-only grid and hope nobody looks on mobile during the race.
3. **Route / URL structure.** `/dashboard/events/:id` nests under dashboard, which means it requires auth and the dashboard's layout context. If we ever want a shareable "ops" URL for co-organizers, that's a bigger auth problem. Defer but note it.
4. **Public popover simplification might annoy people testing.** The "updated 3 min ago by Kevin" line was added in live-status v1. Removing it from the public view means losing visible progress. We replace the win elsewhere (Ops Center shows it prominently), but change communication matters.
5. **Activity feed query performance.** Unifying three tables (`product_events`, `poi_status_history`, `event_subscribers`) into a single timeline requires careful indexing. MVP scope: polled 30s query with LIMIT 50 per source, merged client-side. If it gets slow, add an aggregate view in SQL.
6. **Nothing to show for free events.** Free tier has no sponsor analytics, no Pro-only metrics. The Ops Center needs a compelling free-tier layout too; otherwise Free organizers bounce.

---

## Resolved decisions (2026-04-18)

- **Access gate: published events only.** Draft events don't show the Ops Center — there's nothing to operate on yet. The dashboard grid's dropdown shows "Open ops center" only when the event is published. Gives us a clean activation moment: publish → unlock ops.
- **Dashboard quick-peek stays.** Keep the simple `EventAnalyticsSheet` accessible from the dashboard dropdown (renamed to something like "Quick stats") for the common "what's the number this week" glance. The full Ops Center at `/dashboard/events/:id` is the deep surface. Two entry points, matched to different needs:
  - Quick stats sheet → "I just want to see views / subscribers / sponsor clicks without leaving the dashboard"
  - Ops Center page → "I'm actively running or about to run this event"
- **URL: `/dashboard/events/:id`** — nested under dashboard, auth-gated by the same wrapper, consistent with the rest of the authed app shell.

## Paywall gate

**v1: Pro-only.** Free events show a locked-state preview with an upgrade CTA; published Pro events get full access.

This is not a new SKU above Pro — Hereday stays on the "$49 one-time per event, no subscription" model per `feature_roadmap.md`. Ops Center becomes a headline Pro feature: "Unlock this event to get live status, volunteer activity, and analytics during race day."

**Future revisit:** if telemetry shows organizers running 3+ events/year heavily using Ops Center features (volunteer management, activity feed, future send-update composer), that's a real signal to introduce an **Operator / Annual tier** above per-event Pro. The feature set is pre-scoped to move there cleanly:
- Free → event publishing only, no Ops Center
- Pro ($49/event) → Ops Center for that event, race-day scope
- Future Operator tier (TBD pricing) → cross-event rollups, volunteer roster persistence, send-update quotas, unlimited tokens

Hold on the Operator tier until we have paying Pro customers + actual usage data. Creating tiers on a hypothesis leads to arbitrary lines; creating tiers on usage leads to ones that map to how customers actually think.

## Open questions

- How do we handle multi-event dashboards for organizers with a **series** (Crystal Lake 5K 2026, 2027, 2028)? Ops Center shows one event — is there a series-level rollup later? (Defer; park for v3, potentially part of the future Operator tier.)
- **Locked-state UX for Free events** — show a blurred preview? A screenshot? A feature list with "Unlock — $49" button? Needs design once we build the page.

---

## Not doing (explicitly out of scope)

- Team / multi-admin accounts. Still parked per `feature_roadmap.md`.
- Native app for organizers. Parking-lot item.
- Organizer Slack / SMS notifications. Consider after email provider lands.
- Public-facing "live ops" view ("watch this event happen") for armchair spectators. Separate project, different audience.
