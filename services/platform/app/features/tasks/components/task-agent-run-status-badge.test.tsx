import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';

import { TaskAgentRunStatusBadge } from './task-agent-run-status-badge';

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === 'agentRuns.status.running') return 'Running';
      if (key === 'agentRuns.status.failed') return 'Failed';
      if (key === 'agentRuns.detail.openAria') {
        return `Open ${String(values?.status)} details for ${String(values?.agent)}`;
      }
      if (key === 'agentRuns.detail.runningTitle') {
        return `${String(values?.agent)} — live run`;
      }
      if (key === 'agentRuns.detail.failedTitle') {
        return `${String(values?.agent)} — run failed`;
      }
      if (key === 'agentRuns.detail.noLiveDetail') {
        return 'No live transcript is available for this run.';
      }
      return key;
    },
  }),
}));

vi.mock('@/app/features/operator/components/embedded-run', () => ({
  EmbeddedRun: ({ executionId }: { executionId: string }) => (
    <div data-testid="embedded-run">{executionId}</div>
  ),
}));

vi.mock('@/app/components/ui/dialog/view-dialog', () => ({
  ViewDialog: ({
    open,
    title,
    children,
  }: {
    open: boolean;
    title: string;
    children: React.ReactNode;
  }) =>
    open ? (
      <div role="dialog" aria-label={title}>
        {children}
      </div>
    ) : null,
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org_1',
}));

describe('TaskAgentRunStatusBadge', () => {
  it('opens the live EmbeddedRun dialog when a running badge is clicked', async () => {
    const user = userEvent.setup();
    render(
      <TaskAgentRunStatusBadge
        organizationId="org_1"
        agentName="PR Creator"
        run={{
          runId: 'run_1' as Id<'taskAgentRuns'>,
          agentSlug: 'github/create-pull-requests/pr-creator',
          trigger: 'mention',
          status: 'running',
          startedAt: Date.now(),
          costCents: 0,
          wfExecutionId: 'exec_1' as Id<'wfExecutions'>,
        }}
      />,
    );

    await user.click(
      screen.getByRole('button', {
        name: 'Open Running details for PR Creator',
      }),
    );

    expect(
      screen.getByRole('dialog', { name: 'PR Creator — live run' }),
    ).toBeInTheDocument();
    expect(screen.getByTestId('embedded-run')).toHaveTextContent('exec_1');
  });

  it('shows the stored error when a failed run has no execution id', async () => {
    const user = userEvent.setup();
    render(
      <TaskAgentRunStatusBadge
        organizationId="org_1"
        agentName="PR Creator"
        run={{
          runId: 'run_2' as Id<'taskAgentRuns'>,
          agentSlug: 'github/create-pull-requests/pr-creator',
          trigger: 'assignment',
          status: 'failed',
          error: 'TokenSourceError: broker request failed',
          startedAt: Date.now(),
          costCents: 0,
          durationMs: 4000,
        }}
      />,
    );

    await user.click(
      screen.getByRole('button', {
        name: 'Open Failed details for PR Creator',
      }),
    );

    expect(
      screen.getByRole('dialog', { name: 'PR Creator — run failed' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('TokenSourceError: broker request failed'),
    ).toBeInTheDocument();
  });
});
