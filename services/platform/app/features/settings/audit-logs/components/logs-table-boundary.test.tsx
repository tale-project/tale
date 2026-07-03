import { afterEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { LogsTableBoundary } from './logs-table-boundary';

// The auto-retry backoff renders `AuditLogTable` (loading) as a skeleton — stub
// it so the boundary's own behaviour is what's under test, not the table's deep
// hook tree.
vi.mock('./audit-log-table', () => ({
  AuditLogTable: () => <div data-testid="logs-skeleton" />,
}));

// A child that throws on demand. Flipping `shouldThrow.current` to false lets a
// boundary reset re-render it successfully.
const shouldThrow = { current: true };
function Boom({ message }: { message: string }) {
  if (shouldThrow.current) throw new Error(message);
  return <div data-testid="logs-content">logs</div>;
}

afterEach(() => {
  shouldThrow.current = true;
  vi.restoreAllMocks();
});

describe('LogsTableBoundary', () => {
  it('shows an inline retry card for a non-transient error instead of rethrowing', () => {
    // Boundary swallows the error + logs it; keep the test output clean.
    vi.spyOn(console, 'error').mockImplementation(() => {});

    render(
      <LogsTableBoundary>
        <Boom message="boom" />
      </LogsTableBoundary>,
    );

    expect(screen.getByText("Couldn't load logs")).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeInTheDocument();
  });

  it('re-renders the table when the user retries after the cause clears', async () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});

    const { user } = render(
      <LogsTableBoundary>
        <Boom message="boom" />
      </LogsTableBoundary>,
    );

    expect(screen.getByText("Couldn't load logs")).toBeInTheDocument();

    // The transient cause has cleared by the time the user clicks Retry.
    shouldThrow.current = false;
    await user.click(screen.getByRole('button', { name: 'Retry' }));

    expect(screen.getByTestId('logs-content')).toBeInTheDocument();
    expect(screen.queryByText("Couldn't load logs")).not.toBeInTheDocument();
  });

  it('auto-retries a transient timeout, showing the table skeleton during backoff', () => {
    vi.spyOn(console, 'error').mockImplementation(() => {});
    vi.useFakeTimers();

    try {
      render(
        <LogsTableBoundary>
          <Boom message="Request timed out" />
        </LogsTableBoundary>,
      );

      // During the backoff window the skeleton stands in — no hard error card.
      expect(screen.getByTestId('logs-skeleton')).toBeInTheDocument();
      expect(screen.queryByText("Couldn't load logs")).not.toBeInTheDocument();
    } finally {
      vi.useRealTimers();
    }
  });
});
