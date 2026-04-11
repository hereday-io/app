import { X, ExternalLink, Navigation } from 'lucide-react';
import type { RoutePoi } from '@/types/mapEditor';
import { poiTone } from '@/lib/pois';

// Same set the editor uses for the optional web-link field.
const WEB_LINK_TYPES = new Set(['registration', 'sponsor', 'custom']);

interface PoiReadonlyPopoverProps {
  poi: RoutePoi;
  onClose: () => void;
}

/**
 * Public-map read-only counterpart to PoiEditPopover. Mounted into
 * Mapbox popup DOM via React portal so the public marker card uses
 * the same shadcn-flavored styling (header emoji, uppercase type
 * label, styled X close button) as the editor popover — viewers get
 * a consistent, premium card whether they're an organizer clicking
 * in the editor or a runner tapping on the live map.
 *
 * Directions are surfaced only for Logistics/Amenities POIs — on-course
 * markers (start, aid, water, etc.) don't need directions because the
 * runner/spectator already has the route loaded.
 */
const PoiReadonlyPopover = ({ poi, onClose }: PoiReadonlyPopoverProps) => {
  const tone = poiTone(poi.type);
  const hasWebLink = WEB_LINK_TYPES.has(poi.type) && !!poi.webLink;
  const existingImage = poi.imageUrl || poi.imageDataUrl || '';
  const showDirections = tone.category === 'logistics' || tone.category === 'support';
  const directionsUrl = `https://www.google.com/maps/dir/?api=1&destination=${poi.coordinates[1]},${poi.coordinates[0]}`;

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

      {/* Description */}
      {poi.description && (
        <div className="border-t border-border pt-3 mb-2.5">
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
