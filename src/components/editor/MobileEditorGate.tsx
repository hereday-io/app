import { Monitor, ArrowLeft } from 'lucide-react';
import { Button } from '@/components/ui/button';

interface MobileEditorGateProps {
  onBack: () => void;
}

/**
 * Shown when the editor is opened on a small touch device. The editor's
 * dense sidebar and precision map interactions aren't usable on phones yet,
 * so we gracefully tell the user to open a laptop rather than silently
 * serving a broken experience.
 */
const MobileEditorGate = ({ onBack }: MobileEditorGateProps) => {
  return (
    <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-6 bg-background px-6 text-center">
      <div className="w-16 h-16 rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
        <Monitor className="h-8 w-8" />
      </div>
      <div className="space-y-2 max-w-sm">
        <h1 className="text-2xl font-display font-bold text-foreground">Open this on a computer</h1>
        <p className="text-sm text-muted-foreground leading-relaxed">
          The route editor needs a mouse or trackpad. Open this link on a laptop
          or desktop and pick up right where you left off.
        </p>
      </div>
      <p className="text-xs text-muted-foreground">
        Your published event works great on phones — editing is the only part that needs a bigger screen.
      </p>
      <Button variant="outline" onClick={onBack} className="mt-2">
        <ArrowLeft className="h-4 w-4 mr-2" />
        Back to dashboard
      </Button>
    </div>
  );
};

export default MobileEditorGate;
