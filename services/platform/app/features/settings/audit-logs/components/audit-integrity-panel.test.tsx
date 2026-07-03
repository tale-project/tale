import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { AuditIntegrityPanel } from './audit-integrity-panel';

// The panel's data hooks are the unit under test's collaborators — drive them
// from a mutable holder so each test sets the exact status / verify result.
const state = vi.hoisted(() => ({
  status: { data: null as unknown, isLoading: false },
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

vi.mock('@/app/hooks/use-toast', () => ({
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

beforeEach(() => {
  state.status = { data: null, isLoading: false };
  state.verify = {
    data: undefined,
    isPending: false,
    isError: false,
    mutate: vi.fn(),
  };
  toastSpy.mockClear();
});

describe('AuditIntegrityPanel', () => {
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
    state.status = {
      data: { headReached: true, updatedAt: NOW, alertActive: false },
      isLoading: false,
    };
    renderPanel();
    expect(screen.getByText('Verified')).toBeInTheDocument();
    expect(screen.getByText(/Last automated check:/)).toBeInTheDocument();
  });

  it('shows an active integrity alert badge with the alert time', () => {
    state.status = {
      data: {
        headReached: false,
        updatedAt: NOW,
        alertActive: true,
        lastAlertedAt: NOW + 500,
        lastAlertedFingerprint: 'fp',
      },
      isLoading: false,
    };
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
      },
      isPending: false,
      isError: false,
      mutate: vi.fn(),
    };
    renderPanel();
    expect(
      screen.getByText(/Only the first 1000 entries were checked/),
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

  it('renders a checkpoint mismatch when there is no broken row', () => {
    state.verify = {
      data: {
        valid: false,
        verifiedCount: 0,
        checkpointsVerified: 0,
        truncated: false,
        unsignedScrubCount: 0,
        checkpointMismatch: {
          checkpointId: 'cp_1',
          reason: 'HMAC signature does not match.',
        },
      },
      isPending: false,
      isError: false,
      mutate: vi.fn(),
    };
    renderPanel();
    expect(
      screen.getByText('Checkpoint verification failed'),
    ).toBeInTheDocument();
    expect(screen.getByText('cp_1')).toBeInTheDocument();
    expect(
      screen.getByText('HMAC signature does not match.'),
    ).toBeInTheDocument();
    // No broken row → no "open entry" affordance.
    expect(
      screen.queryByRole('button', { name: 'Open this entry' }),
    ).not.toBeInTheDocument();
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
    state.status = {
      data: {
        headReached: false,
        updatedAt: NOW,
        alertActive: true,
        lastAlertedAt: NOW + 500,
      },
      isLoading: false,
    };
    state.verify = {
      data: {
        valid: false,
        verifiedCount: 5,
        checkpointsVerified: 1,
        truncated: false,
        unsignedScrubCount: 0,
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
