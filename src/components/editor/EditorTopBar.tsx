import { Button } from '@/components/ui/button';
import { ArrowLeft, Undo2, Trash2, Save, Loader2 } from 'lucide-react';

interface EditorTopBarProps {
  eventName: string;
  city: string;
  eventDate: string;
  statusText: string;
  isSaving: boolean;
  isSnapping: boolean;
  onSave: () => void;
  onBack: () => void;
  onUndo: () => void;
  onClearRoute: () => void;
}

const EditorTopBar = ({
  eventName,
  city,
  eventDate,
  statusText,
  isSaving,
  isSnapping,
  onSave,
  onBack,
  onUndo,
  onClearRoute,
}: EditorTopBarProps) => {
  const meta = [city, eventDate].filter(Boolean).join(' · ');

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
        <Button variant="ghost" size="sm" onClick={onUndo} title="Undo last point">
          <Undo2 className="h-4 w-4" />
        </Button>
        <Button variant="ghost" size="sm" onClick={onClearRoute} title="Clear active route">
          <Trash2 className="h-4 w-4" />
        </Button>
        <Button size="sm" onClick={onSave} disabled={isSaving}>
          <Save className="h-4 w-4 mr-1" />
          {isSaving ? 'Saving…' : 'Save'}
        </Button>
      </div>
    </header>
  );
};

export default EditorTopBar;
