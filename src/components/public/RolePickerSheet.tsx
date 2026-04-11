import { useEffect, useState } from 'react';
import { Trophy, Eye, X } from 'lucide-react';

interface RolePickerSheetProps {
  /** Shown only when the user has not yet picked a role on this device.
   *  Mounted *over* an already-rendered public view (Runner/Spectator)
   *  so the map stays visible from the first frame — progressive
   *  disclosure instead of a full-screen interstitial. */
  onPick: (mode: 'runner' | 'spectator') => void;
  /** Dismiss implicitly picks the spectator role: it's the
   *  lower-commitment default for a cold QR visitor who might not
   *  even be running. */
  onDismiss: () => void;
}

const RolePickerSheet = ({ onPick, onDismiss }: RolePickerSheetProps) => {
  const [visible, setVisible] = useState(false);

  // Slide-in on mount so the sheet feels like a considered UI element,
  // not a blocking modal that appeared under your thumb.
  useEffect(() => {
    const t = setTimeout(() => setVisible(true), 60);
    return () => clearTimeout(t);
  }, []);

  return (
    <div
      className="pointer-events-none fixed inset-x-0 bottom-0 z-40 flex justify-center px-3"
      style={{ paddingBottom: 'max(1rem, env(safe-area-inset-bottom))' }}
    >
      <div
        className={`pointer-events-auto w-full max-w-md rounded-2xl bg-card/95 backdrop-blur-xl shadow-2xl ring-1 ring-black/[0.08] border border-border/50 transition-all duration-300 ${
          visible ? 'translate-y-0 opacity-100' : 'translate-y-6 opacity-0'
        }`}
      >
        <div className="flex items-start justify-between gap-2 px-4 pt-3 pb-1">
          <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mt-1">
            Who are you here for?
          </p>
          <button
            type="button"
            onClick={onDismiss}
            className="h-7 w-7 -mt-0.5 -mr-1 flex items-center justify-center rounded-md text-muted-foreground hover:bg-secondary hover:text-foreground transition-colors"
            aria-label="Dismiss"
          >
            <X className="h-4 w-4" />
          </button>
        </div>
        <div className="grid grid-cols-2 gap-2 p-3 pt-2">
          <button
            type="button"
            onClick={() => onPick('runner')}
            className="group flex flex-col items-start gap-2 rounded-xl border border-border bg-background hover:border-primary/50 hover:bg-primary/5 active:scale-[0.98] transition-all p-3 text-left"
          >
            <div className="h-9 w-9 rounded-lg bg-primary/10 text-primary flex items-center justify-center group-hover:bg-primary group-hover:text-primary-foreground transition-colors">
              <Trophy className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">I'm running</p>
              <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                Course, aid, water
              </p>
            </div>
          </button>
          <button
            type="button"
            onClick={() => onPick('spectator')}
            className="group flex flex-col items-start gap-2 rounded-xl border border-border bg-background hover:border-accent/50 hover:bg-accent/5 active:scale-[0.98] transition-all p-3 text-left"
          >
            <div className="h-9 w-9 rounded-lg bg-accent/10 text-accent flex items-center justify-center group-hover:bg-accent group-hover:text-accent-foreground transition-colors">
              <Eye className="h-4 w-4" />
            </div>
            <div>
              <p className="text-sm font-semibold text-foreground">I'm watching</p>
              <p className="text-[11px] text-muted-foreground leading-tight mt-0.5">
                Parking, viewing spots
              </p>
            </div>
          </button>
        </div>
      </div>
    </div>
  );
};

export default RolePickerSheet;
