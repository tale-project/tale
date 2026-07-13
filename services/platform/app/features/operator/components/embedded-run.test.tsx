// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { EmbeddedRun } from './embedded-run';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => `${ns}.${key}`,
  }),
}));

vi.mock('../hooks/use-execution-projection', () => ({
  useExecutionProjection: () => ({
    projection: mockProjection,
    isLoading: false,
    error: undefined,
  }),
}));

vi.mock('@/app/hooks/use-convex-mutation', () => ({
  useConvexMutation: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('./rerun-button', () => ({
  RerunButton: ({ executionId }: { executionId: string }) => (
    <button type="button">rerun:{executionId}</button>
  ),
}));

vi.mock('./operator-view', () => ({
  OperatorView: () => <div data-testid="operator-view" />,
}));

vi.mock('@/app/components/ui/dialog/confirm-dialog', () => ({
  ConfirmDialog: () => null,
}));

let mockProjection: { status: string };

describe('EmbeddedRun — Re-run visibility', () => {
  it('shows Re-run only when the execution failed', () => {
    mockProjection = { status: 'failed' };
    render(
      <EmbeddedRun
        organizationId="org_1"
        executionId={'exec_failed' as never}
      />,
    );
    expect(screen.getByText('rerun:exec_failed')).toBeInTheDocument();
  });

  it('hides Re-run on a failed run when the surface owns re-run (showRerun=false)', () => {
    // Desk subject-linked views pass showRerun={false}: their Start owns the
    // re-run, so a user-cancelled (terminal-failed) run must not also show it.
    mockProjection = { status: 'failed' };
    render(
      <EmbeddedRun
        organizationId="org_1"
        executionId={'exec_failed' as never}
        showRerun={false}
      />,
    );
    expect(screen.queryByText(/rerun:/)).not.toBeInTheDocument();
    expect(screen.getByTestId('operator-view')).toBeInTheDocument();
  });

  it('hides Re-run on a successful completed run', () => {
    mockProjection = { status: 'completed' };
    render(
      <EmbeddedRun organizationId="org_1" executionId={'exec_ok' as never} />,
    );
    expect(screen.queryByText(/rerun:/)).not.toBeInTheDocument();
    expect(screen.getByTestId('operator-view')).toBeInTheDocument();
  });

  it('hides Re-run while the run is in flight', () => {
    mockProjection = { status: 'running' };
    render(
      <EmbeddedRun organizationId="org_1" executionId={'exec_run' as never} />,
    );
    expect(screen.queryByText(/rerun:/)).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'operator.stop.button' }),
    ).not.toBeInTheDocument();
  });

  it('shows Stop while in flight only when showStop is opted in', () => {
    mockProjection = { status: 'running' };
    render(
      <EmbeddedRun
        organizationId="org_1"
        executionId={'exec_run' as never}
        showStop
      />,
    );
    expect(
      screen.getByRole('button', { name: 'operator.stop.button' }),
    ).toBeInTheDocument();
  });
});
