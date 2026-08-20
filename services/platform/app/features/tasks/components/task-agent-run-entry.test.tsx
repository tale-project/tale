import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';

import { TaskAgentRunEntry } from './task-agent-run-entry';

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({
    t: (key: string, values?: Record<string, unknown>) => {
      if (key === 'run.details') return 'Details';
      if (key === 'run.detailsTitle') {
        return `${String(values?.name)} — run details`;
      }
      if (key === 'run.detailsTitleLive') {
        return `${String(values?.name)} — progress`;
      }
      if (key === 'agentRun.status.running') return 'Working';
      if (key === 'agentRun.status.settled') return 'Reported for review';
      if (key === 'agentRun.status.queued') return 'Queued';
      if (key === 'agentRun.waitingForSlot') {
        return 'Waiting for a sandbox slot';
      }
      if (key === 'runs.agentLog.title') return 'Agent log';
      if (key === 'runs.agentLog.visionModel') {
        return `Images in this run were read by ${String(values?.model)}.`;
      }
      if (key === 'runs.agentLog.empty') {
        return 'The agent produced no log for this run.';
      }
      return key;
    },
  }),
}));

vi.mock('@tale/ui/responsive-dialog', () => ({
  ResponsiveDialog: ({
    open,
    children,
  }: {
    open: boolean;
    children: React.ReactNode;
  }) => (open ? <div role="dialog">{children}</div> : null),
  ResponsiveDialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  ResponsiveDialogTitle: ({ children }: { children: React.ReactNode }) => (
    <h2>{children}</h2>
  ),
}));

vi.mock('../hooks/mutations', () => ({
  useStartTaskAgentRun: () => ({ mutateAsync: vi.fn() }),
  useCancelTaskAgentRun: () => ({ mutateAsync: vi.fn() }),
}));

// Routes the card's two reads: the run-card query (args carry `taskId`) and
// the details dialog's op query (args carry `runId`, `'skip'` until opened).
const { state } = vi.hoisted(() => ({
  state: { run: undefined as unknown, op: undefined as unknown },
}));

vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: (_func: unknown, args: unknown) => {
    if (args === 'skip') return { data: undefined };
    if (typeof args === 'object' && args !== null && 'taskId' in args) {
      return { data: state.run };
    }
    return { data: state.op };
  },
}));

const taskId = 'task-1' as Id<'tasks'>;

function settledRun() {
  return {
    _id: 'run-1' as Id<'projectAgentRuns'>,
    status: 'settled',
    agentId: 'agent-1',
    agentName: 'Alice',
    harness: 'claude-code',
    model: 'deepseek/deepseek-v4-flash',
    startedAt: 1,
    settledAt: 2,
  };
}

describe('TaskAgentRunEntry details', () => {
  it('opens the transcript dialog from the Details entry, for readers too', async () => {
    const user = userEvent.setup();
    state.run = settledRun();
    state.op = {
      execId: 'e1',
      status: 'completed',
      startedAt: 1,
      liveTimeline: [
        { type: 'text', text: 'built the deck' },
        {
          type: 'tool-Bash',
          state: 'output-available',
          toolCallId: 't1',
          input: { command: 'ls /agent/output' },
        },
      ],
    };
    render(
      <TaskAgentRunEntry
        organizationId="org-1"
        taskId={taskId}
        canEdit={false}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Details' }));

    expect(screen.getByRole('dialog')).toBeInTheDocument();
    // A run that already stopped is titled in the past tense — "progress" is
    // for a run with progress left to make.
    expect(screen.getByText('Alice — run details')).toBeInTheDocument();
    // The dialog title alone names the transcript — no "Agent log" subhead.
    expect(screen.queryByText('Agent log')).not.toBeInTheDocument();
    expect(screen.getByText('built the deck')).toBeInTheDocument();
    expect(screen.getByText('ls /agent/output')).toBeInTheDocument();
  });

  it('names the model that read the run’s images, once it recorded one', async () => {
    // The question a reader only asks when an image read went wrong — and it
    // has to be answerable from the SETTLED run, since resolving again today
    // can pick a different model than the one that actually ran.
    const user = userEvent.setup();
    state.run = settledRun();
    state.op = {
      execId: 'e1',
      status: 'completed',
      startedAt: 1,
      visionModelRef: 'openrouter/qwen/qwen3-vl-32b-instruct',
      liveTimeline: [{ type: 'text', text: 'read the slides' }],
    };
    render(
      <TaskAgentRunEntry organizationId="org-1" taskId={taskId} canEdit />,
    );

    await user.click(screen.getByRole('button', { name: 'Details' }));

    expect(
      screen.getByText(
        'Images in this run were read by openrouter/qwen/qwen3-vl-32b-instruct.',
      ),
    ).toBeInTheDocument();
  });

  it('stays silent about vision when no polyfill was armed', async () => {
    // A serving model that reads images itself arms nothing — a footnote
    // claiming otherwise would be a lie.
    const user = userEvent.setup();
    state.run = settledRun();
    state.op = {
      execId: 'e1',
      status: 'completed',
      startedAt: 1,
      liveTimeline: [{ type: 'text', text: 'read the slides' }],
    };
    render(
      <TaskAgentRunEntry organizationId="org-1" taskId={taskId} canEdit />,
    );

    await user.click(screen.getByRole('button', { name: 'Details' }));

    expect(screen.queryByText(/were read by/)).not.toBeInTheDocument();
  });

  it('says a capacity-parked run is waiting for a slot, not just queued', async () => {
    // "Queued" reads as "about to start"; a run parked on the org's full
    // sandbox budget can sit a while — the strip says what it waits on.
    state.run = { ...settledRun(), status: 'queued', waitingForCapacity: true };
    state.op = null;
    render(
      <TaskAgentRunEntry organizationId="org-1" taskId={taskId} canEdit />,
    );
    expect(screen.getByText('Waiting for a sandbox slot')).toBeInTheDocument();
    expect(screen.queryByText('Queued')).not.toBeInTheDocument();
  });

  it('titles a live run in the present tense', async () => {
    const user = userEvent.setup();
    state.run = { ...settledRun(), status: 'running', settledAt: undefined };
    state.op = { execId: 'e1', status: 'running', startedAt: 1 };
    render(
      <TaskAgentRunEntry organizationId="org-1" taskId={taskId} canEdit />,
    );

    await user.click(screen.getByRole('button', { name: 'Details' }));

    expect(screen.getByText('Alice — progress')).toBeInTheDocument();
  });

  it('degrades to the empty notice when the run left no op', async () => {
    const user = userEvent.setup();
    state.run = settledRun();
    state.op = null;
    render(
      <TaskAgentRunEntry organizationId="org-1" taskId={taskId} canEdit />,
    );

    await user.click(screen.getByRole('button', { name: 'Details' }));

    expect(
      screen.getByText('The agent produced no log for this run.'),
    ).toBeInTheDocument();
  });
});
