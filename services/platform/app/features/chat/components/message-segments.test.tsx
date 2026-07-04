import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { MessageSegment } from '../utils/build-message-segments';

// The regression under guard: a `spawn_agent` tool row whose RESULT hasn't
// landed yet (the call is still executing) must still mount its job card,
// anchored through the live job row's `toolCallId` — the fix for "worker
// details only appear after the job completes". The settled path (jobId read
// off the persisted tool result) must keep working unchanged.

const mockUseThreadAgentJobs = vi.fn();

vi.mock('../hooks/queries', () => ({
  useThreadMessages: () => undefined,
  useThreadAgentJobs: (organizationId: string, threadId: string | null) =>
    mockUseThreadAgentJobs(organizationId, threadId) as unknown,
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

vi.mock('./job-card', () => ({
  InlineJobCard: ({ jobId }: { jobId: string }) => (
    <div data-testid={`job-card-${jobId}`} />
  ),
}));

vi.mock('./thought-timeline', () => ({
  InlineReasoning: () => null,
  RoutingStepRow: () => null,
  STEP_INDENT: '',
  ToolStepRow: () => null,
}));

vi.mock('./assistant-message-content', () => ({
  AssistantMessageContent: () => null,
}));

function spawnSegment(
  overrides: Partial<Extract<MessageSegment, { kind: 'tool' }>> = {},
): MessageSegment {
  return {
    kind: 'tool',
    id: 'call_1',
    toolName: 'spawn_agent',
    state: 'input-available',
    input: { name: 'worker' },
    output: undefined,
    errorText: undefined,
    ...overrides,
  };
}

async function renderSegments(segments: MessageSegment[], active: boolean) {
  const { MessageSegments } = await import('./message-segments');
  return render(
    <MessageSegments
      segments={segments}
      active={active}
      citationNumbers={new Set()}
      messageId="msg-1"
      threadId="thread-1"
      voiceModeEnabled={false}
      isFreshSinceMount
    />,
  );
}

describe('spawn_agent job-card anchoring', () => {
  it('mounts the card DURING execution via the live toolCallId match', async () => {
    mockUseThreadAgentJobs.mockReturnValue([
      { _id: 'job-1', toolCallId: 'call_1' },
    ]);

    await renderSegments([spawnSegment()], true);

    expect(screen.getByTestId('job-card-job-1')).toBeInTheDocument();
    // The live subscription is on: an unresolved spawn row in an active turn.
    expect(mockUseThreadAgentJobs).toHaveBeenCalledWith('org-1', 'thread-1');
  });

  it('prefers the persisted result jobId once the tool result lands', async () => {
    mockUseThreadAgentJobs.mockReturnValue(null);

    await renderSegments(
      [
        spawnSegment({
          state: 'output-available',
          output: { jobId: 'job-1' },
        }),
      ],
      false,
    );

    expect(screen.getByTestId('job-card-job-1')).toBeInTheDocument();
    // Settled row → no live anchor needed → the subscription stays skipped.
    expect(mockUseThreadAgentJobs).toHaveBeenCalledWith('org-1', null);
  });

  it('renders no card while executing when no job row matches yet', async () => {
    mockUseThreadAgentJobs.mockReturnValue([]);

    await renderSegments([spawnSegment()], true);

    expect(screen.queryByTestId(/^job-card-/)).not.toBeInTheDocument();
  });
});
