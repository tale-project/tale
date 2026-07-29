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

describe('AgentExecutionLog', () => {
  it('renders the timeline newest first', () => {
    // The list sits at the bottom of a dialog that scrolls as one column —
    // the freshest entry must be the one visible without scrolling.
    state.data = {
      execId: 'e1',
      status: 'running',
      startedAt: 1,
      liveTimeline: [
        { type: 'text', text: 'first thought' },
        {
          type: 'tool-Bash',
          state: 'output-available',
          toolCallId: 't1',
          input: { command: 'ls' },
        },
        { type: 'text', text: 'latest thought' },
      ],
    };
    render(<AgentExecutionLog organizationId="org-1" runId={runId} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('latest thought');
    expect(items.at(-1)).toHaveTextContent('first thought');
    expect(screen.getByText('Latest first')).toBeInTheDocument();
  });

  it('renders nothing for a run without an agent op', () => {
    state.data = null;
    const { container } = render(
      <AgentExecutionLog organizationId="org-1" runId={runId} />,
    );
    expect(container).toBeEmptyDOMElement();
  });
});
