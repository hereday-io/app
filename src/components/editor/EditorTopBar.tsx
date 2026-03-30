import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Undo2, Trash2, Save, Loader2, HelpCircle, Globe, Check, Copy, ExternalLink, EyeOff } from 'lucide-react';
import LocationSearch from '@/components/editor/LocationSearch';

interface EditorTopBarProps {
  eventName: string;
  city: string;
  eventDate: string;
  statusText: string;
  isSaving: boolean;
  isSnapping: boolean;
  isPublishing?: boolean;
  isPublished?: boolean;
  publicUrl?: string;
  mapboxToken: string;
  onSave: () => void;
  onBack: () => void;
  onUndo: () => void;
  onClearRoute: () => void;
  onLocationSelect: (center: [number, number], name: string) => void;
  onHelp?: () => void;
  onPublish?: () => void;
}

const EditorTopBar = ({
  eventName,
  city,
  eventDate,
  statusText,
  isSaving,
  isSnapping,
  isPublishing,
  isPublished,
  publicUrl,
  mapboxToken,
  onSave,
  onBack,
  onUndo,
  onClearRoute,
  onLocationSelect,
  onHelp,
  onPublish,
}: EditorTopBarProps) => {
  const meta = [city, eventDate].filter(Boolean).join(' · ');
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

  // Close popover on outside click
  useEffect(() => {
    if (!popoverOpen) return;
    const handler = (e: MouseEvent) => {
      if (popoverRef.current && !popoverRef.current.contains(e.target as Node)) {
        setPopoverOpen(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [popoverOpen]);

  const handleCopy = () => {
    if (!publicUrl) return;
    navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handlePublishClick = () => {
    if (isPublished) {
      setPopoverOpen((v) => !v);
    } else {
      onPublish?.();
    }
  };

  return (
    <header className="border-b border-border bg-card px-4 py-2 flex items-center justify-between gap-4 shrink-0">
      <div className="flex items-center gap-3">
        <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <div>
          <h1 className="font-display font-bold text-sm leading-tight">{eventName}</h1>
          {meta && <p className="text-xs text-muted-foreground">{meta}</p>}
        </div>
      </div>

      <div className="flex items-center gap-2">
        {isSnapping && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> Snapping…
          </span>
        )}
        <span className="text-xs text-muted-foreground hidden sm:inline max-w-48 truncate">
          {statusText}
        </span>
        {mapboxToken && (
          <LocationSearch token={mapboxToken} onSelect={onLocationSelect} />
        )}
        <Button variant="ghost" size="sm" onClick={onUndo} title="Undo last point">
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={onClearRoute} title="Clear active route">
          <Trash2 className="h-4 w-4" />
        </Button>
        {onHelp && (
          <Button variant="ghost" size="sm" onClick={onHelp} title="Show editor tour">
            <HelpCircle className="h-4 w-4" />
          </Button>
        )}
        <Button size="sm" onClick={onSave} disabled={isSaving} data-tour="save-button">
          <Save className="h-4 w-4 mr-1" />
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
        {onPublish && (
          <div className="relative" ref={popoverRef}>
            <Button
              size="sm"
              variant={isPublished ? 'secondary' : 'default'}
              onClick={handlePublishClick}
              disabled={isPublishing}
            >
              <Globe className="h-4 w-4 mr-1" />
              {isPublishing ? 'Publishing…' : isPublished ? 'Published' : 'Publish'}
            </Button>

            {popoverOpen && isPublished && publicUrl && (
              <div className="absolute right-0 top-full mt-2 w-80 rounded-lg border border-border bg-popover shadow-lg z-50 overflow-hidden">
                <div className="px-4 py-3 border-b border-border flex items-center justify-between">
                  <div className="flex items-center gap-2">
                    <Globe className="h-4 w-4 text-primary" />
                    <span className="text-sm font-medium text-foreground">Event is live</span>
                  </div>
                  <button
                    onClick={() => setPopoverOpen(false)}
                    className="text-muted-foreground hover:text-foreground text-lg leading-none"
                  >
                    ×
                  </button>
                </div>

                <div className="px-4 py-3 space-y-3">
                  <div className="flex items-center gap-2">
                    <input
                      readOnly
                      value={publicUrl}
                      className="flex-1 rounded-md border border-border bg-muted px-3 py-1.5 text-xs text-foreground select-all focus:outline-none focus:ring-1 focus:ring-ring"
                      onFocus={(e) => e.target.select()}
                    />
                    <Button size="sm" variant="outline" className="h-8 gap-1" onClick={handleCopy}>
                      {copied ? <Check className="h-3 w-3 text-primary" /> : <Copy className="h-3 w-3" />}
                      {copied ? 'Copied' : 'Copy'}
                    </Button>
                  </div>

                  <div className="flex items-center justify-between">
                    <a
                      href={publicUrl}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="text-xs text-primary hover:underline flex items-center gap-1"
                    >
                      <ExternalLink className="h-3 w-3" /> Open public page
                    </a>
                    <Button
                      size="sm"
                      variant="ghost"
                      className="h-7 text-xs text-destructive hover:text-destructive hover:bg-destructive/10 gap-1"
                      onClick={() => {
                        setPopoverOpen(false);
                        onPublish?.();
                      }}
                    >
                      <EyeOff className="h-3 w-3" /> Unpublish
                    </Button>
                  </div>
                </div>
              </div>
            )}
          </div>
        )}
      </div>
    </header>
  );
};

export default EditorTopBar;
