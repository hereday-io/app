// Sponsor POI helpers — soft-wall selection + predicates.
//
// "Branded" = a sponsor POI that has enough content (logo, CTA, or
// promo) to warrant the ad-unit treatment on the public map. A bare
// `type: 'sponsor'` POI with no sponsor block stays the generic ⭐.
//
// Free tier shows up to FREE_BRANDED_SPONSOR_CAP branded sponsors
// publicly; extras fall back to the generic ⭐. This is the "soft
// wall" — organizers can author any number of sponsors and see them
// in the editor preview, but only the first N render publicly until
// they unlock Pro. The value pitch lands without hard blocking the
// author flow.

import type { RoutePoi } from '@/types/mapEditor';

export const FREE_BRANDED_SPONSOR_CAP = 1;

/** True when the POI is a sponsor unit with enough content to brand. */
export function hasSponsorContent(poi: RoutePoi): boolean {
  if (poi.type !== 'sponsor' || !poi.sponsor) return false;
  const s = poi.sponsor;
  return !!(s.logoUrl || s.logoDataUrl || s.ctaUrl || s.promoCode);
}

/**
 * Return the set of POI ids that should render as branded sponsor
 * units. Free tier slices to FREE_BRANDED_SPONSOR_CAP; Pro is
 * unlimited. Non-sponsor POIs are never in the returned set.
 *
 * Order is the POI array order — organizers see what they added first
 * take precedence, which matches authoring intuition.
 */
export function selectBrandedSponsorIds(
  pois: RoutePoi[],
  isPro: boolean,
): Set<string> {
  const branded = pois.filter(hasSponsorContent);
  const visible = isPro ? branded : branded.slice(0, FREE_BRANDED_SPONSOR_CAP);
  return new Set(visible.map((p) => p.id));
}
