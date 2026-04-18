import { useEffect, useRef, useState } from 'react';
import { Trash2, Move, X, Megaphone, Crown, Radio } from 'lucide-react';
import type { RoutePoi, SponsorBlock } from '@/types/mapEditor';
import { poiTone } from '@/lib/pois';
import { Input } from '@/components/ui/input';
import { Textarea } from '@/components/ui/textarea';
import { Button } from '@/components/ui/button';

// Types whose marker flow benefits from a clickable web link (sponsor
// activations, registration pages, custom "see details" pins). Regular
// course-support markers (water, medical, etc.) don't expose the field
// because the URL clutters the card for zero organizer benefit.
const WEB_LINK_TYPES = new Set(['registration', 'sponsor', 'custom']);

interface PoiEditPopoverProps {
  poi: RoutePoi;
  onSave: (patch: Partial<RoutePoi>) => void;
  onDelete: () => void;
  onClose: () => void;
  /** True when the event is on Pro — gates the sponsor soft-wall hint. */
  isPro?: boolean;
  /**
   * True when this sponsor POI is beyond the free-tier branded cap
   * (i.e. it'll render as a generic ⭐ pin publicly on free events).
   * Shown only when `poi.type === 'sponsor'` and not isPro.
   */
  sponsorOverflow?: boolean;
  /** Opens the UpgradeModal with the `sponsors` trigger. */
  onUpgradeClick?: () => void;
  /** Opens the event-wide volunteer-status-link dialog. */
  onGenerateStatusLink?: () => void;
}

/**
 * React replacement for the 220-line inline-HTML popover previously
 * rendered directly inside the Mapbox popup. Rendered into a Mapbox
 * popup DOM node via React portal (see RouteEditor marker setup).
 *
 * Stays map-anchored for the "Tap → card" pattern from UX_PATTERNS.md,
 * but now uses shadcn primitives, is accessible (labels, focus ring,
 * Escape-to-close), and dark-mode safe via CSS variables.
 */
const PoiEditPopover = ({ poi, onSave, onDelete, onClose, isPro, sponsorOverflow, onUpgradeClick, onGenerateStatusLink }: PoiEditPopoverProps) => {
  const tone = poiTone(poi.type);
  const hasWebLink = WEB_LINK_TYPES.has(poi.type);

  // Local draft state so the user can type freely and only commit on
  // Save. Mirrors the old popover's behavior where edits were flushed
  // in one shot on Done click.
  const [title, setTitle] = useState(poi.title);
  const [description, setDescription] = useState(poi.description || '');
  const [webLink, setWebLink] = useState(poi.webLink || '');

  // Photo editing tracks three explicit states so we can distinguish
  // "untouched" from "cleared" from "replaced":
  //   - undefined + notTouched → preserve whatever was on the POI
  //   - cleared:true           → wipe both imageUrl and imageDataUrl
  //   - newDataUrl set         → queue a fresh upload on next save
  const [newImageDataUrl, setNewImageDataUrl] = useState<string | undefined>(undefined);
  const [imageCleared, setImageCleared] = useState(false);

  // Sponsor fields — only meaningful when poi.type === 'sponsor'. Stored
  // as a flat set of locals so we can mirror the draft-on-Save pattern
  // and assemble the `sponsor` block only when there's actual content.
  const isSponsor = poi.type === 'sponsor';
  const [sponsorOpen, setSponsorOpen] = useState(isSponsor && !!poi.sponsor);
  const [logoDataUrl, setLogoDataUrl] = useState<string | undefined>(undefined);
  const [logoCleared, setLogoCleared] = useState(false);
  const [brandColor, setBrandColor] = useState(poi.sponsor?.brandColor ?? '#2563eb');
  const [ctaText, setCtaText] = useState(poi.sponsor?.ctaText ?? '');
  const [ctaUrl, setCtaUrl] = useState(poi.sponsor?.ctaUrl ?? '');
  const [promoCode, setPromoCode] = useState(poi.sponsor?.promoCode ?? '');
  const logoInputRef = useRef<HTMLInputElement>(null);
  const existingLogo = logoCleared
    ? ''
    : logoDataUrl || poi.sponsor?.logoDataUrl || poi.sponsor?.logoUrl || '';

  const existingImage = imageCleared
    ? ''
    : newImageDataUrl || poi.imageDataUrl || poi.imageUrl || '';

  const titleInputRef = useRef<HTMLInputElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  // Auto-focus the title on open so keyboard users can start editing
  // immediately without an extra tab.
  useEffect(() => {
    titleInputRef.current?.focus();
    titleInputRef.current?.select();
  }, []);

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setNewImageDataUrl(reader.result as string);
      setImageCleared(false);
    };
    reader.readAsDataURL(file);
  };

  const handleRemovePhoto = () => {
    setNewImageDataUrl(undefined);
    setImageCleared(true);
  };

  const handleSave = () => {
    const patch: Partial<RoutePoi> = {
      title: title.trim() || tone.label,
      description,
      webLink: webLink.trim() || undefined,
    };
    if (imageCleared) {
      patch.imageDataUrl = undefined;
      patch.imageUrl = undefined;
    } else if (newImageDataUrl) {
      // Drop stale imageUrl — the save path will re-upload and
      // repopulate it from the new data URL.
      patch.imageDataUrl = newImageDataUrl;
      patch.imageUrl = undefined;
    }

    // Sponsor block — only attach when the POI is type:sponsor AND
    // something meaningful is set. Clearing all sponsor fields
    // explicitly removes the block (generic ⭐ behavior returns).
    if (isSponsor) {
      const ctaTrim = ctaUrl.trim();
      const ctaTextTrim = ctaText.trim();
      const promoTrim = promoCode.trim().toUpperCase();
      const hasContent = !!existingLogo || !!ctaTrim || !!promoTrim || !!ctaTextTrim;
      if (!hasContent) {
        patch.sponsor = undefined;
      } else {
        const next: SponsorBlock = {
          brandColor,
          ctaText: ctaTextTrim || undefined,
          ctaUrl: ctaTrim || undefined,
          promoCode: promoTrim || undefined,
        };
        if (logoCleared) {
          // both logo fields wiped
        } else if (logoDataUrl) {
          // queue a fresh upload — save path converts to logoUrl
          next.logoDataUrl = logoDataUrl;
        } else {
          next.logoUrl = poi.sponsor?.logoUrl;
          next.logoDataUrl = poi.sponsor?.logoDataUrl;
        }
        patch.sponsor = next;
      }
    }

    onSave(patch);
    onClose();
  };

  const handleLogoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setLogoDataUrl(reader.result as string);
      setLogoCleared(false);
    };
    reader.readAsDataURL(file);
  };

  // Keyboard handling: Escape closes, Ctrl/Cmd+Enter saves. We scope
  // this to a root div keydown rather than window so outer editor
  // shortcuts (R, T, etc.) still fire when the popover is closed.
  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
      return;
    }
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault();
      handleSave();
    }
  };

  const coordStr = `${poi.coordinates[1].toFixed(5)}, ${poi.coordinates[0].toFixed(5)}`;

  return (
    <div
      onKeyDown={handleKeyDown}
      className="w-[280px] font-body text-foreground"
      role="dialog"
      aria-label={`Edit ${tone.label} marker`}
    >
      {/* Header */}
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
          <Input
            ref={titleInputRef}
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            placeholder={tone.label}
            className="h-auto border-0 shadow-none px-0 py-0 text-[15px] font-bold focus-visible:ring-0"
          />
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
      <div className="border-t border-border pt-3">
        <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
          Description
        </label>
        <Textarea
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Add notes about this marker location…"
          rows={2}
          className="resize-none text-xs min-h-[52px] px-2.5 py-2"
        />
      </div>

      {/* Photo */}
      <div className="mt-2.5">
        <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
          📷 Photo
        </label>
        {existingImage && (
          <img
            src={existingImage}
            alt=""
            className="w-full max-h-[120px] object-cover rounded-lg border border-border mb-1.5"
          />
        )}
        <div className="flex gap-1.5">
          <label className="flex-1 px-2 py-2 border border-dashed border-border rounded-lg text-xs text-muted-foreground cursor-pointer text-center hover:bg-secondary transition-colors flex items-center justify-center gap-1">
            📎 {existingImage ? 'Change photo' : 'Attach photo'}
            <input
              ref={fileInputRef}
              type="file"
              accept="image/*"
              onChange={handleFileChange}
              className="hidden"
            />
          </label>
          {existingImage && (
            <button
              onClick={handleRemovePhoto}
              aria-label="Remove photo"
              className="px-2 py-2 border border-border rounded-lg text-destructive hover:bg-secondary transition-colors"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          )}
        </div>
      </div>

      {/* Web link (conditional) */}
      {hasWebLink && !isSponsor && (
        <div className="mt-2.5">
          <label className="text-[11px] font-semibold text-muted-foreground block mb-1">
            🔗 Web Link
          </label>
          <Input
            type="url"
            value={webLink}
            onChange={(e) => setWebLink(e.target.value)}
            placeholder="https://example.com"
            className="h-9 text-xs px-2.5"
          />
        </div>
      )}

      {/* Sponsor ad unit (sponsor type only) — toggle open to upgrade the
          generic ⭐ POI into a branded unit with logo, CTA, promo code.
          Collapsed by default for brand-new sponsor POIs so the form
          stays tight; auto-opens when editing a POI that already has
          sponsor content. */}
      {isSponsor && (
        <div className="mt-2.5 rounded-lg border border-border bg-muted/30">
          <button
            type="button"
            onClick={() => setSponsorOpen((v) => !v)}
            className="w-full flex items-center justify-between gap-2 px-2.5 py-2 text-left"
          >
            <span className="inline-flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wider text-muted-foreground">
              <Megaphone className="h-3 w-3" />
              Sponsor branding
            </span>
            <span className="text-[11px] text-muted-foreground">
              {sponsorOpen ? 'Collapse' : existingLogo || ctaUrl || promoCode ? 'Configured' : 'Add'}
            </span>
          </button>

          {sponsorOpen && (
            <div className="px-2.5 pb-2.5 space-y-2">
              {/* Soft-wall hint — free events publish 1 branded sponsor;
                  this one's the overflow so it'll render as a generic
                  ⭐ pin until the event is unlocked. Visible only in
                  the editor — the public view silently degrades. */}
              {sponsorOverflow && !isPro && (
                <div className="rounded-md border border-amber-300/60 bg-amber-50 dark:bg-amber-950/30 px-2.5 py-2 flex items-start gap-2">
                  <div className="h-6 w-6 rounded-full bg-amber-200/70 flex items-center justify-center shrink-0">
                    <Crown className="h-3 w-3 text-amber-700" />
                  </div>
                  <div className="flex-1 min-w-0">
                    <p className="text-[11px] font-semibold text-amber-900 dark:text-amber-200 leading-tight">
                      Showing as a generic pin publicly
                    </p>
                    <p className="text-[10.5px] text-amber-800/90 dark:text-amber-300/90 leading-snug mt-0.5">
                      Free events publish one branded sponsor. Unlock this event to show all of them with logo, CTA, and analytics.
                    </p>
                    {onUpgradeClick && (
                      <button
                        type="button"
                        onClick={onUpgradeClick}
                        className="mt-1 text-[10.5px] font-semibold text-amber-900 dark:text-amber-100 underline underline-offset-2 hover:no-underline"
                      >
                        Unlock event — $49
                      </button>
                    )}
                  </div>
                </div>
              )}

              {/* Logo */}
              <div>
                <label className="text-[10px] font-semibold text-muted-foreground block mb-1">Logo</label>
                {existingLogo && (
                  <div
                    className="w-full h-16 rounded-md border border-border bg-white mb-1 flex items-center justify-center overflow-hidden"
                    style={{ backgroundImage: 'linear-gradient(45deg,#f8fafc 25%,transparent 25%,transparent 75%,#f8fafc 75%),linear-gradient(45deg,#f8fafc 25%,transparent 25%,transparent 75%,#f8fafc 75%)', backgroundSize: '12px 12px', backgroundPosition: '0 0,6px 6px' }}
                  >
                    <img src={existingLogo} alt="Sponsor logo preview" className="max-h-14 max-w-[90%] object-contain" />
                  </div>
                )}
                <div className="flex gap-1.5">
                  <label className="flex-1 px-2 py-1.5 border border-dashed border-border rounded-md text-[11px] text-muted-foreground cursor-pointer text-center hover:bg-secondary transition-colors">
                    📎 {existingLogo ? 'Change logo' : 'Upload logo'}
                    <input
                      ref={logoInputRef}
                      type="file"
                      accept="image/*"
                      onChange={handleLogoChange}
                      className="hidden"
                    />
                  </label>
                  {existingLogo && (
                    <button
                      type="button"
                      onClick={() => { setLogoDataUrl(undefined); setLogoCleared(true); }}
                      aria-label="Remove logo"
                      className="px-2 py-1.5 border border-border rounded-md text-destructive hover:bg-secondary transition-colors"
                    >
                      <X className="h-3 w-3" />
                    </button>
                  )}
                </div>
              </div>

              {/* Brand color */}
              <div className="flex items-center gap-2">
                <label className="text-[10px] font-semibold text-muted-foreground">Brand color</label>
                <input
                  type="color"
                  value={brandColor}
                  onChange={(e) => setBrandColor(e.target.value)}
                  className="h-7 w-10 rounded border border-border cursor-pointer"
                  aria-label="Sponsor brand color"
                />
                <code className="text-[10px] text-muted-foreground font-mono">{brandColor.toUpperCase()}</code>
              </div>

              {/* CTA */}
              <div className="grid grid-cols-[110px_1fr] gap-1.5">
                <Input
                  value={ctaText}
                  onChange={(e) => setCtaText(e.target.value)}
                  placeholder="Learn more"
                  maxLength={28}
                  className="h-8 text-[11px] px-2"
                  aria-label="CTA button label"
                />
                <Input
                  type="url"
                  value={ctaUrl}
                  onChange={(e) => setCtaUrl(e.target.value)}
                  placeholder="https://sponsor.com"
                  className="h-8 text-[11px] px-2"
                  aria-label="CTA destination URL"
                />
              </div>

              {/* Promo code */}
              <Input
                value={promoCode}
                onChange={(e) => setPromoCode(e.target.value)}
                placeholder="Promo code (optional)"
                maxLength={24}
                className="h-8 text-[11px] px-2 font-mono uppercase tracking-wider placeholder:normal-case placeholder:font-body placeholder:tracking-normal"
                aria-label="Promo code"
              />
            </div>
          )}
        </div>
      )}

      {/* Volunteer status link — surfaces the event-wide link creation
          dialog. Opened from here because the organizer is already
          thinking about a specific POI (the one they're editing); the
          generated link covers every POI on the event, but contextual
          entry makes it discoverable. */}
      {onGenerateStatusLink && (
        <button
          type="button"
          onClick={() => { onGenerateStatusLink(); onClose(); }}
          className="mt-2.5 w-full flex items-center gap-2 rounded-lg border border-border bg-muted/30 px-2.5 py-2 text-left hover:bg-muted/60 transition-colors"
        >
          <Radio className="h-3.5 w-3.5 text-primary shrink-0" />
          <div className="flex-1 min-w-0">
            <p className="text-[12px] font-semibold text-foreground leading-tight">
              Volunteer status link
            </p>
            <p className="text-[10.5px] text-muted-foreground leading-snug mt-0.5">
              Let volunteers mark Open / Low / Closed from their phones.
            </p>
          </div>
          <span className="text-[11px] text-primary font-medium shrink-0">Open →</span>
        </button>
      )}

      {/* Coordinates + move hint */}
      <div className="mt-2.5 px-2.5 py-1.5 bg-muted rounded-lg flex items-center justify-between gap-2">
        <span className="text-[11px] font-mono text-muted-foreground truncate">{coordStr}</span>
        <span className="text-[10px] text-muted-foreground inline-flex items-center gap-1 shrink-0">
          <Move className="h-3 w-3" />
          Drag to move
        </span>
      </div>

      {/* Actions */}
      <div className="flex items-center justify-between mt-3.5 pt-3 border-t border-border">
        <button
          onClick={() => { onDelete(); onClose(); }}
          className="text-destructive text-xs font-semibold inline-flex items-center gap-1 hover:opacity-80"
        >
          <Trash2 className="h-3 w-3" />
          Remove
        </button>
        <Button onClick={handleSave} size="sm" className="h-8 px-4 text-xs">
          Done
        </Button>
      </div>
    </div>
  );
};

export default PoiEditPopover;
