import { useEffect, useState } from 'react';
import { Check, Copy, ExternalLink, Navigation, X } from 'lucide-react';
import type { PoiStatus, RoutePoi } from '@/types/mapEditor';
import { poiTone } from '@/lib/pois';
import { STATUS_DOT_COLORS } from '@/lib/mapMarkers';
import { hasSponsorContent } from '@/lib/sponsors';
import { logEvent } from '@/lib/analytics';

// Human labels for the volunteer-reported states. Matches the volunteer
// page copy one-for-one so users don't see "low" on one surface and
// "Low on supplies" on another.
const STATUS_LABELS: Record<string, string> = {
  open: 'Open',
  low: 'Low',
  closed: 'Closed',
  moved: 'Moved',
};


// Types whose marker flow benefits from a clickable web link (sponsor
// activations, registration pages, custom "see details" pins). Regular
// course-support markers (water, medical, etc.) don't expose the field
// because the URL clutters the card for zero organizer benefit.
const WEB_LINK_TYPES = new Set(['registration', 'sponsor', 'custom']);

interface PoiReadonlyPopoverProps {
  poi: RoutePoi;
  onClose: () => void;
  /** Event id used for analytics attribution on sponsor impressions / clicks. */
  eventId?: string;
  /** True when this POI should render as a branded sponsor ad unit. */
  branded?: boolean;
  /** Current live status from the usePoiStatuses subscription, or null. */
  status?: PoiStatus | null;
}

/**
 * Public-map read-only counterpart to PoiEditPopover. Two visual modes:
 *
 *  1. **Default** — standard POI card: emoji badge, title, description,
 *     optional photo, optional Directions + Visit link.
 *  2. **Branded sponsor** (when `branded` is true) — ad-unit treatment:
 *     white logo header with a "SPONSORED" eyebrow, brand-color-filled
 *     CTA, copyable promo code. No directions link — sponsors are not
 *     navigation targets.
 *
 * Fires `sponsor_impression` on mount and `sponsor_click` /
 * `sponsor_promo_copied` on the respective interactions so the
 * analytics panel can prove sponsor value.
 */
const PoiReadonlyPopover = ({ poi, onClose, eventId, branded, status }: PoiReadonlyPopoverProps) => {
  const tone = poiTone(poi.type);
  const hasWebLink = WEB_LINK_TYPES.has(poi.type) && !!poi.webLink;
  const existingImage = poi.imageUrl || poi.imageDataUrl || '';
  const showDirections = tone.category === 'logistics' || tone.category === 'support';
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${poi.coordinates[1]},${poi.coordinates[0]}`;

  // Branded when the caller flags us AND the POI actually carries
  // sponsor content. `branded` is undefined when this component is used
  // from a site that hasn't been updated to pass it — in that case fall
  // back to detecting from the POI data so we don't silently degrade
  // to the generic variant.
  const isBranded = branded === undefined
    ? hasSponsorContent(poi)
    : (branded && hasSponsorContent(poi));

  // Fire impression once per mount (each popover open = one impression)
  useEffect(() => {
    if (!isBranded || !eventId) return;
    logEvent('sponsor_impression', eventId, { poi_id: poi.id, title: poi.title || null });
    // Deliberately empty deps — this fires once when the popover renders.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  if (isBranded) {
    return <BrandedSponsorPopover poi={poi} eventId={eventId} onClose={onClose} />;
  }

  return (
    <div
      className="w-[260px] font-body text-foreground"
      role="dialog"
      aria-label={`${tone.label} marker: ${poi.title || tone.label}`}
    >
      {/* Header — emoji circle + type label + title + close X */}
      <div className="flex items-center gap-2.5 mb-3">
        <div
          className="w-10 h-10 rounded-full flex items-center justify-center text-xl shrink-0 border-2"
          style={{ background: `${tone.dot}15`, borderColor: `${tone.dot}30` }}
        >
          {tone.emoji}
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold text-muted-foreground uppercase tracking-wider">
            {tone.label} Marker
          </p>
          <p className="text-[15px] font-bold text-foreground truncate">
            {poi.title || tone.label}
          </p>
        </div>
        <button
          onClick={onClose}
          aria-label="Close"
          className="text-muted-foreground hover:text-foreground shrink-0 -mt-3 -mr-1"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Live volunteer status — only shown when state isn't 'open'.
          Public view keeps this intentionally minimal: participants
          benefit from knowing "water is low" but don't need the
          organizer-oriented audit trail (who/when/verbose note).
          Full details live on the Ops Center (organizer-only). */}
      {status && status.state !== 'open' && (
        <div className="border-t border-border pt-2.5 pb-2.5">
          <div className="flex items-center gap-2 text-xs">
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2 py-0.5 text-[10.5px] font-display font-semibold uppercase tracking-wider text-white"
              style={{ background: STATUS_DOT_COLORS[status.state] }}
            >
              <span className="inline-block w-1.5 h-1.5 rounded-full bg-white" />
              {STATUS_LABELS[status.state] ?? status.state}
            </span>
            {status.note && (
              <span className="text-foreground/85 text-[12px] truncate">
                {status.note}
              </span>
            )}
          </div>
        </div>
      )}

      {/* Description */}
      {poi.description && (
        <div className={`${status && status.state !== 'open' ? '' : 'border-t border-border'} pt-3 mb-2.5`}>
          <p className="text-xs text-foreground/90 leading-relaxed whitespace-pre-wrap">
            {poi.description}
          </p>
        </div>
      )}

      {/* Photo */}
      {existingImage && (
        <div className="mb-2.5">
          <img
            src={existingImage}
            alt=""
            className="w-full max-h-[140px] object-cover rounded-lg border border-border"
          />
        </div>
      )}

      {/* Action buttons — web link (if configured) and/or directions.
          Directions is promoted to a full-width tappable button so cold,
          gloved spectators trying to find parking at 6am can hit it
          without pinching the text. */}
      {(hasWebLink || showDirections) && (
        <div className="flex flex-col gap-2 border-t border-border pt-2.5">
          {showDirections && (
            <a
              href={directionsUrl}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground shadow-sm transition-colors hover:bg-primary/90 active:scale-[0.98]"
            >
              <Navigation className="h-4 w-4" />
              Directions in Maps
            </a>
          )}
          {hasWebLink && (
            <a
              href={poi.webLink}
              target="_blank"
              rel="noopener noreferrer"
              className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg border border-border bg-background px-3 text-sm font-semibold text-foreground transition-colors hover:bg-secondary active:scale-[0.98]"
            >
              <ExternalLink className="h-4 w-4" />
              Visit link
            </a>
          )}
        </div>
      )}
    </div>
  );
};

export default PoiReadonlyPopover;

// ────────────────────────────────────────────────────────────────────
// Branded sponsor variant
// ────────────────────────────────────────────────────────────────────

const BrandedSponsorPopover = ({
  poi,
  eventId,
  onClose,
}: {
  poi: RoutePoi;
  eventId?: string;
  onClose: () => void;
}) => {
  const sponsor = poi.sponsor!;
  const brand = sponsor.brandColor || '#2563eb';
  const logo = sponsor.logoUrl || sponsor.logoDataUrl || '';
  const ctaLabel = (sponsor.ctaText || 'Learn more').trim();
  const ctaHref = (() => {
    const raw = sponsor.ctaUrl?.trim();
    if (!raw) return '';
    if (!/^https?:\/\//i.test(raw)) return `https://${raw}`;
    return raw;
  })();

  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    if (!sponsor.promoCode) return;
    try {
      await navigator.clipboard.writeText(sponsor.promoCode);
      setCopied(true);
      if (eventId) {
        logEvent('sponsor_promo_copied', eventId, {
          poi_id: poi.id,
          code: sponsor.promoCode,
        });
      }
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // Clipboard blocked — fall back to selecting the text so the
      // viewer can still copy by hand. Not worth a toast on mobile.
    }
  };

  return (
    <div
      className="w-[280px] font-body text-foreground"
      role="dialog"
      aria-label={`Sponsor: ${poi.title || 'sponsor'}`}
    >
      {/* Eyebrow + close */}
      <div className="flex items-center justify-between mb-2">
        <span
          className="inline-block text-[9.5px] font-display font-semibold uppercase tracking-[0.12em] px-2 py-0.5 rounded"
          style={{ background: brand, color: 'white' }}
        >
          Sponsored
        </span>
        <button
          onClick={onClose}
          aria-label="Close"
          className="text-muted-foreground hover:text-foreground"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {/* Logo block — white card with the sponsor's logo */}
      {logo && (
        <div
          className="w-full h-[92px] rounded-xl border mb-3 flex items-center justify-center overflow-hidden"
          style={{ background: 'white', borderColor: `${brand}30` }}
        >
          <img src={logo} alt={poi.title || 'Sponsor logo'} className="max-w-[78%] max-h-[78%] object-contain" />
        </div>
      )}

      {/* Title + description */}
      {poi.title && (
        <p className="text-[16px] font-bold leading-tight text-foreground mb-1">{poi.title}</p>
      )}
      {poi.description && (
        <p className="text-[13px] text-foreground/85 leading-relaxed whitespace-pre-wrap mb-3">
          {poi.description}
        </p>
      )}

      {/* Promo code — click to copy */}
      {sponsor.promoCode && (
        <button
          type="button"
          onClick={handleCopy}
          className="w-full flex items-center justify-between gap-2 rounded-lg border border-dashed px-3 py-2 mb-2 transition-colors hover:bg-muted/50"
          style={{ borderColor: `${brand}55`, background: `${brand}0A` }}
          aria-label={`Copy promo code ${sponsor.promoCode}`}
        >
          <div className="flex flex-col items-start min-w-0">
            <span className="text-[9.5px] font-display font-semibold uppercase tracking-wider text-muted-foreground">
              Promo code
            </span>
            <span
              className="font-mono font-bold tracking-wider text-[14px]"
              style={{ color: brand }}
            >
              {sponsor.promoCode}
            </span>
          </div>
          <span className="inline-flex items-center gap-1 text-[11px] font-medium text-muted-foreground">
            {copied ? (
              <>
                <Check className="h-3 w-3" /> Copied
              </>
            ) : (
              <>
                <Copy className="h-3 w-3" /> Copy
              </>
            )}
          </span>
        </button>
      )}

      {/* CTA */}
      {ctaHref && (
        <a
          href={ctaHref}
          target="_blank"
          rel="noopener noreferrer"
          onClick={() => {
            if (eventId) {
              logEvent('sponsor_click', eventId, { poi_id: poi.id, cta_url: ctaHref });
            }
          }}
          className="inline-flex h-10 w-full items-center justify-center gap-2 rounded-lg px-3 text-sm font-semibold shadow-sm transition-opacity hover:opacity-90 active:scale-[0.98]"
          style={{ background: brand, color: 'white' }}
        >
          <ExternalLink className="h-4 w-4" />
          {ctaLabel}
        </a>
      )}
    </div>
  );
};
