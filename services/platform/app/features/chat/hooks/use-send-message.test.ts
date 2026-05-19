// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { PendingMessage } from '../context/chat-layout-context';

const mockCreateThread = vi.fn();
const mockUpdateThread = vi.fn();
const mockChatWithAgent = vi.fn();

const mockArenaChat = vi.fn();

vi.mock('./mutations', () => ({
  useCreateThread: () => ({ mutateAsync: mockCreateThread }),
  useUpdateThread: () => ({ mutateAsync: mockUpdateThread }),
  useUnifiedChatWithAgent: () => ({ mutateAsync: mockChatWithAgent }),
  useArenaChat: () => ({ mutateAsync: mockArenaChat }),
}));

const mockResetGlobalFreeze = vi.fn();
vi.mock('./use-stream-buffer', () => ({
  resetGlobalFreeze: () => mockResetGlobalFreeze(),
}));

const mockToast = vi.fn();
vi.mock('@/app/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

const mockConvexAction = vi.fn();
const mockConvexMutation = vi.fn();
vi.mock('@/app/hooks/use-convex-client', () => ({
  useConvexClient: () => ({
    action: mockConvexAction,
    mutation: mockConvexMutation,
  }),
}));

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

import { useSendMessage } from './use-send-message';

function createParams(
  overrides?: Partial<Parameters<typeof useSendMessage>[0]>,
) {
  return {
    organizationId: 'org_1',
    threadId: 'thread_1',
    messages: [],
    setPendingThreadId: vi.fn(),
    setPendingMessage: vi.fn<(msg: PendingMessage | null) => void>(),
    clearChatState: vi.fn(),
    selectedAgent: { name: 'test-agent', displayName: 'Test Agent' },
    ...overrides,
  };
}

describe('useSendMessage — error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChatWithAgent.mockResolvedValue({
      messageAlreadyExists: false,
      streamId: 'stream_1',
    });
    mockConvexAction.mockResolvedValue({ blocked: false });
    // Default: no-op bind / unbind. Tests that exercise the snapshot
    // path override `mockConvexMutation` per-case.
    mockConvexMutation.mockResolvedValue([]);
  });

  it('calls clearChatState and resetGlobalFreeze on error', async () => {
    mockChatWithAgent.mockRejectedValue(new Error('Credit limit exceeded'));

    const params = createParams();
    const { result } = renderHook(() => useSendMessage(params));

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    expect(params.clearChatState).toHaveBeenCalledOnce();
    expect(mockResetGlobalFreeze).toHaveBeenCalledOnce();
  });

  it('shows toast on error', async () => {
    mockChatWithAgent.mockRejectedValue(new Error('Credit limit exceeded'));

    const params = createParams();
    const { result } = renderHook(() => useSendMessage(params));

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' }),
    );
  });

  it('does not call clearChatState or resetGlobalFreeze on success', async () => {
    const params = createParams();
    const { result } = renderHook(() => useSendMessage(params));

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    expect(params.clearChatState).not.toHaveBeenCalled();
    expect(mockResetGlobalFreeze).not.toHaveBeenCalled();
  });

  it('resets state even when thread creation fails', async () => {
    mockCreateThread.mockRejectedValue(new Error('Network error'));

    const params = createParams({ threadId: undefined });
    const { result } = renderHook(() => useSendMessage(params));

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    expect(params.clearChatState).toHaveBeenCalledOnce();
    expect(mockResetGlobalFreeze).toHaveBeenCalledOnce();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' }),
    );
  });

  it('does not send when no agent is selected', async () => {
    const params = createParams({ selectedAgent: null });
    const { result } = renderHook(() => useSendMessage(params));

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    expect(mockChatWithAgent).not.toHaveBeenCalled();
    expect(params.setPendingMessage).not.toHaveBeenCalled();
  });

  it('shows toast every time precheck blocks (does not wedge sendingRef)', async () => {
    mockConvexAction.mockResolvedValue({
      blocked: true,
      code: 'pii.blocked',
      categoryIds: ['ssn'],
      categoryLabels: ['SSN'],
    });

    const params = createParams();
    const { result } = renderHook(() => useSendMessage(params));

    await act(async () => {
      await result.current.sendMessage('My SSN is 123-45-6789');
    });
    await act(async () => {
      await result.current.sendMessage('My SSN is 987-65-4321');
    });

    expect(mockToast).toHaveBeenCalledTimes(2);
    expect(mockChatWithAgent).not.toHaveBeenCalled();
  });

  it('renders optimistic body with attachment markdown synchronously from video-link snapshot', async () => {
    // Drop the bind call onto a never-resolving promise so the
    // `setPendingMessage` assertion below proves the bubble lands
    // BEFORE the bg bind round-trip — the whole point of this fix.
    mockConvexMutation.mockReturnValue(new Promise(() => {}));

    const params = createParams();
    const { result } = renderHook(() => useSendMessage(params));

    const snapshot = [
      {
        jobId: 'kg_job_a' as never,
        sourceUrl: 'https://youtu.be/abc',
        sourcePlatform: 'YouTube',
        pastedToken: 'https://youtu.be/abc',
        videoTitle: 'A Walk Through the Forest',
        videoUploader: 'ExampleChannel',
        videoDurationSec: 305,
        displayStatus: 'completed',
        storageId: 'kg2_storage_a' as never,
        fileSize: 238923776,
        uploadedBy: 'user_1',
        createdAt: 0,
      },
    ];

    await act(async () => {
      void result.current.sendMessage(
        'summarize this https://youtu.be/abc please',
        undefined,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test fixture; the hook only reads the projected fields named above.
        snapshot as unknown as Parameters<typeof result.current.sendMessage>[2],
      );
    });

    expect(params.setPendingMessage).toHaveBeenCalled();
    const lastCall = vi.mocked(params.setPendingMessage).mock.calls.at(-1);
    const pending = lastCall?.[0];
    expect(pending).toBeTruthy();
    // URL stripped from the typed text — was `https://youtu.be/abc` in the
    // pastedToken on the snapshot.
    expect(pending?.content).not.toContain('https://youtu.be/abc');
    // Markdown footer present — `(fileId: kg2_storage_a)` is the only
    // place storageId appears in the body. Tied to the exact formatter
    // output asserted in lib/shared/video-link-markdown.test.ts.
    expect(pending?.content).toContain('fileId: kg2_storage_a');
    expect(pending?.content).toContain('🎬 [A Walk Through the Forest]');
    // Attachment array populated from the snapshot's storage id.
    expect(pending?.attachments).toHaveLength(1);
    expect(pending?.attachments?.[0]?.fileId).toBe('kg2_storage_a');
  });

  it('calls unmarkJobsSent on bind failure so the chip reappears', async () => {
    mockConvexMutation.mockRejectedValue(new Error('bind exploded'));
    const unmarkJobsSent = vi.fn();

    const params = createParams({ unmarkJobsSent });
    const { result } = renderHook(() => useSendMessage(params));

    const snapshot = [
      {
        jobId: 'kg_job_b' as never,
        sourceUrl: 'https://youtu.be/xyz',
        sourcePlatform: 'YouTube',
        pastedToken: 'https://youtu.be/xyz',
        videoTitle: 'X',
        displayStatus: 'completed',
        storageId: 'kg2_storage_b' as never,
        fileSize: 1024,
        uploadedBy: 'user_1',
        createdAt: 0,
      },
    ];

    await act(async () => {
      await result.current.sendMessage(
        'summarize',
        undefined,
        // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- see fixture note above.
        snapshot as unknown as Parameters<typeof result.current.sendMessage>[2],
      );
    });

    expect(unmarkJobsSent).toHaveBeenCalledWith(['kg_job_b']);
  });

  it('allows sending a new message after a previous error', async () => {
    mockChatWithAgent
      .mockRejectedValueOnce(new Error('Credit error'))
      .mockResolvedValueOnce({
        messageAlreadyExists: false,
        streamId: 'stream_2',
      });

    const params = createParams();
    const { result } = renderHook(() => useSendMessage(params));

    await act(async () => {
      await result.current.sendMessage('First message');
    });

    expect(params.clearChatState).toHaveBeenCalledOnce();

    vi.mocked(params.clearChatState).mockClear();
    mockResetGlobalFreeze.mockClear();

    await act(async () => {
      await result.current.sendMessage('Second message');
    });

    expect(mockChatWithAgent).toHaveBeenCalledTimes(2);
    expect(params.clearChatState).not.toHaveBeenCalled();
  });
});
