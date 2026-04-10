import { useEffect, useRef, useState } from 'react';
import { Trash2, Move, X } from 'lucide-react';
import type { RoutePoi } from '@/types/mapEditor';
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
const PoiEditPopover = ({ poi, onSave, onDelete, onClose }: PoiEditPopoverProps) => {
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
    onSave(patch);
    onClose();
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
      {hasWebLink && (
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
