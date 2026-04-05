/**
 * Centralizes free vs paid tier limits.
 * Update limits here — they propagate everywhere automatically.
 */

// Free-tier ceilings. Sized to let a typical small-race organizer
// complete one real event end-to-end without hitting a wall:
//   - 3 routes fits the common 5K / 10K / half-marathon trio
//   - 30 POIs fits start/finish + ~5 water stops + registration, parking,
//     restrooms, medical, a few sponsors, with headroom.
// Marathon weekends (4+ distances) and larger races trip the upgrade as
// genuine "I outgrew it" moments rather than a demo wall. Pro is
// unlimited on both axes.
export const PAYWALL_LIMITS = {
  routes: 3,
  pois: 30,
} as const;

interface UsePaywallOptions {
  isPaid: boolean;
}

export function usePaywall({ isPaid }: UsePaywallOptions) {
  const canAddRoute = (currentCount: number) => isPaid || currentCount < PAYWALL_LIMITS.routes;
  const canAddPoi = (currentCount: number) => isPaid || currentCount < PAYWALL_LIMITS.pois;

  return { canAddRoute, canAddPoi, limits: PAYWALL_LIMITS };
}
