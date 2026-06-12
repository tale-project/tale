import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/test/utils/render';

import { useSessionProgress } from '../hooks/queries';
import { ExternalAgentLiveTimeline } from './external-agent-live-timeline';

vi.mock('../hooks/queries', () => ({
  useSessionProgress: vi.fn(),
}));

vi.mock('./thought-timeline', () => ({
  MessageThoughtHeader: () => <div data-testid="thought-header" />,
  InlineReasoning: () => <div data-testid="reasoning-row" />,
  ToolStepRow: () => <div data-testid="tool-row" />,
  ThinkingIndicator: () => <div data-testid="thinking" />,
}));

const mockedUseSessionProgress = vi.mocked(useSessionProgress);

const runningProgress = {
  status: 'running' as const,
  startedAt: 1718000000000,
  recentEvents: [
    JSON.stringify({
      type: 'tool-use',
      toolName: 'Bash',
      toolUseId: 't1',
      input: { command: 'ls' },
    }),
  ],
};

describe('ExternalAgentLiveTimeline', () => {
  it('renders the live tool timeline while the session op is running', () => {
    mockedUseSessionProgress.mockReturnValue(runningProgress);

    render(<ExternalAgentLiveTimeline threadId="thread-1" phase="thinking" />);

    expect(screen.getByTestId('thought-header')).toBeInTheDocument();
    expect(screen.getByTestId('tool-row')).toBeInTheDocument();
    expect(screen.queryByTestId('thinking')).not.toBeInTheDocument();
  });

  it('renders only the placeholder when placeholderOnly is set (mid-turn steer)', () => {
    mockedUseSessionProgress.mockReturnValue(runningProgress);

    render(
      <ExternalAgentLiveTimeline
        threadId="thread-1"
        phase="thinking"
        placeholderOnly
      />,
    );

    expect(screen.getByTestId('thinking')).toBeInTheDocument();
    expect(screen.queryByTestId('thought-header')).not.toBeInTheDocument();
    expect(screen.queryByTestId('tool-row')).not.toBeInTheDocument();
    // The session-op subscription is skipped entirely, not just unrendered.
    expect(mockedUseSessionProgress).toHaveBeenCalledWith(undefined);
  });

  it('falls back to the placeholder when there is no running op', () => {
    mockedUseSessionProgress.mockReturnValue(null);

    render(<ExternalAgentLiveTimeline threadId="thread-1" phase="thinking" />);

    expect(screen.getByTestId('thinking')).toBeInTheDocument();
    expect(screen.queryByTestId('thought-header')).not.toBeInTheDocument();
  });
});
