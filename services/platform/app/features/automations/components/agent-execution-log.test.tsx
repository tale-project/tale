import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import { AgentActivityLine, AgentExecutionLog } from './agent-execution-log';

// Drives the mocked `useBackendQuery` return: the run's sandbox op, or `null`
// for a run that never ran an agent node.
const { state } = vi.hoisted(() => ({
  state: {
    data: undefined as unknown,
    isError: false,
    isFetching: false,
    errorUpdateCount: 0,
    refetch: vi.fn(),
  },
}));

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => ({
    data: state.data,
    isError: state.isError,
    isFetching: state.isFetching,
    errorUpdateCount: state.errorUpdateCount,
    refetch: state.refetch,
  }),
}));

const runId = 'run-1' as string;

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

  it('names the serving the turn ran on as a footnote', () => {
    state.data = {
      ...op([{ type: 'text', text: 'working' }]),
      modelRef: 'anthropic/claude-fable-5',
    };
    render(<AgentExecutionLog organizationId="org-1" runId={runId} />);
    expect(
      screen.getByText(/ran on anthropic\/claude-fable-5/),
    ).toBeInTheDocument();
  });

  it('collapses the doubled provider segment of a gateway-lane ref', () => {
    state.data = {
      ...op([{ type: 'text', text: 'working' }]),
      modelRef: 'openrouter/openrouter/anthropic/claude-fable-5',
    };
    render(<AgentExecutionLog organizationId="org-1" runId={runId} />);
    expect(
      screen.getByText(/ran on openrouter\/anthropic\/claude-fable-5/),
    ).toBeInTheDocument();
  });

  // A step waiting for sandbox room re-kicks its start for up to two hours:
  // the newest op is a kicked start that has not run, or the refused one.
  it.each([
    ['a kicked start', op([])],
    ['a refused start', op([], 'failed')],
  ])(
    'says a step waits for sandbox room over %s, not that the agent starts up or wrote nothing',
    (_label, data) => {
      state.data = data;
      render(
        <AgentExecutionLog
          organizationId="org-1"
          runId={runId}
          waitingForRoom
        />,
      );
      expect(
        screen.getByText('Waiting for a sandbox slot'),
      ).toBeInTheDocument();
      expect(
        screen.queryByText('The agent is starting up in the sandbox…'),
      ).not.toBeInTheDocument();
      expect(
        screen.queryByText('The agent produced no log for this run.'),
      ).not.toBeInTheDocument();
    },
  );

  it('says the collapsed step waits for sandbox room, whatever the refused start left', () => {
    state.data = op([], 'failed');
    render(
      <AgentActivityLine organizationId="org-1" runId={runId} waitingForRoom />,
    );
    expect(screen.getByText('Waiting for a sandbox slot')).toBeInTheDocument();
  });

  it('renders nothing for a run without an agent op', () => {
    state.data = null;
    const { container } = render(
      <AgentExecutionLog organizationId="org-1" runId={runId} />,
    );
    expect(container).toBeEmptyDOMElement();
  });

  it('keeps the transcript section visible and retries when the op read fails', async () => {
    state.data = undefined;
    state.isError = true;
    state.errorUpdateCount = 1;
    const { user } = render(
      <AgentExecutionLog organizationId="org-1" runId={runId} />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not load the agent log.',
    );
    const retry = screen.getByRole('button', { name: 'Try again' });
    await user.click(retry);
    expect(state.refetch).toHaveBeenCalledOnce();
    expect(retry).toHaveFocus();
  });

  it('keeps the section and focused retry mounted while a retry resets the query', async () => {
    state.data = undefined;
    state.isError = true;
    state.errorUpdateCount = 1;
    state.refetch.mockImplementation(() => {
      state.isError = false;
      state.isFetching = true;
    });
    const { user, rerender } = render(
      <AgentExecutionLog organizationId="org-1" runId={runId} />,
    );

    const retry = screen.getByRole('button', { name: 'Try again' });
    await user.click(retry);
    rerender(<AgentExecutionLog organizationId="org-1" runId={runId} />);

    expect(
      screen.getByRole('heading', { name: 'Agent log' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('alert')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Try again' })).toHaveFocus();
    expect(retry).toHaveAttribute('aria-disabled', 'true');
    expect(retry).toHaveAttribute('aria-busy', 'true');
    expect(retry).not.toBeDisabled();
  });

  it('keeps cached transcript content visible when a refresh fails', () => {
    state.data = op([{ type: 'text', text: 'cached thought' }]);
    state.isError = true;
    state.errorUpdateCount = 1;
    const { container } = render(
      <AgentExecutionLog organizationId="org-1" runId={runId} />,
    );

    expect(container).toHaveTextContent('cached thought');
    expect(screen.getByRole('alert')).toHaveTextContent(
      'Could not load the agent log.',
    );
  });
});
