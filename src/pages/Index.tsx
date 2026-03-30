import { Link } from 'react-router-dom';
import { Button } from '@/components/ui/button';
import { MapPin, ArrowRight, Route, MapPinned, Globe } from 'lucide-react';

const Index = () => {
  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Nav */}
      <header className="border-b border-border bg-card">
        <div className="container mx-auto flex items-center justify-between py-4 px-4">
          <div className="flex items-center gap-2 text-primary">
            <MapPin className="h-6 w-6" />
            <span className="text-xl font-display font-bold tracking-tight">Event Mapper</span>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="ghost" size="sm" asChild>
              <Link to="/login">Sign in</Link>
            </Button>
            <Button size="sm" asChild>
              <Link to="/signup">Get started</Link>
            </Button>
          </div>
        </div>
      </header>

      {/* Hero */}
      <main className="flex-1 flex items-center justify-center px-4">
        <div className="max-w-2xl text-center space-y-6 py-20">
          <h1 className="text-4xl sm:text-5xl font-display font-bold leading-tight">
            Map your events.
            <br />
            <span className="text-primary">Share with the world.</span>
          </h1>
          <p className="text-lg text-muted-foreground max-w-lg mx-auto">
            Create interactive maps for races, tours, and events. Define routes, mark points of interest,
            and publish beautiful public map pages.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button size="lg" asChild>
              <Link to="/signup">
                Start for free <ArrowRight className="ml-2 h-4 w-4" />
              </Link>
            </Button>
          </div>

          {/* Feature pills */}
          <div className="flex flex-wrap items-center justify-center gap-3 pt-4">
            {[
              { icon: Route, label: 'Multi-route courses' },
              { icon: MapPinned, label: 'Points of interest' },
              { icon: Globe, label: 'Public event pages' },
            ].map(({ icon: Icon, label }) => (
              <div
                key={label}
                className="flex items-center gap-2 text-sm text-muted-foreground bg-secondary rounded-full px-4 py-2"
              >
                <Icon className="h-4 w-4 text-primary" />
                {label}
              </div>
            ))}
          </div>
        </div>
      </main>
    </div>
  );
};

export default Index;
