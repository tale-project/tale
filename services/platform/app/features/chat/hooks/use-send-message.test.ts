// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import { ConvexError } from 'convex/values';
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
    // The hook fire-and-forgets the title update with `.catch(...)` — the
    // mock must return a promise or the success path throws on `.catch`.
    mockUpdateThread.mockResolvedValue(undefined);
    mockCreateThread.mockResolvedValue('thread_new');
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

  it('names the file + reason on a KB_REF_INVALID rejection for an unindexed mention (#2598)', async () => {
    mockChatWithAgent.mockRejectedValue(
      new ConvexError({
        code: 'KB_REF_INVALID',
        reason: 'not_indexed',
        fileName: 'Meetings.pdf',
      }),
    );

    const params = createParams();
    const { result } = renderHook(() => useSendMessage(params));

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'toast.kbRefNotIndexed' }),
    );
  });

  it('distinguishes the never-indexable "unsupported" reason from the ordinary not-yet-indexed case', async () => {
    mockChatWithAgent.mockRejectedValue(
      new ConvexError({
        code: 'KB_REF_INVALID',
        reason: 'unsupported',
        fileName: 'Daily standup.loop',
      }),
    );

    const params = createParams();
    const { result } = renderHook(() => useSendMessage(params));

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'toast.kbRefUnsupported' }),
    );
  });

  it('falls back to the opaque KB_REF_INVALID toast when no reason/fileName is present (access-denied cases stay opaque)', async () => {
    mockChatWithAgent.mockRejectedValue(
      new ConvexError({ code: 'KB_REF_INVALID' }),
    );

    const params = createParams();
    const { result } = renderHook(() => useSendMessage(params));

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ description: 'toast.kbRefInvalid' }),
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

  it('sends in Auto mode (no agent selected) with the auto sentinel slug', async () => {
    // A null selection is "Auto" mode: the composer sends AUTO_AGENT_SLUG and
    // the server routes to a concrete agent. It must NOT be blocked.
    const params = createParams({ selectedAgent: null });
    const { result } = renderHook(() => useSendMessage(params));

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    expect(mockChatWithAgent).toHaveBeenCalledTimes(1);
    expect(mockChatWithAgent).toHaveBeenCalledWith(
      expect.objectContaining({ agentSlug: 'auto', message: 'Hello' }),
    );
    expect(mockToast).not.toHaveBeenCalled();
  });

  it('blocks arena mode when no agent is selected (Auto is unsupported there)', async () => {
    // Arena compares two models on ONE chosen agent, so it can't run in Auto.
    // With no selection it must fail fast — toast, no send, no pending state.
    const params = createParams({
      selectedAgent: null,
      arena: {
        isArenaMode: true,
        modelA: 'model-a',
        modelB: 'model-b',
        arenaThreadIdA: null,
        arenaThreadIdB: null,
        setArenaThreadIdA: vi.fn(),
        setArenaThreadIdB: vi.fn(),
      },
    });
    const { result } = renderHook(() => useSendMessage(params));

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    expect(mockArenaChat).not.toHaveBeenCalled();
    expect(mockChatWithAgent).not.toHaveBeenCalled();
    expect(params.setPendingMessage).not.toHaveBeenCalled();
    expect(mockToast).toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'destructive' }),
    );
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

  it('renders optimistic body with the typed text only; video-link metadata routed through attachments[]', async () => {
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
    // No verbose `🎬 [...] (...) — transcript indexed; call
    // document_retrieve(...)` markdown in the optimistic body. The bubble
    // renders user content as `whitespace-pre-wrap`, so this raw text
    // would be SHOWN. Server-side `buildMessageWithAttachments` still
    // builds the markdown for the agent prompt; the persisted view is
    // stripped before display via `stripInternalFileReferences`.
    expect(pending?.content).not.toContain('🎬');
    expect(pending?.content).not.toContain('fileId: kg2_storage_a');
    expect(pending?.content).toBe('summarize this please');
    // Attachment array populated from the snapshot's storage id — this
    // is what `file-displays` renders as the video card.
    expect(pending?.attachments).toHaveLength(1);
    expect(pending?.attachments?.[0]?.fileId).toBe('kg2_storage_a');
    expect(pending?.attachments?.[0]?.fileName).toBe(
      'A Walk Through the Forest',
    );
    expect(pending?.attachments?.[0]?.fileType).toBe('video/mp4');
    expect(pending?.attachments?.[0]?.fileSize).toBe(238923776);
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

describe('useSendMessage — staged pre-thread sandbox workdir', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChatWithAgent.mockResolvedValue({
      messageAlreadyExists: false,
      streamId: 'stream_1',
    });
    mockUpdateThread.mockResolvedValue(undefined);
    mockCreateThread.mockResolvedValue('thread_new');
    mockConvexAction.mockResolvedValue({ blocked: false });
    mockConvexMutation.mockResolvedValue(null);
  });

  it('applies the staged workdir to the created thread BEFORE dispatching the turn', async () => {
    const clear = vi.fn();
    const params = createParams({
      threadId: undefined,
      pendingSandboxWorkdir: 'tale',
      clearPendingSandboxWorkdir: clear,
    });
    const { result } = renderHook(() => useSendMessage(params));

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    expect(mockConvexMutation).toHaveBeenCalledWith(expect.anything(), {
      threadId: 'thread_new',
      workdir: 'tale',
    });
    expect(clear).toHaveBeenCalledOnce();
    // The turn reads the workdir at sandbox session start — the apply must
    // land first.
    const applyOrder = mockConvexMutation.mock.invocationCallOrder[0];
    const sendOrder = mockChatWithAgent.mock.invocationCallOrder[0];
    expect(applyOrder).toBeLessThan(sendOrder);
  });

  it('does not touch the workdir on an existing-thread send', async () => {
    const clear = vi.fn();
    const params = createParams({
      pendingSandboxWorkdir: 'tale',
      clearPendingSandboxWorkdir: clear,
    });
    const { result } = renderHook(() => useSendMessage(params));

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    expect(mockConvexMutation).not.toHaveBeenCalled();
    expect(clear).not.toHaveBeenCalled();
  });

  it('a failed workdir apply never fails the send (falls back to root)', async () => {
    mockConvexMutation.mockRejectedValue(new Error('metadata race'));
    const clear = vi.fn();
    const params = createParams({
      threadId: undefined,
      pendingSandboxWorkdir: 'tale',
      clearPendingSandboxWorkdir: clear,
    });
    const { result } = renderHook(() => useSendMessage(params));

    await act(async () => {
      await result.current.sendMessage('Hello');
    });

    expect(mockChatWithAgent).toHaveBeenCalledOnce();
    expect(params.clearChatState).not.toHaveBeenCalled();
    expect(clear).toHaveBeenCalledOnce();
  });
});
