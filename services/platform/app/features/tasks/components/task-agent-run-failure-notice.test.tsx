// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { TaskAgentRunFailureNotice } from './task-agent-run-failure-notice';

vi.mock('@tale/ui/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

const { state, start } = vi.hoisted(() => ({
  state: { run: undefined as unknown },
  start: vi.fn(async () => {}),
}));

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => ({ data: state.run }),
}));

vi.mock('../hooks/use-task-agent-run-controls', () => ({
  useTaskAgentRunControls: () => ({ start, cancel: vi.fn(), busy: false }),
}));

function failedRun(overrides: Record<string, unknown> = {}) {
  return {
    _id: 'run-1',
    status: 'failed',
    agentId: 'agent-1',
    agentName: 'Content editor',
    harness: 'claude-code',
    model: 'm',
    error: 'API Error: 402 {"error":"budget exceeded"}',
    failureCode: 'budget_exceeded',
    startedBy: 'member-1',
    startedAt: 1,
    ...overrides,
  };
}

function renderNotice(canRetry = true) {
  return render(
    <TaskAgentRunFailureNotice
      organizationId="org-1"
      taskId="task-1"
      assigneeId="agent-1"
      canRetry={canRetry}
    />,
  );
}

describe('TaskAgentRunFailureNotice', () => {
  beforeEach(() => {
    start.mockClear();
  });

  it('says what a final failure means, not what the harness printed', () => {
    state.run = failedRun();
    renderNotice();

    expect(screen.getByText('agentRun.failureTitle')).toBeInTheDocument();
    expect(screen.getByText('agentRun.failure.budget')).toBeInTheDocument();
    expect(screen.queryByText(/API Error/)).not.toBeInTheDocument();
  });

  it('offers Retry to whoever may start the agent, and starts it', async () => {
    state.run = failedRun({ failureCode: 'turn_crashed' });
    const user = userEvent.setup();
    renderNotice();

    expect(
      screen.getByText('agentRun.failure.interrupted'),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'agentRun.retry' }));
    expect(start).toHaveBeenCalledTimes(1);
  });

  it('offers no Retry to someone who cannot start it', () => {
    state.run = failedRun();
    renderNotice(false);

    expect(screen.getByText('agentRun.failureTitle')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'agentRun.retry' }),
    ).not.toBeInTheDocument();
  });

  it.each([
    ['a live run', { status: 'running' }],
    ['a finished run', { status: 'settled' }],
    ['a failure the platform retries by itself', { retryPending: true }],
    ['a failed run of an agent the task is no longer with', { agentId: 'a2' }],
  ])('stays out of the way for %s', (_label, overrides) => {
    state.run = failedRun(overrides);
    const { container } = renderNotice();

    expect(container).toBeEmptyDOMElement();
  });

  it('stays out of the way while no run exists', () => {
    state.run = null;
    const { container } = renderNotice();

    expect(container).toBeEmptyDOMElement();
  });
});
