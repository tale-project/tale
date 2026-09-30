import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import { TaskAgentRunStatusBadge } from './task-agent-run-status-badge';

vi.mock('@tale/ui/i18n/client', () => ({
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

vi.mock('@tale/ui/dialog/view-dialog', () => ({
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
  // The embedded live-run transcript is offline while the automations backend
  // is rebuilt — a linked execution opens the dialog with the "no live
  // detail" notice instead of crashing on the retired run viewer.
  it('opens the dialog with the no-live-detail notice for a running run', async () => {
    const user = userEvent.setup();
    render(
      <TaskAgentRunStatusBadge
        agentName="PR Creator"
        run={{
          runId: 'run_1' as string,
          agentSlug: 'github/create-pull-requests/pr-creator',
          trigger: 'mention',
          status: 'running',
          startedAt: Date.now(),
          costCents: 0,
          wfExecutionId: 'exec_1' as string,
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
    expect(
      screen.getByText('No live transcript is available for this run.'),
    ).toBeInTheDocument();
  });

  it('shows the stored error when a failed run has no execution id', async () => {
    const user = userEvent.setup();
    render(
      <TaskAgentRunStatusBadge
        agentName="PR Creator"
        run={{
          runId: 'run_2' as string,
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
    // No code stamped: the failure reads as the unknown class.
    expect(screen.getByText('agentRun.failure.unknown')).toBeInTheDocument();
  });

  it('leads a failed run with what its failure means, above what it reported', async () => {
    const user = userEvent.setup();
    render(
      <TaskAgentRunStatusBadge
        agentName="PR Creator"
        run={{
          runId: 'run_3' as string,
          agentSlug: 'agent-1',
          trigger: 'manual',
          status: 'failed',
          error: 'the agent run could not start: no credential',
          failureCode: 'start_failed',
          startedAt: Date.now(),
          costCents: 0,
        }}
      />,
    );

    await user.click(
      screen.getByRole('button', {
        name: 'Open Failed details for PR Creator',
      }),
    );

    const meaning = screen.getByText('agentRun.failure.start');
    const reported = screen.getByText(
      'the agent run could not start: no credential',
    );
    expect(screen.getByText('agentRun.reported')).toBeInTheDocument();
    expect(
      meaning.compareDocumentPosition(reported) &
        Node.DOCUMENT_POSITION_FOLLOWING,
    ).toBeTruthy();
  });
});
