import { describe, expect, it, vi } from 'vitest';

import type { Id } from '@/convex/_generated/dataModel';
import { render, screen } from '@/tests/utils/render';

import { AgentExecutionLog } from './agent-execution-log';

// Drives the mocked `useConvexQuery` return: the run's sandbox op, or `null`
// for a run that never ran an agent node.
const { state } = vi.hoisted(() => ({
  state: { data: undefined as unknown },
}));

vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => ({ data: state.data }),
}));

const runId = 'run-1' as Id<'automationRuns'>;

function op(timeline: unknown[], status = 'running') {
  return {
    execId: 'e1',
    status,
    startedAt: 1,
    liveTimeline: timeline,
  };
}

describe('AgentExecutionLog', () => {
  it('renders the transcript in the order it happened', () => {
    state.data = op([
      { type: 'text', text: 'first thought' },
      {
        type: 'tool-Bash',
        state: 'output-available',
        toolCallId: 't1',
        input: { command: 'ls' },
      },
      { type: 'text', text: 'latest thought' },
    ]);
    render(<AgentExecutionLog organizationId="org-1" runId={runId} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('first thought');
    expect(items[1]).toHaveTextContent('Bash');
    expect(items[2]).toHaveTextContent('latest thought');
  });

  it('keeps rows the server has already trimmed away', () => {
    // The op keeps a bounded tail that a fresh drain window rebuilds from
    // scratch — a shorter flush must never eat rows the reader already saw.
    state.data = op([
      { type: 'text', text: 'first thought' },
      {
        type: 'tool-Bash',
        state: 'input-available',
        toolCallId: 't1',
        input: { command: 'ls' },
      },
    ]);
    const { rerender } = render(
      <AgentExecutionLog organizationId="org-1" runId={runId} />,
    );
    expect(screen.getAllByRole('listitem')).toHaveLength(2);

    // The next window flushes only the (now finished) tool call.
    state.data = op([
      {
        type: 'tool-Bash',
        state: 'output-available',
        toolCallId: 't1',
        input: { command: 'ls' },
        output: 'file.txt',
      },
    ]);
    rerender(<AgentExecutionLog organizationId="org-1" runId={runId} />);
    const items = screen.getAllByRole('listitem');
    expect(items).toHaveLength(2);
    expect(items[0]).toHaveTextContent('first thought');
  });

  it('starts a fresh transcript when a new exec takes over the run', () => {
    state.data = op([{ type: 'text', text: 'old turn' }]);
    const { rerender } = render(
      <AgentExecutionLog organizationId="org-1" runId={runId} />,
    );
    expect(screen.getByText('old turn')).toBeInTheDocument();

    state.data = {
      ...op([{ type: 'text', text: 'new turn' }]),
      execId: 'e2',
    };
    rerender(<AgentExecutionLog organizationId="org-1" runId={runId} />);
    expect(screen.queryByText('old turn')).not.toBeInTheDocument();
    expect(screen.getByText('new turn')).toBeInTheDocument();
  });

  it('renders nothing for a run without an agent op', () => {
    state.data = null;
    const { container } = render(
      <AgentExecutionLog organizationId="org-1" runId={runId} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
