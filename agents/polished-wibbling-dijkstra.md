# Hereday — UX Audit & Improvement Backlog

## Context

Hereday is live on hereday.io with the Mobile POI Scout shipped and the billing schema migrated. The product is functional and the editor is unusually polished for a solo SaaS, but the app is about to enter its paid-Stripe phase and needs to tighten several rough edges before money starts landing. This audit is a full sweep against [UX_PATTERNS.md](UX_PATTERNS.md) (philosophy: premium / effortless / clean / fast; principles: map first, reduce cognitive load, default to beautiful, mobile first for viewer).

Findings are based on a read-only tour of the auth flow, dashboard, event creation, editor, and public viewer — no assumptions about features that don't exist. Each friction point names files and line ranges so any fix can start from a known location.

The strongest takeaway: **the editor is already Apple-level in many places** (autosave chip, coach-mark, snap-to-route, POI emoji picker). The public viewer and first-run surfaces are where the premium bar slips, and that's also where most of the money-path friction lives (landing → create → publish → share → viral loop).

---

## 1. Workflow Map

### First-time user (cold → paying)
`/` landing → `/signup` (Google or email + display name + 6-char password) → email verify screen → `/dashboard` empty state → quick-create (name only) or "Advanced" modal (name/city/date) → `/editor?id=…` → draw route → drop POIs → Publish → share popover with QR → soft upsell modal (free tier).

### Returning organizer
`/login` → `/dashboard` with event cards (status badge, stats, weather, "Duplicate for 2027" on past events) → click card → editor → autosave while editing → optional re-publish.

### Route editing loop
Open editor → (first time only) coach-mark "Click anywhere to start your route" → click to place waypoints → double-click to finish → auto-place Start/Finish POIs → resume route or add new one → POIs via sidebar category picker → drag to reposition → click for popover edit.

### POI creation loop
Pick type in sidebar (emoji grid) → cursor tooltip updates → click on map → POI dropped (snap-to-route if enabled) → popover opens on subsequent clicks for edit/delete → batch mode via shift-click.

### Publish & share
Click "Publish" in top bar → instant publish with no pre-check → toast "Event is live" → "Live" pill + "Share" button appear → share popover has URL copy + QR + "Preview" link → 600ms delay then free-tier upsell modal.

### Participant / spectator (mobile)
QR or link → loading spinner → **role picker screen** (Running vs Spectating, full screen, covers map) → map view (full screen, glass top bar, collapsible bottom sheet with elevation/legend/weather) → tap POI → popover with title/description/(conditional) directions link.

### Mobile POI Scout (shipped)
Desktop generates scout token → `/scout/:token` on phone → read-only map with existing routes/POIs dimmed → center crosshair + "Drop pin here" → category → type → title → submit → queued offline if needed → desktop review banner → accept/reject each POI on a floating right-side panel.

---

## 2. UX Audit Findings (by workflow)

### 2.1 Landing & Auth
**What works**
- Landing is a real marketing page with hero, 6-feature grid, 3-step "how it works", pricing, use cases, and a bottom CTA. Not a login wall.
- Google OAuth is first-class, with email/password as fallback.
- Explicit email-verification confirmation screen (not a silent pending state).
- Toast-driven error messaging; buttons disable and show progress text ("Creating account…").

**Gaps vs UX_PATTERNS**
- **No interactive demo or video.** Hero has a static PNG of a map. Landing needs to *show* the editor moving — a 10-second GIF/Lottie of a route drawing itself would do the heavy lifting.
- **Display name is collected but never shown.** Top-right avatar shows email initials, not the name. Feels like a dead input.
- **No password strength meter.** `minLength={6}` is the only signal. Premium SaaS (Stripe, Slack) show live strength.
- **No ToS/Privacy links on the signup form itself** — only in the page footer. That's a minor legal/trust miss.

### 2.2 Dashboard
**What works**
- Empty state is explicit (dashed card, MapPinned icon, "Create your first event").
- Event cards are information-dense in a good way: status accent bar (green/gray), route/POI counts, weather badge if date+coords exist, "Duplicate for [year]" for past events (killer retention lever).
- Stats header (Published/Drafts/Routes/POIs) when events exist.
- Three-dot overflow menu keeps secondary actions (Duplicate, Delete, Stats, Edit Details) out of the main row.

**Gaps vs UX_PATTERNS**
- **Quick create only takes a name.** No city, no date, no map center. The editor then loads at zoom 4 (continental US). The aha moment is delayed by every second the user spends searching for their actual city. **This is the single biggest first-run friction.**
- **"Advanced" button doesn't signal it opens a modal.** No chevron, no "More options…" affordance. Users who want to add a city on create flow miss it.
- **No search/filter on the dashboard.** Fine at 3 events, broken at 30. A race series organizer running 10 races/year hits this immediately.
- **Draft events advertise "Copy share link" as a menu option that silently does nothing useful** (there's no published URL yet). Should be disabled with a tooltip, not invisibly broken.
- **No "example event" or template.** First-timers have no way to see what a good event looks like before committing to build one from scratch.
- Reference: [src/pages/Dashboard.tsx](src/pages/Dashboard.tsx)

### 2.3 Editor — first load
**What works**
- Non-intrusive `EditorCoachMark` floats above the map with "Click anywhere to start your route" and auto-dismisses after first waypoint (localStorage gated per user).
- Contextual cursor tooltip: "Click to start" → "Click to add point · Double-click to finish" → "Click to place Water Station".
- Five-step opt-in `EditorTour` behind the Help button, not forced.
- Initial view fits existing routes if data exists; otherwise falls back to the continental view.

**Gaps**
- **Continental zoom-4 view on brand-new events** is the disorienting counterpart to the dashboard quick-create issue. Even if the user skipped the city field, the editor should fall back to the browser geolocation API (with a clear permission prompt and a graceful default).
- Reference: [src/pages/RouteEditor.tsx](src/pages/RouteEditor.tsx)

### 2.4 Editor — top bar
**What works**
- Inline event-name edit with pencil affordance on hover.
- Save status chip is the standout UX moment of the whole app: Cloud icon + relative time ("Saved 5m ago"), amber "Unsaved — save now" when dirty, spinner while saving, red CloudOff "Save failed — retry" on error, all clickable to force-save. This is Apple-level.
- Publish button → Live pill + Share button swap is a clean two-state toggle. Unpublish is behind a two-step danger-zone confirm.

**Gaps**
- **Icon-only Undo / Clear / Help / Scout buttons** have only hover tooltips. Help in particular is where the tour lives — and tours that nobody finds don't exist.
- **No auto-retry on save errors.** The retry pattern is user-initiated. A user who keeps editing through a silent network blip and then closes the tab loses work (`beforeunload` guard fires but the user may dismiss it).
- **"Saved X ago" updates every 15s** — fine, but drifts once the tab is inactive. Should refresh on visibility change.
- Reference: [src/components/editor/EditorTopBar.tsx](src/components/editor/EditorTopBar.tsx)

### 2.5 Editor — side panel & route building
**What works**
- Single 240px left sidebar with collapsible Routes / Places / Branding / Basemap sections. No right panel, no tabs — cognitively light.
- Route cards show drag handle, color picker, name input, distance, visibility toggle, delete. Finished routes show CheckCircle + "Resume" link.
- Snap-to-roads is on by default; a floating SnapModePill (bottom-left) shows/toggles the current mode. Incremental snap-per-segment (not whole-route), with silent fallback to a straight line when the Directions API fails.
- Auto-place Start/Finish POIs on route finish; excluded from paywall count.

**Gaps**
- **Silent snap failures.** When the Directions API fails, the route quietly becomes a straight line. Status bar says so but the visual is identical to a successful snap. User can't tell their route is wrong.
- **No pre-publish validation.** An event with 0 routes and 0 POIs can publish. The share flow then surfaces a blank map to the world.
- Reference: [src/components/editor/RouteBuilderToolbar.tsx](src/components/editor/RouteBuilderToolbar.tsx)

### 2.6 Editor — POI creation
**What works**
- Emoji-driven category picker is visual, memorable, playful — exactly the "default to beautiful" pattern.
- Shift-click batch mode for dropping many of the same type.
- Bottom-center pill ("🌊 Click map to place Water Station · ✕") makes the armed state obvious.
- Click-edit popover rendered into the Mapbox popup via React portal — preserves shadcn styling, clean lifecycle.
- Draggable markers with snap-to-route on drop.

**Gaps**
- **POI delete has no confirmation.** Destructive action inside a popover, single-click, no undo visible. Should either soft-confirm in-place ("Tap again to delete") or show an Undo toast for 5s.
- **Popover opens on click rather than before commit.** Users can't preview the fields before dropping the POI. Less of an issue given the contextual arming pill, but still a small cognitive jump.

### 2.7 Editor — publish flow
**What works**
- Two-click publish (button → toast → Live pill). No modal friction.
- Share popover has URL copy (2s "Copied!" confirm), QR code, preview link.
- Unpublish is a two-step danger-zone confirm with scary red copy — appropriate gravity.
- 600ms soft upsell delay after a free publish is a thoughtful, non-pushy pattern.

**Gaps**
- **No pre-publish checklist.** "Must have ≥1 route with ≥2 points" should block publish and surface the missing item. Without it, the viral loop starts broken.
- **Public URL is only visible post-publish.** Users can't see or customize the slug before committing. For branded races this matters ("spring-marathon-2026" vs "spring-marathon-2026-abc12").

### 2.8 Public viewer — entry, role picker, map
**What works**
- Full-screen immersive map on both runner and spectator views; glass top bar; collapsible bottom sheet with tabs (Elevation / Legend / Weather).
- Smart clustering with animated fly-to on cluster tap.
- Role preference is persisted in localStorage so returning visitors skip the role picker.
- `has_ended` auto-expiry renders a graceful `EventEndedView` ("Event wrapped. Thanks to everyone who showed up.") with an email capture CTA — not a 404.

**Gaps — biggest category in the audit**
- **Role picker covers the map before the user has seen it.** The hero moment of a public page is "here's the route"; we instead show a choice screen. Violates "map first." For first-time visitors on a phone tapping a QR code, the first second should be the map with a floating role selector, not a full-screen interstitial.
- **Start/Finish markers are not visually distinct.** They render as plain emoji POIs requiring a tap to identify. UX_PATTERNS.md §Start/Finish literally says: *"Must be instantly recognizable. Use strong visual markers. Avoid subtle styling."* This is a direct violation. Apple Maps labels start/finish inline.
- **No per-event OG image.** Every shared link to SMS/Instagram/iMessage shows the same generic `og:default.png`. This single change would do more for viral growth than any other in the audit.
- **No OS `prefers-color-scheme` detection on public pages.** An iPhone user with OS dark mode opens a light-mode page. Premium miss.
- **"Get directions" link in POI popover is 11px gray text.** Touch-unfriendly and easy to miss for spectators trying to find parking with gloved hands at 6am.
- **No share button on the public map itself.** Participants can't share the event forward. The only share flow lives in the organizer's editor.
- **No network-retry UI.** If the Supabase call fails, the view silently empties. No retry button.
- Reference: [src/pages/EventPublic.tsx](src/pages/EventPublic.tsx), [src/components/public/RunnerView.tsx](src/components/public/RunnerView.tsx), [src/components/public/PoiReadonlyPopover.tsx](src/components/public/PoiReadonlyPopover.tsx)

### 2.9 Mobile POI Scout (recently shipped)
**What works**
- Floating right-side review panel keeps the map visible (fixed after the earlier audit).
- Scouted pins render with a dashed amber ring and pulsing shadow — visually distinct from accepted POIs.
- Offline IndexedDB queue with online-event auto-flush.
- Crosshair-based drop keeps precision at map-center, not thumb-position.

**Gaps**
- **No scout-mode help text.** First-time volunteer has no idea what "scout mode" means. A one-line explainer ("Drop pins for your organizer to review — no login needed") at the top would eliminate confusion.
- **No "location quality" indicator.** When GPS accuracy is >50m, the user should know before they tap "Drop pin here" — otherwise they're saving a point that'll be useless.

---

## 3. Friction Points — Prioritized

| # | Severity | Workflow | Issue | Impact |
|---|---|---|---|---|
| F1 | 🔴 Critical | Dashboard → Editor | Quick-create gathers only the name; editor loads at zoom 4 (continental view) with no map context | Delays the "aha moment" by seconds-to-minutes; new users feel lost the first time they see the editor |
| F2 | 🔴 Critical | Public viewer | Full-screen role picker covers the map before it's ever shown — violates "map first" | Cold visitors (QR scanners) pay a tax before seeing the thing they came for |
| F3 | 🔴 Critical | Editor → Publish | No pre-publish validation (0 routes / 0 POIs can publish); share flow then exposes a blank map | Broken first-impression at the exact moment organizers share to their audience |
| F4 | 🟠 High | Public viewer | Start/Finish markers are indistinguishable from regular POIs (direct UX_PATTERNS violation) | Runners can't orient themselves at a glance; spectators can't find the finish line |
| F5 | 🟠 High | Share / virality | No per-event OG image — every SMS/Instagram share shows generic Hereday branding | Kills the viral loop; free SEO/social traffic left on the table |
| F6 | 🟠 High | Editor top bar | Icon-only Help / Scout / Undo / Clear buttons; tour is hidden behind an unlabeled icon | Power features (tour, scout) undiscoverable for new users |
| F7 | 🟠 High | Editor | Silent snap-to-route failures render as straight lines identical to freeform | Routes look correct but are actually broken along failed segments |
| F8 | 🟠 High | Editor save | Save errors have no auto-retry; silent data loss risk on flaky networks | Trust-destroying — contradicts the excellent autosave chip |
| F9 | 🟡 Medium | Dashboard | No search/filter; no pagination; cards sort only by recency | Race-series organizers (3+ events/year) hit this fast |
| F10 | 🟡 Medium | Editor POI | Delete has no confirmation, no undo toast | Destructive single-click inside a popover |
| F11 | 🟡 Medium | Public viewer | No OS `prefers-color-scheme` detection | Light theme stuck on dark-mode phones |
| F12 | 🟡 Medium | Public viewer | Supabase query failures fall through to an empty view; no retry button | Unrecoverable error state |
| F13 | 🟡 Medium | Signup | No password strength meter; display name collected but never shown | Trust + data-waste miss |
| F14 | 🟡 Medium | Public viewer POIs | "Get directions" link is tiny gray 11px text | Spectators miss a key affordance |
| F15 | 🟡 Medium | Event-ended | No "Notify me if this runs again" is actually there — but it's buried without context | Lost retention signal for seasonal races |
| F16 | 🟢 Low | Landing | Hero uses a static PNG, not a looping demo | Conversion lift left on the table |
| F17 | 🟢 Low | Editor | Public URL slug is only visible post-publish; no pre-commit customization | Branded races want to own their slug |
| F18 | 🟢 Low | Dashboard | "Advanced" button has no chevron/icon telegraphing a modal | Discoverability polish |
| F19 | 🟢 Low | Scout page | No "location quality" indicator; no one-line scout explainer | Phase-1 polish — acceptable but known |
| F20 | 🟢 Low | Public viewer | No public "Share event" button — share flow is organizer-only | Forward-sharing friction |

---

## 4. Recommended Improvements

### F1 — Quick-create must land the user on their map
**Before:** Dashboard input "Name your next event…" → Enter → editor at zoom 4, continental US.
**After:** Dashboard quick-create becomes a two-step inline affordance:
1. Text input "Name your event…" (as today)
2. As soon as a character is typed, a second field slides in: "Where? (city or ZIP)" with the existing Mapbox geocoder autocomplete
3. Enter commits both; optional date/tracking stay in "Advanced"

If the user skips the city field, `RouteEditor` falls back to `navigator.geolocation.getCurrentPosition` on mount with a graceful "Allow location to center the map on you?" explainer — and if denied, fits to whatever existing data the user's other events contain, or a stored "last editor center" from localStorage. **Never land on the continental view for a logged-in user.**

**Files:** [src/pages/Dashboard.tsx](src/pages/Dashboard.tsx), [src/pages/RouteEditor.tsx](src/pages/RouteEditor.tsx) initial-fit effect.

### F2 — Role picker becomes a floating sheet over the map
**Before:** Full-screen role picker (RouteEditor.tsx:210–245) hides the map.
**After:** Map renders immediately with a bottom sheet that peeks up 40% of the screen containing two tap targets: "I'm running 🏃" and "I'm spectating 👀". The user can dismiss the sheet by tapping the map directly, which implicitly chooses "spectator" (the lower-commitment default). Returning users skip the sheet as today.

Benefits: preserves the localStorage fast-path, restores "map first," and turns role selection into a *progressive-disclosure* moment instead of a wall.

**Files:** [src/pages/EventPublic.tsx](src/pages/EventPublic.tsx).

### F3 — Pre-publish validation
**Before:** Publish button is always enabled.
**After:** Publish is disabled (with a title tooltip) until the event has at least one route with ≥2 waypoints. On click of a disabled button, flash a toast: "Draw at least one route before publishing." If the user *has* a route but no POIs, the publish still succeeds but surfaces a non-blocking suggestion: "Your event is live. Want to add water stations or restrooms?" with a "Not now" dismiss.

**Files:** [src/pages/RouteEditor.tsx](src/pages/RouteEditor.tsx) `handlePublish`, [src/components/editor/EditorTopBar.tsx](src/components/editor/EditorTopBar.tsx) publish button `disabled` + `title`.

### F4 — Start / Finish must be instantly recognizable
**Before:** Auto-placed Start/Finish are plain emoji POIs.
**After:** Distinct renderer for `auto-start-*` and `auto-finish-*` markers:
- Larger (40×40px vs 28×28px)
- Route-colored border (2.5px)
- Inline text label underneath: "START" / "FINISH" (8-9px uppercase, tracking-wider, white-on-route-color pill)
- Subtle drop shadow to lift off the map background

On a multi-route event, each route gets its own colored start/finish pair so "where's the half-marathon start" is answerable at a glance. This is the single highest-impact public-viewer change.

**Files:** [src/components/public/RunnerView.tsx](src/components/public/RunnerView.tsx) marker render loop, [src/components/public/SpectatorView.tsx](src/components/public/SpectatorView.tsx) same, [src/lib/pois.ts](src/lib/pois.ts) if a new tone is needed.

### F5 — Per-event OG image
**Before:** `/index.html` ships a static `og:default.png`.
**After:** A Supabase edge function `event-og-image` takes an event slug, renders a 1200×630 PNG on demand (using `satori` or `@vercel/og` equivalents) with:
- Event name in the display font
- City + date
- A snapshot of the route drawn on a Mapbox static-image API call
- "Made with Hereday" watermark for free events

React server-inject the URL via a small HTML-injecting edge function on `/event/:slug` requests — or for a lighter first cut, a `<link rel="preload" as="image">` + client-side `<meta>` rewrite that at least updates the tab title and shows the image on *some* clients (iMessage will fetch it even from client-rendered meta). Stretch: cache the PNG in Supabase storage keyed by event updated_at.

This is a two-day project and is worth more than any other item in this audit for top-of-funnel.

**Files:** new `supabase/functions/event-og-image/`, [index.html](index.html) meta updates, [src/pages/EventPublic.tsx](src/pages/EventPublic.tsx) meta tag hydration.

### F6 — Label the top-bar tools
**Before:** Icon-only Undo / Clear / Help / Scout with hover titles.
**After:** Keep the icons but show text labels on wider viewports (`hidden lg:inline`). For Help specifically, move it to a labelled "Tour ▶" pill on the first visit (show the label for 5 seconds then collapse to icon-only unless there's hover). For Scout, the Compass icon stays but gets a subtle amber dot badge when there are `scoutedPois` pending — the same pattern as the review banner.

**Files:** [src/components/editor/EditorTopBar.tsx](src/components/editor/EditorTopBar.tsx).

### F7 — Snap failures must be visible
**Before:** Silent fallback to straight line; status bar blips a warning.
**After:** The straight-line fallback segment renders in a dashed, route-colored stroke (stroke-dasharray) with a small warning toast: "Couldn't snap this segment to roads — drag a waypoint to fix." On hover, a tooltip explains. The dashed style makes the failure spatial, not temporal.

**Files:** [src/pages/RouteEditor.tsx](src/pages/RouteEditor.tsx) route-line source/layer setup, around the `segmentCoordCounts` logic.

### F8 — Auto-retry save errors
**Before:** Save error → red chip → user must click.
**After:** On error, the save chip shows "Retrying in 3s…" with a countdown; retries up to 3 times with exponential backoff (3s / 6s / 12s). Only after all retries fail does it ask the user to click. `beforeunload` guard must also include a "Save failed — your changes aren't uploaded" prompt if the error state is active.

**Files:** [src/pages/RouteEditor.tsx](src/pages/RouteEditor.tsx) `handleSave` + save effect.

### F9 — Dashboard search & filter
**Before:** One chronological list.
**After:** Small search input in the stats row (ghost style, search icon, `cmd-k` shortcut wired for desktop). Filters by event name + city + slug. At ≥10 events, surface a "Status" segmented control above the list: All / Live / Draft / Past.

**Files:** [src/pages/Dashboard.tsx](src/pages/Dashboard.tsx).

### F10 — POI delete gets an undo
**Before:** Click trash → gone.
**After:** Click trash → marker disappears, Sonner toast appears for 5s with "POI deleted · Undo". Undo re-inserts the POI at its last coordinates. This matches the Gmail/Notion undo pattern and is cheap because the state is already in memory.

**Files:** [src/components/editor/PoiEditPopover.tsx](src/components/editor/PoiEditPopover.tsx) or the delete handler in [src/pages/RouteEditor.tsx](src/pages/RouteEditor.tsx).

### F11 — OS dark mode on public pages
**Before:** Light theme default, no system preference read.
**After:** On `EventPublic.tsx` mount, read `window.matchMedia('(prefers-color-scheme: dark)').matches` and apply the `.dark` class to `document.documentElement`. Listen for changes. Organizer-driven overrides (if the event chooses a specific theme) still take precedence.

**Files:** [src/pages/EventPublic.tsx](src/pages/EventPublic.tsx) — new mount effect.

### F12 — Network-error retry on public page
**Before:** Empty state if Supabase fails.
**After:** Distinct error card: "Couldn't load this event — check your connection" + "Try again" button that re-runs the query. Avoid the generic "Event not found" fallback which misleads users on intermittent failures.

**Files:** [src/pages/EventPublic.tsx](src/pages/EventPublic.tsx) error branch.

### F13 — Signup polish
**Before:** 6-char min password, no strength signal, display name unused.
**After:** Live strength meter (zxcvbn or a lightweight entropy estimator) that gates submission. Display name renders in the top-right avatar *and* the dashboard welcome header ("Welcome back, Kevin"). No code change needed — the data is already in `profiles.display_name`.

**Files:** [src/pages/Signup.tsx](src/pages/Signup.tsx), [src/pages/Dashboard.tsx](src/pages/Dashboard.tsx), [src/hooks/useAuth.tsx](src/hooks/useAuth.tsx).

### F14 — Directions link must be a button
**Before:** Small gray text link.
**After:** Full-width secondary button with pin icon: `[📍 Directions in Maps]`. At least `h-10` for finger targets. Only appears for logistics/support POIs as today.

**Files:** [src/components/public/PoiReadonlyPopover.tsx](src/components/public/PoiReadonlyPopover.tsx).

### F15 — Event-ended becomes a marketing surface
**Before:** "Event wrapped" screen with a buried subscribe form.
**After:** Reframe the top of the ended screen as: "**2026 Spring Marathon — wrapped.** Want to know when 2027 opens?" with a hero email input directly below. Also surface a "Recap" module with route distance + POI counts + weather on the day + organizer logo. This is a warm retention asset; treat it like one.

**Files:** [src/components/public/EventEndedView.tsx](src/components/public/EventEndedView.tsx).

### F16–F20 — Polish pass
- **F16:** Replace the hero PNG with a 10-second looping Lottie of a route drawing itself.
- **F17:** On draft events, expose an inline "Slug: /event/`<editable>`" field in the share popover's "Pro tip" area so organizers can own their URL before publishing.
- **F18:** Add a ChevronDown next to "Advanced" on the dashboard quick-create.
- **F19:** Add a one-line scout explainer at the top of ScoutPage.tsx and a small `navigator.geolocation` accuracy indicator on the "Drop pin here" button.
- **F20:** Add a ghost Share button to the public page top bar on the right side of the role toggle. On tap, use the `navigator.share` API with a fallback to a copy-link toast.

---

## 5. Golden Path Redesign — "Create & Publish" in under 3 minutes

The ideal first-time-user flow for a race organizer who's never heard of Hereday and lands from a Google search at 9pm the night before race registration opens:

### T+0s — Landing
- Hero: 10-second Lottie of a route drawing itself on a real map, with POIs popping in.
- CTA: "Map your race in 3 minutes — free"
- One click → `/signup`

### T+15s — Signup
- Google OAuth button (primary, first).
- Email fallback below a divider.
- Display name auto-populated from Google profile.

### T+20s — Empty dashboard, auto-opened quick create
- First-login detection opens the quick-create directly on the empty dashboard, focus in the name field.
- Two fields: **Name** (autofocus) and **Where?** (with Mapbox autocomplete).
- "Create" button disabled until both are filled.
- No modal — inline, on the dashboard, with a hint strip "Date and tracking are optional — you can add them in the editor."

### T+45s — Editor loads, map centered on chosen city
- Map already zoomed to city level.
- Coach-mark: "Click anywhere on the map to start your route"
- Cursor tooltip activates on first hover.

### T+60s — First waypoint
- Click to start → snap indicator briefly flashes.
- Second click → first segment snapped, distance label updates in sidebar.
- Cursor tooltip now says "Click to add point · Double-click to finish."

### T+90s — Route finished
- Double-click at finish line.
- Auto-Start/Auto-Finish markers land with the new labeled treatment.
- Status bar: "Route finished · 3.1 mi — Start & Finish added"
- Sidebar now shows ".3.1 mi" next to the route name and a green CheckCircle.

### T+100s — Armed POI
- Click "Water Station" emoji in the sidebar.
- Bottom pill appears: "🌊 Click map to place Water Station"
- One click → POI dropped snapped to route.
- User drops 3 more across the course in 15 seconds thanks to shift-click batch mode.

### T+130s — Publish
- Publish button now enabled (route with ≥2 points exists; validation passes).
- Click → instant publish.
- Toast "Event is live" for 2s → Live pill appears → Share popover **auto-opens** with the URL, QR code, and a new "Share via…" button.
- OG image preview thumbnail renders inside the share popover so the organizer can *see* what their share will look like on iMessage.

### T+150s — Post-publish soft upsell
- 600ms delay → free-tier upsell modal: "Your event is live. Upgrade to $49 Pro to remove the Hereday badge and unlock custom branding."
- Dismissible with "Not now."

**Total elapsed: 2:30. Decision points: 4 (signup, name+city, draw route, publish). System feedback moments: 8 (toasts, status bar, tooltips, coach-mark, save chip, publish success, share popover, upsell). Zero blocking modals between city input and publish.**

This path requires **F1, F3, F4, F6** at a minimum to land the experience as described. **F5 (OG image)** is what makes the share moment at T+130s feel premium. **F16 (hero video)** is what gets the user in the door at T+0.

---

## 6. Implementation Order

Each step below is independently shippable and each one builds on actual product observation, not speculation.

1. **F3 Pre-publish validation** — 1-line gate, immediate trust recovery. Ship first.
2. **F1 Quick-create + editor geolocation fallback** — highest-impact first-run change.
3. **F4 Start/Finish markers** — pure visual change, no schema. Fastest win with outsized impact.
4. **F6 Top-bar labels** — one-line className changes, surfaces existing features.
5. **F8 Save auto-retry** — trust hardening before Stripe lands.
6. **F10 POI delete undo** — safety net, trivial to add via existing Sonner.
7. **F2 Role picker as floating sheet** — map-first restoration.
8. **F11 OS dark mode detection** — one-line effect.
9. **F12 Network retry on public page** — error-state polish.
10. **F14 Directions button size** — one file.
11. **F5 Per-event OG image** — the big swing; save for a ~2 day block. Prerequisite for F15's "Recap" hero image.
12. **F9 Dashboard search** — wait until a real user has ≥10 events; not urgent yet.
13. **F13 Signup polish** — pre-Stripe soft touch.
14. **F15 Event-ended retention surface** — after F5 (reuses the OG image machinery).
15. **F7 Visible snap failures** — edge case; deferred.
16. **F16–F20 Polish pass** — batch after the above.

---

## 7. Verification

Every item above needs a manual smoke test in [TESTING_GUIDE.md](TESTING_GUIDE.md). Key checkpoints:

- **F1:** Create account → quick-create "Test Event" + "Austin, TX" → editor loads centered on Austin at zoom 13+, not continental.
- **F3:** Try to publish an event with 0 routes. Button disabled, tooltip explains. Add 1 route with 2 points. Button enables.
- **F4:** Publish a multi-route event. On mobile, open the public link. Each route's Start and Finish have labeled pills in the route's color. Zoom out and confirm they're still readable.
- **F5:** Share an event via iMessage to yourself. Preview card shows the event's route, name, and city — not a generic Hereday logo.
- **F6:** Open the editor on a 1440px+ monitor. Undo/Clear/Help/Scout all show text labels. Narrow the window — labels collapse.
- **F8:** DevTools → offline → make a change → the save chip enters retry countdown → network back on → auto-recovers to "Saved just now."
- **F10:** Drop a POI, click through to delete, wait — toast offers Undo. Click Undo within 5s; POI returns.

Code health gates (must stay clean):
- `npx tsc --noEmit` exit 0
- `npm run build` exit 0
- No new ESLint warnings
