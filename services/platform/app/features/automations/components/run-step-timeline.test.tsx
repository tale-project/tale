import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { buildGraph } from '../lib/graph';
import { projectRun } from '../lib/run-view';
import { RunStepTimeline } from './run-step-timeline';

// Drives the mocked `useBackendQuery` return: the run's sandbox op, read by
// the agent activity line and the transcript pane inside an unfolded row.
const { state } = vi.hoisted(() => ({
  state: { data: undefined as unknown },
}));

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => ({ data: state.data }),
}));

const runId = 'run-1' as string;

// Three steps wired by references, so topoSort has an order to find:
// mark_started → read_invoices → notify.
const graph = buildGraph({
  name: 'vat-desk',
  nodes: [
    {
      id: 'mark_started',
      type: 'task.update_status',
      input: { status: 'in_progress' },
    },
    {
      id: 'read_invoices',
      type: 'agent',
      prompt: 'Read the files after {{ nodes.mark_started.output }}',
    },
    {
      id: 'notify',
      type: 'email.send',
      when: '{{ nodes.read_invoices.output.ok }}',
      input: { to: 'desk@example.test' },
    },
  ],
});

const finishedRun = {
  status: 'success',
  trace: [
    {
      node: 'mark_started',
      type: 'task.update_status',
      status: 'ok',
      ms: 1200,
      input: { status: 'in_progress' },
      output: { ok: true },
    },
    {
      node: 'read_invoices',
      type: 'agent',
      status: 'ok',
      ms: 754_000,
      output: { summary: 'done' },
    },
    { node: 'notify', type: 'email.send', status: 'skipped' },
  ],
  effects: [
    {
      node: 'mark_started',
      connector: 'task.update_status',
      input: { status: 'in_progress' },
    },
    {
      node: 'mark_started',
      connector: 'task.update_status',
      input: { status: 'review' },
    },
  ],
};

// A run parked on its agent step: one checkpoint written, the cursor beyond
// it, the third step untouched.
const liveRun = {
  status: 'running',
  checkpoints: {
    cursor: { node: 'read_invoices' },
    nodes: {
      mark_started: {
        trace: {
          node: 'mark_started',
          type: 'task.update_status',
          status: 'ok',
        },
        effects: [],
      },
    },
  },
};

function renderTimeline(run: unknown, currentNodeId: string | null) {
  return render(
    <RunStepTimeline
      graph={graph}
      projection={projectRun(run as Parameters<typeof projectRun>[0])}
      currentNodeId={currentNodeId}
      organizationId="org-1"
      runId={runId}
    />,
  );
}

describe('RunStepTimeline', () => {
  it('lists every step in execution order, compact by default', () => {
    state.data = undefined;
    renderTimeline(finishedRun, null);

    const rows = screen.getAllByRole('listitem');
    expect(rows).toHaveLength(3);
    expect(rows[0]).toHaveTextContent('mark started');
    expect(rows[1]).toHaveTextContent('read invoices');
    expect(rows[2]).toHaveTextContent('notify');
    // Compact means the step detail stays behind the click.
    expect(screen.queryByText('Called with')).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /mark started/ }),
    ).toHaveAttribute('aria-expanded', 'false');
  });

  it('counts a step s outward actions on the collapsed row', () => {
    state.data = undefined;
    renderTimeline(finishedRun, null);

    expect(
      screen.getByRole('button', { name: /mark started/ }),
    ).toHaveTextContent('2 actions');
  });

  it('unfolds a step into its recorded detail', async () => {
    state.data = undefined;
    const { user } = renderTimeline(finishedRun, null);

    const row = screen.getByRole('button', { name: /mark started/ });
    await user.click(row);
    expect(row).toHaveAttribute('aria-expanded', 'true');
    // The unfolded reading is RunStepDetail: resolved input and the step's
    // own effects, exactly as the editor's inspector shows them.
    expect(screen.getByText('Resolved input')).toBeInTheDocument();
    expect(screen.getAllByText('task.update_status').length).toBeGreaterThan(1);
  });

  it('shows a failed step s error without a click', () => {
    state.data = undefined;
    renderTimeline(
      {
        status: 'failed',
        trace: [
          {
            node: 'mark_started',
            type: 'task.update_status',
            status: 'error',
            error: 'connector timed out',
          },
        ],
        effects: [],
      },
      null,
    );

    expect(screen.getByText('connector timed out')).toBeInTheDocument();
  });

  it('lists only the path taken — the road ahead stays off the list', () => {
    state.data = undefined;
    renderTimeline(liveRun, 'read_invoices');

    // Two steps reached, one ahead: the unreached step does not render at
    // all — a rails-heavy document must not drown the read in steps that
    // will mostly never run.
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
    expect(screen.queryByText('notify')).not.toBeInTheDocument();
  });

  it('hides the steps a finished run never reached', () => {
    state.data = undefined;
    renderTimeline(
      {
        status: 'failed',
        trace: [
          {
            node: 'mark_started',
            type: 'task.update_status',
            status: 'error',
            error: 'connector timed out',
          },
          { node: 'read_invoices', type: 'agent', status: 'not_run' },
          { node: 'notify', type: 'email.send', status: 'not_run' },
        ],
        effects: [],
      },
      null,
    );

    expect(screen.getAllByRole('listitem')).toHaveLength(1);
    expect(screen.queryByText('read invoices')).not.toBeInTheDocument();
  });

  it('says so while a queued run has not reached any step', () => {
    state.data = undefined;
    renderTimeline({ status: 'queued' }, null);

    expect(
      screen.getByText('The run has not reached any step yet.'),
    ).toBeInTheDocument();
    expect(screen.queryByRole('listitem')).not.toBeInTheDocument();
  });

  it('synthesises the step in flight so its transcript is reachable', async () => {
    state.data = {
      execId: 'e1',
      status: 'running',
      startedAt: 1,
      liveTimeline: [
        {
          type: 'tool-Bash',
          state: 'input-available',
          toolCallId: 't1',
          input: { command: 'pip install pymupdf' },
        },
      ],
    };
    const { user } = renderTimeline(liveRun, 'read_invoices');

    // Collapsed: the agent's latest move ticks on the row itself.
    expect(screen.getByText(/Bash · pip install pymupdf/)).toBeInTheDocument();

    // Unfolded: the running step opens on the live transcript even though no
    // checkpoint has been written for it yet.
    await user.click(screen.getByRole('button', { name: /read invoices/ }));
    expect(screen.getByText('Agent log')).toBeInTheDocument();
    expect(screen.getByText('Current step')).toBeInTheDocument();
  });
});
