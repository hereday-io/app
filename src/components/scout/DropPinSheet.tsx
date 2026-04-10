import { useState } from 'react';
import { X, Loader2, Check } from 'lucide-react';
import type { PoiType } from '@/types/mapEditor';
import {
  POI_CATEGORIES,
  POI_CATEGORY_ORDER,
  poisByCategory,
  poiTone,
} from '@/lib/pois';
import { submitScoutedPoi } from '@/lib/scoutApi';
import { saveScoutPending, flushScoutPending } from '@/lib/scoutStorage';
import { useToast } from '@/hooks/use-toast';
import { logEvent } from '@/lib/analytics';

interface DropPinSheetProps {
  token: string;
  eventId: string;
  coordinates: [number, number];
  onClose: () => void;
  onSubmitted: (coord: [number, number]) => void;
}

/**
 * Bottom-sheet form the mobile scout uses to describe a POI they're
 * standing next to. Keeps the form small and the interactions fat-finger
 * safe: category tabs along the top, a grid of POI types beneath,
 * required title, optional description, one big Save button.
 *
 * On network failure, the POI gets stashed in IndexedDB via
 * scoutStorage so it can retry when the phone is back online. That's
 * the only "offline" feature in Phase 1 — we don't pretend to be a
 * full offline-first app.
 */
const DropPinSheet = ({ token, eventId, coordinates, onClose, onSubmitted }: DropPinSheetProps) => {
  const { toast } = useToast();
  const grouped = poisByCategory();
  const [category, setCategory] = useState(POI_CATEGORY_ORDER[0]);
  const [selectedType, setSelectedType] = useState<PoiType | null>(null);
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [saving, setSaving] = useState(false);

  const canSave = !!selectedType && title.trim().length > 0 && !saving;

  const handleSave = async () => {
    if (!canSave || !selectedType) return;
    setSaving(true);
    const poi = {
      type: selectedType,
      title: title.trim(),
      description: description.trim() || undefined,
      coordinates,
    };
    try {
      await submitScoutedPoi({ token, poi });
      logEvent('scout_poi_submitted', eventId, { type: selectedType });
      toast({ title: 'POI saved for review' });
      // Try to flush any previously-pending items now that we know the
      // network is working.
      void flushScoutPending(token);
      onSubmitted(coordinates);
    } catch (err) {
      console.error('[DropPinSheet] submit failed', err);
      // Stash locally and let the user know it'll retry.
      try {
        await saveScoutPending(token, poi);
        toast({
          title: 'Saved locally',
          description: 'Will retry when you are back online.',
        });
        logEvent('scout_poi_queued_offline', eventId, { type: selectedType });
        onSubmitted(coordinates);
      } catch (storeErr) {
        console.error('[DropPinSheet] local stash failed', storeErr);
        toast({
          title: 'Save failed',
          description: err instanceof Error ? err.message : 'Please try again.',
          variant: 'destructive',
        });
      }
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex flex-col justify-end" role="dialog" aria-modal="true">
      {/* Backdrop */}
      <button
        onClick={onClose}
        className="absolute inset-0 bg-black/40"
        aria-label="Close"
      />

      {/* Sheet */}
      <div className="relative bg-background rounded-t-2xl shadow-2xl border-t border-border max-h-[85vh] flex flex-col">
        {/* Drag handle */}
        <div className="shrink-0 flex justify-center pt-2 pb-1">
          <div className="w-10 h-1 rounded-full bg-muted-foreground/30" />
        </div>

        {/* Header */}
        <div className="shrink-0 flex items-center justify-between px-4 pb-2">
          <div>
            <h2 className="text-base font-display font-bold text-foreground">Add a POI</h2>
            <p className="text-[11px] text-muted-foreground font-mono">
              {coordinates[1].toFixed(5)}, {coordinates[0].toFixed(5)}
            </p>
          </div>
          <button
            onClick={onClose}
            className="h-9 w-9 flex items-center justify-center rounded-lg hover:bg-secondary text-muted-foreground hover:text-foreground"
            aria-label="Close"
          >
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Body — scrollable */}
        <div className="flex-1 overflow-y-auto px-4 pb-4 space-y-4">
          {/* Category tabs */}
          <div className="flex gap-1.5">
            {POI_CATEGORY_ORDER.map((cat) => {
              const active = cat === category;
              return (
                <button
                  key={cat}
                  onClick={() => {
                    setCategory(cat);
                    setSelectedType(null);
                  }}
                  className={`flex-1 h-9 rounded-lg text-xs font-semibold transition-colors ${
                    active
                      ? 'bg-primary text-primary-foreground'
                      : 'bg-muted/50 text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {POI_CATEGORIES[cat].label}
                </button>
              );
            })}
          </div>

          {/* POI type grid */}
          <div className="grid grid-cols-3 gap-2">
            {grouped[category].map((type) => {
              const tone = poiTone(type);
              const active = selectedType === type;
              return (
                <button
                  key={type}
                  onClick={() => {
                    setSelectedType(type);
                    if (!title) setTitle(tone.label);
                  }}
                  className={`flex flex-col items-center justify-center gap-1 py-2.5 rounded-lg border transition-colors ${
                    active
                      ? 'border-primary bg-primary/10 text-primary'
                      : 'border-border bg-card hover:bg-secondary text-foreground'
                  }`}
                >
                  <span className="text-2xl leading-none">{tone.emoji}</span>
                  <span className="text-[10px] font-semibold leading-tight">{tone.label}</span>
                </button>
              );
            })}
          </div>

          {/* Title */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Title
            </label>
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder="e.g. Mile 3 water station"
              maxLength={100}
              className="w-full h-11 px-3 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:border-primary"
            />
          </div>

          {/* Description */}
          <div className="space-y-1">
            <label className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
              Notes <span className="text-muted-foreground/60 normal-case">(optional)</span>
            </label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Anything the organizer should know?"
              rows={3}
              maxLength={500}
              className="w-full px-3 py-2 rounded-lg border border-border bg-background text-sm text-foreground outline-none focus:border-primary resize-none"
            />
          </div>
        </div>

        {/* Footer */}
        <div className="shrink-0 px-4 py-3 border-t border-border bg-card">
          <button
            onClick={handleSave}
            disabled={!canSave}
            className="w-full h-12 rounded-xl bg-primary text-primary-foreground font-semibold flex items-center justify-center gap-2 hover:bg-primary/90 active:scale-[0.98] transition-all disabled:opacity-50 disabled:active:scale-100"
          >
            {saving ? (
              <Loader2 className="h-5 w-5 animate-spin" />
            ) : (
              <Check className="h-5 w-5" />
            )}
            {saving ? 'Saving…' : 'Save POI'}
          </button>
        </div>
      </div>
    </div>
  );
};

export default DropPinSheet;
