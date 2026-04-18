import { useState, useRef, useEffect } from 'react';
import { Button } from '@/components/ui/button';
import { ArrowLeft, Undo2, Trash2, Save, Loader2, HelpCircle, Globe, Check, Copy, ExternalLink, EyeOff, PanelLeft, PanelLeftClose, Share2, Cloud, CloudOff, Pencil, Compass } from 'lucide-react';
import LocationSearch from '@/components/editor/LocationSearch';
import ShareQrCode from '@/components/editor/ShareQrCode';
import { logEvent } from '@/lib/analytics';

interface EditorTopBarProps {
  eventName: string;
  setEventName: (v: string) => void;
  city: string;
  setCity: (v: string) => void;
  eventDate: string;
  setEventDate: (v: string) => void;
  isSaving: boolean;
  isSnapping: boolean;
  isPublishing?: boolean;
  isPublished?: boolean;
  /** When false, the Publish button is disabled with an explanatory
   *  tooltip. Set by RouteEditor based on pre-publish validation — we
   *  refuse to put an empty event in front of the organizer's audience.
   *  Ignored while `isPublished` is true (Live pill path handles its
   *  own two-step unpublish flow). */
  canPublish?: boolean;
  /** Count of POIs dropped via scout links that haven't been reviewed
   *  yet. Used to show an amber dot badge on the Compass button so the
   *  icon alone stops being the only signal that work is waiting. */
  pendingScoutedCount?: number;
  publicUrl?: string;
  eventId?: string | null;
  mapboxToken: string;
  onSave: () => void;
  onBack: () => void;
  onUndo: () => void;
  onClearRoute: () => void;
  onLocationSelect: (center: [number, number], name: string) => void;
  onHelp?: () => void;
  onScoutLink?: () => void;
  onPublish?: () => void;
  onFinishRoute?: () => void;
  canFinishRoute?: boolean;
  sidebarOpen?: boolean;
  onToggleSidebar?: () => void;
  saveState?: 'idle' | 'dirty' | 'saving' | 'saved' | 'error';
  lastSavedAt?: number | null;
  /** Seconds until the next auto-retry of a failed save. When set and
   *  saveState is 'error', the chip swaps "Save failed — retry" for
   *  "Retrying in Ns…" so the user sees the recovery happening instead
   *  of thinking the app has given up. */
  retryCountdown?: number | null;
}

const EditorTopBar = ({
  eventName, setEventName,
  city, setCity,
  eventDate, setEventDate,
  isSaving,
  isSnapping,
  isPublishing,
  isPublished,
  canPublish = true,
  pendingScoutedCount = 0,
  publicUrl,
  eventId,
  mapboxToken,
  onSave,
  onBack,
  onUndo,
  onClearRoute,
  onLocationSelect,
  onHelp,
  onScoutLink,
  onPublish,
  onFinishRoute,
  canFinishRoute,
  sidebarOpen,
  onToggleSidebar,
  saveState = 'idle',
  lastSavedAt,
  retryCountdown,
}: EditorTopBarProps) => {
  // Force-show text labels on toolbar buttons for the first 3 editor
  // sessions so new users discover Tour, Scout, Undo, etc. After 3
  // sessions the labels collapse to icon-only on narrow viewports.
  const [forceLabels] = useState(() => {
    const key = 'hereday_editor_sessions';
    const count = parseInt(localStorage.getItem(key) ?? '0', 10);
    localStorage.setItem(key, String(count + 1));
    return count < 3;
  });
  const labelClass = forceLabels ? 'inline text-xs' : 'hidden lg:inline text-xs';

  const [sharePopoverOpen, setSharePopoverOpen] = useState(false);
  const [livePopoverOpen, setLivePopoverOpen] = useState(false);
  const [unpublishConfirm, setUnpublishConfirm] = useState(false);
  const [copied, setCopied] = useState(false);
  const sharePopoverRef = useRef<HTMLDivElement>(null);
  const livePopoverRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!sharePopoverOpen && !livePopoverOpen) return;
    const handler = (e: MouseEvent) => {
      if (sharePopoverOpen && sharePopoverRef.current && !sharePopoverRef.current.contains(e.target as Node)) {
        setSharePopoverOpen(false);
      }
      if (livePopoverOpen && livePopoverRef.current && !livePopoverRef.current.contains(e.target as Node)) {
        setLivePopoverOpen(false);
        setUnpublishConfirm(false);
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [sharePopoverOpen, livePopoverOpen]);

  const handleCopy = () => {
    if (!publicUrl) return;
    navigator.clipboard.writeText(publicUrl);
    logEvent('share_link_copied', eventId ?? null, { source: 'editor_topbar' });
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  // Human-readable autosave label. Kept terse — this lives in a dense topbar.
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    if (saveState !== 'saved' || !lastSavedAt) return;
    const t = setInterval(() => setNow(Date.now()), 15000);
    return () => clearInterval(t);
  }, [saveState, lastSavedAt]);
  const savedAgoLabel = (() => {
    if (!lastSavedAt) return 'Saved';
    const secs = Math.floor((now - lastSavedAt) / 1000);
    if (secs < 5) return 'Saved just now';
    if (secs < 60) return `Saved ${secs}s ago`;
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `Saved ${mins}m ago`;
    return 'Saved';
  })();

  return (
    <header className="border-b border-border bg-card px-3 py-1.5 flex items-center justify-between gap-2 shrink-0">
      {/* Left: back + sidebar toggle + event details inline */}
      <div className="flex items-center gap-2 min-w-0">
        <Button variant="ghost" size="icon" onClick={onBack} className="h-8 w-8 shrink-0">
          <ArrowLeft className="h-4 w-4" />
        </Button>
        {onToggleSidebar && (
          <Button variant="ghost" size="icon" onClick={onToggleSidebar} className="h-8 w-8 shrink-0" title={sidebarOpen ? 'Hide sidebar' : 'Show sidebar'}>
            {sidebarOpen
              ? <PanelLeftClose className="h-4 w-4" />
              : <PanelLeft className="h-4 w-4" />
            }
          </Button>
        )}
        <div className="group relative flex items-center">
          <input
            value={eventName}
            onChange={(e) => setEventName(e.target.value)}
            className="bg-transparent font-display font-bold text-sm outline-none border-b border-dashed border-border/50 hover:border-border focus:border-primary focus:border-solid transition-colors min-w-0 max-w-[180px] pr-4"
            placeholder="Event name"
          />
          <Pencil className="absolute right-0 h-3 w-3 text-muted-foreground/40 group-hover:text-muted-foreground pointer-events-none transition-colors" />
        </div>
        <span className="text-muted-foreground text-xs hidden md:inline">·</span>
        <div className="group relative hidden md:flex items-center">
          <input
            type="date"
            value={eventDate}
            onChange={(e) => setEventDate(e.target.value)}
            className="bg-transparent text-xs text-muted-foreground outline-none border-b border-dashed border-border/50 hover:border-border focus:border-primary focus:border-solid transition-colors w-[120px]"
          />
        </div>
        <span className="text-muted-foreground text-xs hidden md:inline">·</span>
        <div className="group relative hidden md:flex items-center">
          <input
            value={city}
            onChange={(e) => setCity(e.target.value)}
            className="bg-transparent text-xs text-muted-foreground outline-none border-b border-dashed border-border/50 hover:border-border focus:border-primary focus:border-solid transition-colors max-w-[120px] pr-4"
            placeholder="City"
          />
          <Pencil className="absolute right-0 h-3 w-3 text-muted-foreground/40 group-hover:text-muted-foreground pointer-events-none transition-colors" />
        </div>
      </div>

      {/* Right: tools + actions */}
      <div className="flex items-center gap-1.5 shrink-0">
        {isSnapping && (
          <span className="text-xs text-muted-foreground flex items-center gap-1">
            <Loader2 className="h-3 w-3 animate-spin" /> Snapping…
          </span>
        )}
        {mapboxToken && (
          <LocationSearch token={mapboxToken} onSelect={onLocationSelect} />
        )}
        {/* Icons collapse back to icon-only on narrow viewports; on ≥lg
             screens the text labels surface power features (Tour, Scout)
             that otherwise hide behind a hover tooltip nobody finds. */}
        <Button variant="ghost" size="sm" onClick={onUndo} title="Undo last point" className="h-8 gap-1.5 px-2">
          <Undo2 className="h-4 w-4" />
          <span className={labelClass}>Undo</span>
        </Button>
        <Button variant="ghost" size="sm" onClick={onClearRoute} title="Clear this route" className="h-8 gap-1.5 px-2">
          <Trash2 className="h-4 w-4" />
          <span className={labelClass}>Clear</span>
        </Button>
        {canFinishRoute && onFinishRoute && (
          <Button variant="default" size="sm" onClick={onFinishRoute} title="Finish this route" className="h-8 gap-1.5 px-2">
            <Check className="h-4 w-4" />
            <span className="text-xs">Finish route</span>
          </Button>
        )}
        {onHelp && (
          <Button variant="ghost" size="sm" onClick={onHelp} title="Take a quick tour" className="h-8 gap-1.5 px-2">
            <HelpCircle className="h-4 w-4" />
            <span className={labelClass}>Tour</span>
          </Button>
        )}
        {onScoutLink && (
          <Button
            variant="ghost"
            size="sm"
            onClick={onScoutLink}
            title="Scout link — let volunteers drop pins from their phone"
            className="h-8 gap-1.5 px-2 relative"
          >
            <Compass className="h-4 w-4" />
            <span className={labelClass}>Scout</span>
            {/* Amber dot when scouted POIs are waiting for review.
                Matches the banner pattern — the only surface signal for
                pending volunteer work in the top chrome. */}
            {pendingScoutedCount > 0 && (
              <span
                className="absolute top-1 right-1 block h-2 w-2 rounded-full bg-amber-500 ring-1 ring-card"
                aria-label={`${pendingScoutedCount} scouted POIs pending review`}
              />
            )}
          </Button>
        )}
        {/* Autosave status chip — doubles as a manual-save trigger */}
        <button
          onClick={onSave}
          disabled={isSaving}
          data-tour="save-button"
          title="Autosaved · click to save now"
          className={`h-8 px-2.5 inline-flex items-center gap-1.5 rounded-md text-xs font-medium transition-colors ${
            saveState === 'error'
              ? 'text-destructive hover:bg-destructive/10'
              : saveState === 'saving'
                ? 'text-muted-foreground'
                : saveState === 'dirty'
                  ? 'text-amber-600 dark:text-amber-400 hover:bg-amber-500/10'
                  : 'text-muted-foreground hover:bg-secondary'
          }`}
        >
          {saveState === 'saving' ? (
            <><Loader2 className="h-3.5 w-3.5 animate-spin" /><span className="hidden md:inline">Saving…</span></>
          ) : saveState === 'error' ? (
            <><CloudOff className="h-3.5 w-3.5" /><span className="hidden md:inline">
              {typeof retryCountdown === 'number' && retryCountdown > 0
                ? `Retrying in ${retryCountdown}s…`
                : 'Save failed — retry'}
            </span></>
          ) : saveState === 'dirty' ? (
            <><Save className="h-3.5 w-3.5" /><span className="hidden md:inline">Unsaved — save now</span></>
          ) : (
            <><Cloud className="h-3.5 w-3.5" /><span className="hidden md:inline">{savedAgoLabel}</span></>
          )}
        </button>
        {onPublish && (
          isPublished ? (
            <div className="flex items-center gap-1.5">
              {/* Live pill — opens small unpublish popover */}
              <div className="relative" ref={livePopoverRef}>
                <button
                  onClick={() => { setLivePopoverOpen((v) => !v); setSharePopoverOpen(false); }}
                  className="flex items-center gap-1.5 h-8 px-3 rounded-md bg-emerald-500/10 text-emerald-700 dark:text-emerald-400 text-xs font-semibold hover:bg-emerald-500/15 transition-colors border border-emerald-500/20"
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  Live
                </button>

                {livePopoverOpen && (
                  <div className="absolute right-0 top-full mt-2 w-64 rounded-xl bg-background border border-border shadow-lg z-50 p-2">
                    <div className="px-2 py-1.5">
                      <p className="text-xs text-muted-foreground">This event is publicly visible.</p>
                    </div>
                    {!unpublishConfirm ? (
                      <button
                        onClick={() => setUnpublishConfirm(true)}
                        disabled={isPublishing}
                        className="flex items-center gap-2 w-full px-2 py-2 rounded-md text-sm text-destructive hover:bg-destructive/10 transition-colors"
                      >
                        <EyeOff className="h-4 w-4" />
                        Unpublish event
                      </button>
                    ) : (
                      <div className="px-2 py-2 space-y-2">
                        <p className="text-xs text-foreground font-medium">Really unpublish?</p>
                        <p className="text-[11px] text-muted-foreground">Participants will lose access to this link immediately.</p>
                        <div className="flex gap-1.5 pt-1">
                          <button
                            onClick={() => setUnpublishConfirm(false)}
                            className="flex-1 h-8 rounded-md text-xs font-medium text-muted-foreground hover:bg-secondary transition-colors"
                          >
                            Cancel
                          </button>
                          <button
                            onClick={() => { setLivePopoverOpen(false); setUnpublishConfirm(false); onPublish?.(); }}
                            disabled={isPublishing}
                            className="flex-1 h-8 rounded-md text-xs font-semibold bg-destructive text-destructive-foreground hover:bg-destructive/90 transition-colors"
                          >
                            {isPublishing ? 'Unpublishing…' : 'Unpublish'}
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Share button — opens share popover */}
              <div className="relative" ref={sharePopoverRef}>
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => { setSharePopoverOpen((v) => !v); setLivePopoverOpen(false); }}
                  className="h-8 gap-1.5"
                >
                  <Share2 className="h-3.5 w-3.5" />
                  Share
                </Button>

                {sharePopoverOpen && publicUrl && (
                  <div className="absolute right-0 top-full mt-2 w-80 rounded-xl bg-background border border-border shadow-lg z-50">
                    <div className="px-4 py-3 border-b border-border/50 flex items-center justify-between">
                      <span className="text-sm font-semibold text-foreground">Share event</span>
                      <button onClick={() => setSharePopoverOpen(false)} aria-label="Close share panel" className="text-muted-foreground hover:text-foreground text-lg leading-none">×</button>
                    </div>
                    <div className="px-4 py-3 space-y-3">
                      {/* URL row */}
                      <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 pr-1.5 pl-3 py-1.5">
                        <span className="flex-1 text-xs text-foreground truncate font-mono">{publicUrl}</span>
                        <button
                          onClick={handleCopy}
                          aria-label="Copy event link"
                          className="shrink-0 p-1.5 rounded-md hover:bg-background transition-colors text-muted-foreground hover:text-foreground"
                          title="Copy link"
                        >
                          {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
                        </button>
                      </div>
                      {copied && <p className="text-xs text-emerald-600 font-medium -mt-1">Copied!</p>}

                      {/* Race-day QR code — scans straight to the public page. */}
                      <ShareQrCode url={publicUrl} eventName={eventName} eventId={eventId} />

                      {/* Preview link */}
                      <a
                        href={publicUrl}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="flex items-center gap-2 w-full px-3 py-2 rounded-lg border border-border hover:bg-secondary text-sm font-medium text-foreground transition-colors"
                      >
                        <ExternalLink className="h-4 w-4 text-muted-foreground" />
                        Preview public page
                      </a>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ) : (
            <Button
              size="sm"
              onClick={onPublish}
              disabled={isPublishing || !canPublish}
              title={!canPublish ? 'Draw a route first — you need at least 2 points to publish' : undefined}
              className="h-8 gap-1.5"
            >
              <Globe className="h-4 w-4" />
              {isPublishing ? 'Publishing…' : 'Publish'}
            </Button>
          )
        )}
      </div>
    </header>
  );
};

export default EditorTopBar;
