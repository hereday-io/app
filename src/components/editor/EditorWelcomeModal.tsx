import { useState } from 'react';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
} from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { MapPin, Route, Mountain, Save, MousePointerClick } from 'lucide-react';

const STORAGE_KEY = 'editor-welcome-seen';

interface EditorWelcomeModalProps {
  onStartTour: () => void;
}

const steps = [
  {
    icon: MousePointerClick,
    title: 'Draw Your Route',
    description: 'Click on the map to place waypoints. Your route will snap to roads automatically.',
  },
  {
    icon: Route,
    title: 'Manage Routes',
    description: 'Add multiple routes (5K, 10K, etc.) from the sidebar. Toggle visibility and customize colors.',
  },
  {
    icon: MapPin,
    title: 'Add Points of Interest',
    description: 'Place water stations, parking, start/finish lines, and more using the POI buttons.',
  },
  {
    icon: Mountain,
    title: 'View Elevation',
    description: 'Click the Elevation button to see the elevation profile for your active route.',
  },
  {
    icon: Save,
    title: 'Save & Publish',
    description: 'Save your work anytime. When ready, publish from the dashboard to share with participants.',
  },
];

const EditorWelcomeModal = ({ onStartTour }: EditorWelcomeModalProps) => {
  const [open, setOpen] = useState(() => {
    return !localStorage.getItem(STORAGE_KEY);
  });

  const handleClose = (startTour: boolean) => {
    localStorage.setItem(STORAGE_KEY, 'true');
    setOpen(false);
    if (startTour) onStartTour();
  };

  return (
    <Dialog open={open} onOpenChange={(v) => !v && handleClose(false)}>
      <DialogContent className="sm:max-w-lg">
        <DialogHeader>
          <DialogTitle className="text-xl font-display flex items-center gap-2">
            <MapPin className="h-5 w-5 text-primary" />
            Welcome to the Route Editor
          </DialogTitle>
          <DialogDescription>
            Build beautiful event maps in just a few steps.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3 my-4">
          {steps.map((step, i) => (
            <div key={i} className="flex items-start gap-3 p-3 rounded-lg bg-secondary/50">
              <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
                <step.icon className="h-4 w-4 text-primary" />
              </div>
              <div>
                <p className="text-sm font-semibold text-foreground">{step.title}</p>
                <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
              </div>
            </div>
          ))}
        </div>

        <div className="flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={() => handleClose(false)}>
            Skip
          </Button>
          <Button size="sm" onClick={() => handleClose(true)}>
            Take a Quick Tour
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};

export default EditorWelcomeModal;
