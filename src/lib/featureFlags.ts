// Central product feature flags.
//
// LIVE_TRACKING_ENABLED — live GPS runner tracking. Paused while the
// feature is web-only: it asks every runner for persistent browser
// location permission, which is a rough first-touch experience on race
// morning. All runtime entry points (the runner "Track me" button, the
// spectator live-runner dots + list, and the organizer tracking-window
// config in the create/edit dialogs) and the marketing copy that
// advertised it are gated on this flag. Flip to `true` to bring the
// whole feature back — no other changes required.
export const LIVE_TRACKING_ENABLED: boolean = false;
