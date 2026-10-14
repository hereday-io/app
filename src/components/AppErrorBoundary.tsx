import { Component, type ErrorInfo, type ReactNode } from 'react';
import { Button } from '@/components/ui/button';
import { reportError } from '@/lib/posthog';

/**
 * Last line of defence: without it a render error unmounts the whole
 * tree and leaves a blank white page, with nothing reported anywhere.
 *
 * Sits outside every provider so it also catches their failures, which
 * is why the fallback uses plain links and window.location rather than
 * the router. A reload also fixes the most common cause in practice: a
 * lazy route chunk that 404s because a deploy replaced it mid-session.
 */
export default class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false };

  static getDerivedStateFromError() {
    return { failed: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    reportError(error, {
      area: 'app',
      action: 'render',
      path: window.location.pathname,
      component_stack: info.componentStack ?? undefined,
    });
  }

  render() {
    if (!this.state.failed) return this.props.children;
    return (
      <div className="min-h-screen flex items-center justify-center bg-background px-6">
        <div role="alert" className="max-w-md text-center space-y-4">
          <h1 className="text-2xl font-semibold text-foreground">Something went wrong</h1>
          <p className="text-muted-foreground">
            This page hit an error and couldn't finish loading. We've been notified.
            Reloading usually fixes it.
          </p>
          <div className="flex items-center justify-center gap-3">
            <Button onClick={() => window.location.reload()}>Reload page</Button>
            <Button variant="outline" asChild>
              <a href="/dashboard">Go to dashboard</a>
            </Button>
          </div>
          <p className="text-sm text-muted-foreground">
            Still stuck? Email <a className="underline" href="mailto:support@hereday.io">support@hereday.io</a>.
          </p>
        </div>
      </div>
    );
  }
}
