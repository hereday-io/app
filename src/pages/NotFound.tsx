import { useEffect } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { Compass } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAuth } from '@/hooks/useAuth';

const NotFound = () => {
  const location = useLocation();
  const { user } = useAuth();

  useEffect(() => {
    console.error('404 Error: User attempted to access non-existent route:', location.pathname);
  }, [location.pathname]);

  return (
    <div className="min-h-screen bg-background flex items-center justify-center px-6">
      <div className="max-w-md w-full text-center space-y-4">
        <div className="w-14 h-14 mx-auto rounded-2xl bg-primary/10 text-primary flex items-center justify-center">
          <Compass className="h-7 w-7" />
        </div>
        <div className="space-y-1.5">
          <h1 className="text-2xl font-display font-bold text-foreground">
            We couldn't find that page
          </h1>
          <p className="text-sm text-muted-foreground max-w-sm mx-auto leading-relaxed">
            The link may be out of date, or the event might have wrapped. Try one of these instead.
          </p>
        </div>
        <div className="flex items-center justify-center gap-2 pt-2">
          {user ? (
            <Button size="sm" asChild>
              <Link to="/dashboard">Open dashboard</Link>
            </Button>
          ) : (
            <Button size="sm" asChild>
              <Link to="/">Back to Hereday</Link>
            </Button>
          )}
          <Button variant="outline" size="sm" asChild>
            <Link to="/faq">Visit FAQ</Link>
          </Button>
        </div>
      </div>
    </div>
  );
};

export default NotFound;
