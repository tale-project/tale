import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

import type { Message } from './message-bubble/types';

vi.mock('../hooks/queries', () => ({
  useMessageMetadata: () => ({ metadata: undefined }),
  useChatAgents: () => ({ agents: undefined }),
  useFileUrls: () => ({ data: undefined }),
  useThreadLiveRoute: () => null,
  useThreadGenerationStart: () => null,
}));

vi.mock('../hooks/use-effective-agent', () => ({
  useEffectiveAgent: () => ({ agent: undefined }),
}));

vi.mock('../hooks/use-on-demand-speech', () => ({
  useOnDemandSpeech: () => ({ requested: false }),
}));

vi.mock('../hooks/use-voice-output', () => ({
  useVoiceModeEffective: () => ({ enabled: false }),
  useVoiceOutputChunker: () => undefined,
}));

vi.mock('../context/chat-layout-context', () => ({
  useChatLayout: () => ({
    setEditingImageRef: vi.fn(),
    setDismissedImageKey: vi.fn(),
  }),
}));

vi.mock('./message-segments', () => ({
  MessageSegments: ({ messageId }: { messageId: string }) => (
    <div data-testid={`segments-${messageId}`} />
  ),
}));

vi.mock('./thought-timeline', () => ({
  MessageThoughtHeader: () => <div data-testid="thought-header" />,
  ThinkingDots: () => <span data-testid="trailing-thinking-dots" />,
}));

vi.mock('./message-bubble/artifact-pills', () => ({
  MessageArtifactPills: () => null,
}));

vi.mock('./message-info-dialog', () => ({
  MessageInfoDialog: () => null,
}));

function streamingAssistant(overrides: Partial<Message> = {}): Message {
  return {
    id: 'assistant-msg-1',
    role: 'assistant',
    content: '',
    timestamp: new Date('2026-01-01T00:00:00Z'),
    threadId: 'thread-1',
    isStreaming: true,
    parts: [
      {
        type: 'text',
        text: 'Looking further for the kickoff time.',
        state: 'streaming',
      },
      {
        type: 'tool-web',
        toolCallId: 'w1',
        state: 'output-available',
        output: 'page 1',
      },
      {
        type: 'tool-web',
        toolCallId: 'w2',
        state: 'output-available',
        output: 'page 2',
      },
      { type: 'text', text: 'Still checking schedules.', state: 'done' },
    ],
    ...overrides,
  };
}

describe('MessageBubble trailing loader', () => {
  it('shows trailing dots between settled web tools when interim text is still streaming', async () => {
    const { MessageBubble } = await import('./message-bubble');

    render(
      <MessageBubble
        message={streamingAssistant()}
        organizationId="org-1"
        hideFeedback
      />,
    );

    expect(screen.getByTestId('trailing-thinking-dots')).toBeInTheDocument();
  });

  it('hides trailing dots while a tool is mid-flight', async () => {
    const { MessageBubble } = await import('./message-bubble');

    render(
      <MessageBubble
        message={streamingAssistant({
          parts: [
            {
              type: 'tool-web',
              toolCallId: 'w1',
              state: 'output-available',
              output: 'page 1',
            },
            {
              type: 'tool-web',
              toolCallId: 'w2',
              state: 'input-available',
              input: { operation: 'fetch_url', url: 'https://example.com' },
            },
          ],
        })}
        organizationId="org-1"
        hideFeedback
      />,
    );

    expect(
      screen.queryByTestId('trailing-thinking-dots'),
    ).not.toBeInTheDocument();
  });
});
