import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { AuditIntegrityPanel } from './audit-integrity-panel';

// The panel's data hooks are the unit under test's collaborators — drive them
// from a mutable holder so each test sets the exact status / verify result.
const state = vi.hoisted(() => ({
  status: {
    data: null as unknown,
    isLoading: false,
    isError: false,
    isFetching: false,
    errorUpdateCount: 0,
    refetch: vi.fn() as unknown,
  },
  verify: {
    data: undefined as unknown,
    isPending: false,
    isError: false,
    mutate: vi.fn() as unknown,
  },
}));
const toastSpy = vi.hoisted(() => vi.fn());

vi.mock('../hooks/integrity', () => ({
  useIntegrityStatus: () => state.status,
  useVerifyIntegrity: () => state.verify,
}));

vi.mock('@tale/ui/use-toast', () => ({
  useToast: () => ({ toast: toastSpy }),
  toast: toastSpy,
}));

// A fixed instant so the "last check" line is deterministic.
const NOW = 1_700_000_000_000;

function renderPanel(onOpenRow = vi.fn()) {
  const result = render(
    <AuditIntegrityPanel organizationId="org-1" onOpenRow={onOpenRow} />,
  );
  return { onOpenRow, ...result };
}

/** The status read: answered with `data`, unless the test fails it. */
function statusRead(overrides: Partial<typeof state.status> = {}) {
  return {
    data: null as unknown,
    isLoading: false,
    isError: false,
    isFetching: false,
    errorUpdateCount: 0,
    refetch: vi.fn() as unknown,
    ...overrides,
  };
}

beforeEach(() => {
  state.status = statusRead();
  state.verify = {
    data: undefined,
    isPending: false,
    isError: false,
    mutate: vi.fn(),
  };
  toastSpy.mockClear();
});

describe('AuditIntegrityPanel', () => {
  it('claims nothing about past checks while the status is loading', () => {
    state.status = statusRead({ data: undefined, isLoading: true });
    renderPanel();
    expect(screen.getByText('Chain integrity')).toBeInTheDocument();
    expect(screen.queryByText('Not yet checked')).toBeNull();
    expect(
      screen.queryByText('No automated integrity check has run yet.'),
    ).toBeNull();
  });

  it('shows "not yet checked" when the org has no progress row', () => {
    renderPanel();
    expect(screen.getByText('Chain integrity')).toBeInTheDocument();
    expect(screen.getByText('Not yet checked')).toBeInTheDocument();
    expect(
      screen.getByText('No automated integrity check has run yet.'),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'Verify now' }),
    ).toBeInTheDocument();
  });

  it('shows a verified badge + last-check time when a clean check has run', () => {
    state.status = statusRead({
      data: { headReached: true, updatedAt: NOW, alertActive: false },
    });
    renderPanel();
    expect(screen.getByText('Verified')).toBeInTheDocument();
    expect(screen.getByText(/Last automated check:/)).toBeInTheDocument();
  });

  it('shows an active integrity alert badge with the alert time', () => {
    state.status = statusRead({
      data: {
        headReached: false,
        updatedAt: NOW,
        alertActive: true,
        lastAlertedAt: NOW + 500,
        lastAlertedFingerprint: 'fp',
      },
    });
    renderPanel();
    expect(screen.getByText('Integrity alert active')).toBeInTheDocument();
    expect(screen.getByText(/Alert raised/)).toBeInTheDocument();
  });

  it('runs verify-now and renders a success result with the count', async () => {
    const mutate = vi.fn();
    state.verify = {
      data: {
        valid: true,
        verifiedCount: 42,
        checkpointsVerified: 2,
        truncated: false,
        unsignedScrubCount: 0,
        awaitingSeal: { count: 0 },
      },
      isPending: false,
      isError: false,
      mutate,
    };
    const { user } = renderPanel();
    await user.click(screen.getByRole('button', { name: 'Verify now' }));
    expect(mutate).toHaveBeenCalledWith(
      { organizationId: 'org-1' },
      expect.objectContaining({ onError: expect.any(Function) }),
    );
    expect(screen.getByText('Chain verified')).toBeInTheDocument();
    expect(screen.getByText(/Checked 42 entries/)).toBeInTheDocument();
  });

  it('surfaces the truncation note when the walk was capped', () => {
    state.verify = {
      data: {
        valid: true,
        verifiedCount: 1000,
        checkpointsVerified: 0,
        truncated: true,
        unsignedScrubCount: 0,
        awaitingSeal: { count: 0 },
      },
      isPending: false,
      isError: false,
      mutate: vi.fn(),
    };
    renderPanel();
    expect(
      screen.getByText(/Only the first 1000 entries were checked/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /Ask your deployment operator to verify the remaining range/,
      ),
    ).toBeInTheDocument();
  });

  it('directs an uncovered scrub finding to erasure records', () => {
    state.verify = {
      data: {
        valid: true,
        verifiedCount: 42,
        checkpointsVerified: 0,
        truncated: false,
        unsignedScrubCount: 2,
        awaitingSeal: { count: 0 },
      },
      isPending: false,
      isError: false,
      mutate: vi.fn(),
    };
    renderPanel();
    expect(
      screen.getByText(/2 scrubbed entries have no matching erasure request/),
    ).toBeInTheDocument();
    expect(screen.queryByText(/signing key/)).not.toBeInTheDocument();
  });

  it('says when entries written moments ago are not in the chain yet', () => {
    state.verify = {
      data: {
        valid: true,
        verifiedCount: 42,
        checkpointsVerified: 0,
        truncated: false,
        unsignedScrubCount: 0,
        awaitingSeal: { count: 3, oldestTimestamp: 1_760_000_000_000 },
      },
      isPending: false,
      isError: false,
      mutate: vi.fn(),
    };
    renderPanel();
    expect(
      screen.getByText(
        /3 entries were written moments ago and are not in the chain yet/,
      ),
    ).toBeInTheDocument();
  });

  it('renders broken-chain details and wires the open-row button', async () => {
    state.verify = {
      data: {
        valid: false,
        verifiedCount: 5,
        checkpointsVerified: 1,
        truncated: false,
        unsignedScrubCount: 0,
        awaitingSeal: { count: 0 },
        firstBrokenAt: {
          logId: 'log_bad',
          timestamp: NOW,
          expected: 'expected-hash-aaa',
          actual: 'actual-hash-bbb',
        },
      },
      isPending: false,
      isError: false,
      mutate: vi.fn(),
    };
    const onOpenRow = vi.fn();
    const { user } = renderPanel(onOpenRow);
    expect(screen.getByText('Chain integrity broken')).toBeInTheDocument();
    expect(screen.getByText('log_bad')).toBeInTheDocument();
    expect(screen.getByText('expected-hash-aaa')).toBeInTheDocument();
    expect(screen.getByText('actual-hash-bbb')).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Open this entry' }));
    expect(onOpenRow).toHaveBeenCalledWith('log_bad');
  });

  it('toasts when verification errors', async () => {
    state.verify = {
      data: undefined,
      isPending: false,
      isError: false,
      mutate: (_args: unknown, opts?: { onError?: (e: Error) => void }) =>
        opts?.onError?.(new Error('boom')),
    };
    const { user } = renderPanel();
    await user.click(screen.getByRole('button', { name: 'Verify now' }));
    expect(toastSpy).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' }),
    );
  });

  it('passes an axe audit in the alert-active + broken state', async () => {
    state.status = statusRead({
      data: {
        headReached: false,
        updatedAt: NOW,
        alertActive: true,
        lastAlertedAt: NOW + 500,
      },
    });
    state.verify = {
      data: {
        valid: false,
        verifiedCount: 5,
        checkpointsVerified: 1,
        truncated: false,
        unsignedScrubCount: 0,
        awaitingSeal: { count: 0 },
        firstBrokenAt: {
          logId: 'log_bad',
          timestamp: NOW,
          expected: 'expected-hash-aaa',
          actual: 'actual-hash-bbb',
        },
      },
      isPending: false,
      isError: false,
      mutate: vi.fn(),
    };
    const { container } = renderPanel();
    await checkAccessibility(container);
  });
});

// "No automated integrity check has run yet" over a status that never
// loaded hid whatever alert that status carries (#4834).
describe('AuditIntegrityPanel status read failures', () => {
  it('names a status that failed to load instead of claiming no check has run, and Try again recovers it', async () => {
    const refetch = vi.fn();
    state.status = statusRead({
      data: undefined,
      isError: true,
      errorUpdateCount: 1,
      refetch,
    });
    const { user, rerender } = renderPanel();
    expect(screen.queryByText('Not yet checked')).toBeNull();
    expect(
      screen.queryByText('No automated integrity check has run yet.'),
    ).toBeNull();
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load the integrity status, so this panel can't tell whether an integrity alert is active.",
    );
    const retry = screen.getByRole('button', { name: 'Try again' });
    await user.click(retry);
    expect(refetch).toHaveBeenCalledTimes(1);
    // react-query starts the retry of a read that never answered from
    // pending: the failure stays named, its Try again busy, not a skeleton.
    state.status = statusRead({
      data: undefined,
      isLoading: true,
      isFetching: true,
      errorUpdateCount: 1,
      refetch,
    });
    rerender(
      <AuditIntegrityPanel organizationId="org-1" onOpenRow={vi.fn()} />,
    );
    expect(screen.getByRole('button', { name: 'Try again' })).toBe(retry);
    expect(retry).toHaveAttribute('aria-busy', 'true');
    expect(
      screen.queryByText('No automated integrity check has run yet.'),
    ).toBeNull();
    state.status = statusRead({
      data: {
        headReached: false,
        updatedAt: NOW,
        alertActive: true,
        lastAlertedAt: NOW + 500,
      },
      errorUpdateCount: 1,
      refetch,
    });
    rerender(
      <AuditIntegrityPanel organizationId="org-1" onOpenRow={vi.fn()} />,
    );
    expect(screen.getByText('Integrity alert active')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Try again' })).toBeNull();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('keeps the last status beside a failed refresh and says it may be out of date', async () => {
    const refetch = vi.fn();
    state.status = statusRead({
      data: { headReached: true, updatedAt: NOW, alertActive: false },
      isError: true,
      errorUpdateCount: 1,
      refetch,
    });
    const { user } = renderPanel();
    expect(screen.getByText('Verified')).toBeInTheDocument();
    expect(screen.getByText(/Last automated check:/)).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent(
      "Couldn't load the latest integrity status. What's shown may be out of date.",
    );
    await user.click(screen.getByRole('button', { name: 'Try again' }));
    expect(refetch).toHaveBeenCalledTimes(1);
  });

  it('passes an axe audit while the status cannot be loaded', async () => {
    state.status = statusRead({
      data: undefined,
      isError: true,
      errorUpdateCount: 1,
    });
    const { container } = renderPanel();
    await checkAccessibility(container);
  });
});
