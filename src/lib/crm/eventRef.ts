const UUID_RE = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Accepts whatever an admin has on hand — an editor URL
 * (`/editor?id=<uuid>`), a public URL (`/event/<slug>`), a bare id or a
 * bare slug — and returns the id or slug. Mirrors
 * crm_internal.parse_event_ref in 20261012121000_crm_schema.sql.
 */
export const parseEventRef = (raw: string): string => {
  const value = raw.trim();
  const slugMatch = value.match(/\/event\/([^/?#\s]+)/i);
  if (slugMatch) return decodeURIComponent(slugMatch[1]);
  const idMatch = value.match(UUID_RE);
  if (idMatch) return idMatch[0].toLowerCase();
  return value;
};
