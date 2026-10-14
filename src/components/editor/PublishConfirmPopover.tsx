import { useEffect, useRef, useState } from 'react';
import { Globe, Loader2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { normalizeSlug } from '@/lib/slug';

export type PublishResult = 'ok' | 'slug-taken' | 'failed';

interface PublishConfirmPopoverProps {
  /** The event's current slug, pre-filled and editable. */
  slug: string | null;
  canPublish: boolean;
  isPublishing: boolean;
  /** Publishes, saving `slug` first when it changed. */
  onConfirm: (slug: string) => Promise<PublishResult>;
}

/**
 * The publish step for a draft: shows the public link before it goes out
 * and lets the organizer change it. This is the last moment the URL can
 * change safely; once it's live it ends up on QR codes and in group chats,
 * so Edit details locks it.
 */
const PublishConfirmPopover = ({ slug, canPublish, isPublishing, onConfirm }: PublishConfirmPopoverProps) => {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(slug ?? '');
  const [error, setError] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setValue(slug ?? '');
    setError(null);
    // Focus after the popover renders so Enter publishes straight away.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open, slug]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    // Capture phase so the editor's own Escape handler doesn't also fire.
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { setOpen(false); e.stopPropagation(); }
    };
    document.addEventListener('mousedown', onDown);
    window.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('mousedown', onDown);
      window.removeEventListener('keydown', onKey, true);
    };
  }, [open]);

  const normalized = normalizeSlug(value);

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!normalized) {
      setError('Add at least one letter or number.');
      return;
    }
    setError(null);
    const result = await onConfirm(normalized);
    if (result === 'ok') setOpen(false);
    else if (result === 'slug-taken') setError('That link is taken. Try another.');
    // 'failed' already raised a toast with the reason; keep the popover
    // open so a retry is one click.
  };

  return (
    <div className="relative" ref={ref}>
      <Button
        size="sm"
        onClick={() => setOpen((v) => !v)}
        disabled={isPublishing || !canPublish}
        title={!canPublish ? 'Draw a route first — you need at least 2 points to publish' : undefined}
        className="h-8 gap-1.5"
        aria-expanded={open}
      >
        <Globe className="h-4 w-4" />
        {isPublishing ? 'Publishing…' : 'Publish'}
      </Button>

      {open && (
        <form
          onSubmit={submit}
          className="absolute right-0 top-full mt-2 w-80 rounded-xl bg-background border border-border shadow-lg z-50 p-3 space-y-2.5"
        >
          <div>
            <p className="text-sm font-semibold text-foreground">Publish this event?</p>
            <p className="text-xs text-muted-foreground mt-0.5">
              Anyone with the link can see it. You can change the link now; after publishing it stays fixed so shared links and QR codes keep working.
            </p>
          </div>
          <label className="block">
            <span className="text-[11px] font-medium text-muted-foreground">Public link</span>
            <div className={`mt-1 flex items-center rounded-md border bg-muted/40 text-xs font-mono focus-within:ring-2 focus-within:ring-ring ${error ? 'border-destructive' : 'border-border'}`}>
              <span className="pl-2 text-muted-foreground shrink-0">{window.location.host}/event/</span>
              <input
                ref={inputRef}
                value={value}
                onChange={(e) => { setValue(e.target.value); setError(null); }}
                aria-invalid={!!error}
                aria-describedby={error ? 'publish-slug-error' : undefined}
                className="flex-1 min-w-0 bg-transparent py-1.5 pr-2 outline-none text-foreground"
                spellCheck={false}
                autoCapitalize="off"
              />
            </div>
          </label>
          {error && <p id="publish-slug-error" role="alert" className="text-xs text-destructive">{error}</p>}
          {!error && normalized && normalized !== value.trim() && (
            <p className="text-[11px] text-muted-foreground">Will be saved as <span className="font-mono">{normalized}</span></p>
          )}
          <div className="flex gap-1.5 pt-0.5">
            <Button type="button" variant="ghost" size="sm" className="flex-1 h-8" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit" size="sm" className="flex-1 h-8 gap-1.5" disabled={isPublishing}>
              {isPublishing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Globe className="h-3.5 w-3.5" />}
              {isPublishing ? 'Publishing…' : 'Publish'}
            </Button>
          </div>
        </form>
      )}
    </div>
  );
};

export default PublishConfirmPopover;
