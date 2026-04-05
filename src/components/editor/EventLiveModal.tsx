import { useState } from 'react';
import {
  Dialog,
  DialogContent,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { CheckCircle2, Copy, ExternalLink, Check } from 'lucide-react';

interface EventLiveModalProps {
  open: boolean;
  onClose: () => void;
  publicUrl: string;
  eventName: string;
}

const EventLiveModal = ({ open, onClose, publicUrl, eventName }: EventLiveModalProps) => {
  const [copied, setCopied] = useState(false);

  const handleCopy = async () => {
    await navigator.clipboard.writeText(publicUrl);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="sm:max-w-md overflow-hidden p-0">
        {/* Header */}
        <div className="px-6 pt-6 pb-5 text-center border-b border-border">
          <div className="h-14 w-14 rounded-full bg-emerald-500/10 border-2 border-emerald-500/20 flex items-center justify-center mx-auto mb-4">
            <CheckCircle2 className="h-7 w-7 text-emerald-600 dark:text-emerald-400" />
          </div>
          <h2 className="text-xl font-display font-bold text-foreground">Your event is live!</h2>
          <p className="text-sm text-muted-foreground mt-1">
            <span className="font-medium text-foreground">{eventName}</span> is now publicly accessible.
          </p>
        </div>

        {/* Body */}
        <div className="px-6 py-5 space-y-3">
          <p className="text-xs text-muted-foreground text-center">Share this link with participants and spectators</p>

          {/* URL copy row */}
          <div className="flex items-center gap-2 rounded-lg border border-border bg-muted/50 pr-1.5 pl-3 py-2">
            <span className="flex-1 text-xs text-foreground truncate font-mono">{publicUrl}</span>
            <button
              onClick={handleCopy}
              className="shrink-0 flex items-center gap-1.5 px-2.5 py-1.5 rounded-md bg-background border border-border text-xs font-medium text-foreground hover:bg-secondary transition-colors"
            >
              {copied ? <Check className="h-3.5 w-3.5 text-emerald-600" /> : <Copy className="h-3.5 w-3.5" />}
              {copied ? 'Copied!' : 'Copy'}
            </button>
          </div>

          {/* Primary CTA — preview */}
          <Button className="w-full gap-2" asChild>
            <a href={publicUrl} target="_blank" rel="noopener noreferrer">
              <ExternalLink className="h-4 w-4" />
              Preview public page
            </a>
          </Button>

          {/* Secondary — back to editor */}
          <button
            onClick={onClose}
            className="w-full text-sm text-muted-foreground hover:text-foreground transition-colors py-1"
          >
            Continue editing
          </button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EventLiveModal;
