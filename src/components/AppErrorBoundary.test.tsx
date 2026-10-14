import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import AppErrorBoundary from './AppErrorBoundary';

const reportError = vi.fn();
vi.mock('@/lib/posthog', () => ({ reportError: (...args: unknown[]) => reportError(...args) }));

const Boom = () => {
  throw new Error('render exploded');
};

describe('AppErrorBoundary', () => {
  it('renders its children when nothing throws', () => {
    render(<AppErrorBoundary><p>fine</p></AppErrorBoundary>);
    expect(screen.getByText('fine')).toBeTruthy();
  });

  it('shows a fallback instead of a blank page and reports the error', () => {
    // React logs caught render errors itself; keep the test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {});
    render(<AppErrorBoundary><Boom /></AppErrorBoundary>);
    expect(screen.getByRole('alert').textContent).toContain('Something went wrong');
    expect(screen.getByRole('button', { name: 'Reload page' })).toBeTruthy();
    expect(reportError).toHaveBeenCalledWith(
      expect.objectContaining({ message: 'render exploded' }),
      expect.objectContaining({ area: 'app', action: 'render', component_stack: expect.any(String) }),
    );
  });
});
