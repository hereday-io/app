import { useEffect } from 'react';
import { Keyboard } from 'lucide-react';

const isMac = typeof navigator !== 'undefined' && /Mac/.test(navigator.platform);
const mod = isMac ? '⌘' : 'Ctrl';

const SHORTCUTS = [
  { keys: `${mod} + S`, label: 'Save event' },
  { keys: `${mod} + Z`, label: 'Undo last point' },
  { keys: 'S', label: 'Toggle snap to roads' },
  { keys: 'Delete', label: 'Delete selected marker (or clear route)' },
  { keys: 'Esc', label: 'Cancel POI placement · close popover' },
  { keys: 'Shift + click', label: 'Keep marker type armed for batch placing' },
  { keys: 'Drag marker', label: 'Move a marker to a new spot' },
  { keys: '?', label: 'Show this cheat sheet' },
];

interface Props {
  open: boolean;
  onClose: () => void;
}

const KeyboardShortcutsOverlay = ({ open, onClose }: Props) => {
  useEffect(() => {
    if (!open) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={onClose}>
      <div
        className="bg-card border border-border rounded-xl shadow-2xl w-full max-w-sm mx-4 overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="px-5 py-4 border-b border-border flex items-center gap-2">
          <Keyboard className="h-4 w-4 text-primary" />
          <h2 className="text-sm font-semibold text-foreground">Keyboard Shortcuts</h2>
          <button onClick={onClose} className="ml-auto text-muted-foreground hover:text-foreground text-lg leading-none">×</button>
        </div>
        <div className="px-5 py-3 space-y-1">
          {SHORTCUTS.map((s) => (
            <div key={s.keys} className="flex items-center justify-between py-1.5">
              <span className="text-sm text-foreground">{s.label}</span>
              <kbd className="inline-flex items-center gap-1 rounded-md border border-border bg-muted px-2 py-0.5 text-xs font-mono text-muted-foreground">
                {s.keys}
              </kbd>
            </div>
          ))}
        </div>
        <div className="px-5 py-3 border-t border-border">
          <p className="text-xs text-muted-foreground text-center">Press <kbd className="border border-border bg-muted px-1 rounded text-[10px]">?</kbd> or <kbd className="border border-border bg-muted px-1 rounded text-[10px]">Esc</kbd> to close</p>
        </div>
      </div>
    </div>
  );
};

export default KeyboardShortcutsOverlay;
