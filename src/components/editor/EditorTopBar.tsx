import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { ArrowLeft, Undo2, Trash2, Save, Loader2, HelpCircle, Globe, Check, Copy, ExternalLink, EyeOff } from 'lucide-react';
import LocationSearch from '@/components/editor/LocationSearch';

interface EditorTopBarProps {
  eventName: string;
  setEventName: (v: string) => void;
  city: string;
  setCity: (v: string) => void;
  eventDate: string;
  setEventDate: (v: string) => void;
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
  eventName, setEventName,
  city, setCity,
  eventDate, setEventDate,
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
  const [popoverOpen, setPopoverOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  const popoverRef = useRef<HTMLDivElement>(null);

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
    <header className="border-b border-border bg-card px-3 py-1.5 flex items-center justify-between gap-2 shrink-0">
      {/* Left: back + event details inline */}
      <div className="flex items-center gap-2 min-w-0">
        <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8 shrink-0">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        <input
          value={eventName}
          onChange={(e) => setEventName(e.target.value)}
          className="bg-transparent font-display font-bold text-sm outline-none border-b border-transparent hover:border-border focus:border-primary transition-colors min-w-0 max-w-[180px]"
          placeholder="Event name"
        />
        <span className="text-muted-foreground text-xs hidden md:inline">·</span>
        <input
          type="date"
          value={eventDate}
          onChange={(e) => setEventDate(e.target.value)}
          className="bg-transparent text-xs text-muted-foreground outline-none border-b border-transparent hover:border-border focus:border-primary transition-colors w-[110px] hidden md:inline"
        />
        <span className="text-muted-foreground text-xs hidden md:inline">·</span>
        <input
          value={city}
          onChange={(e) => setCity(e.target.value)}
          className="bg-transparent text-xs text-muted-foreground outline-none border-b border-transparent hover:border-border focus:border-primary transition-colors max-w-[120px] hidden md:inline"
          placeholder="City"
        />
      </div>

      {/* Right: tools + actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        {isSnapping && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> Snapping…
          </span>
        )}
        <span className="text-xs text-muted-foreground hidden lg:inline max-w-36 truncate">
          {statusText}
        </span>
        {mapboxToken && (
          <LocationSearch token={mapboxToken} onSelect={onLocationSelect} />
        )}
        <Button variant="ghost" size="sm" onClick={onUndo} title="Undo last point" className="h-8 w-8 p-0">
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={onClearRoute} title="Clear active route" className="h-8 w-8 p-0">
          <Trash2 className="h-4 w-4" />
        </Button>
        {onHelp && (
          <Button variant="ghost" size="sm" onClick={onHelp} title="Show editor tour" className="h-8 w-8 p-0">
            <HelpCircle className="h-4 w-4" />
          </Button>
        )}
        <Button size="sm" onClick={onSave} disabled={isSaving} data-tour="save-button" className="h-8">
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
              className="h-8"
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
