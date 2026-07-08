// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { useEmbeddedChat } from './use-embedded-chat';

// Every mocked hook returns a STABLE module-level reference — a fresh object
// per render from a mocked query hook re-render-loops the pipeline (see the
// project memory on UI test perf).
const { chatSpy, setPendingMessageSpy, toastSpy } = vi.hoisted(() => ({
  chatSpy: vi.fn(async () => ({ messageAlreadyExists: false, streamId: 's' })),
  setPendingMessageSpy: vi.fn(),
  toastSpy: vi.fn(),
}));

const chatLayout = { setPendingMessage: setPendingMessageSpy };
vi.mock('@/app/features/chat/context/chat-layout-context', () => ({
  useChatLayout: () => chatLayout,
}));

const unifiedChat = { mutateAsync: chatSpy };
vi.mock('@/app/features/chat/hooks/mutations', () => ({
  useUnifiedChatWithAgent: () => unifiedChat,
}));

const resolvedRequests = { requests: [] };
vi.mock('@/app/features/chat/hooks/queries', () => ({
  useResolvedHumanInputRequests: () => resolvedRequests,
}));

const fileUpload = {
  attachments: [],
  uploadingFiles: [],
  uploadFiles: vi.fn(),
  removeAttachment: vi.fn(),
  clearAttachments: vi.fn(() => []),
};
vi.mock('@/app/features/chat/hooks/use-convex-file-upload', () => ({
  useConvexFileUpload: () => fileUpload,
}));

const indexing = { isIndexing: false, statusMap: new Map() };
vi.mock('@/app/features/chat/hooks/use-file-indexing-status', () => ({
  useFileIndexingStatus: () => indexing,
}));

const transcription = {
  isTranscribing: false,
  isQueryLoading: false,
  statusMap: new Map(),
};
vi.mock('@/app/features/chat/hooks/use-file-transcription-status', () => ({
  useFileTranscriptionStatus: () => transcription,
}));

const processing = {
  messages: [],
  loadMore: vi.fn(),
  canLoadMore: false,
  isLoadingMore: false,
};
vi.mock('@/app/features/chat/hooks/use-message-processing', () => ({
  useMessageProcessing: () => processing,
}));

vi.mock('@/app/features/chat/hooks/use-pending-messages', () => ({
  usePendingMessages: ({ realMessages }: { realMessages: unknown[] }) =>
    realMessages,
}));

const approvals = {
  integrationApprovals: [],
  workflowCreationApprovals: [],
  workflowUpdateApprovals: [],
  workflowRunApprovals: [],
  humanInputRequests: [],
  locationRequests: [],
  documentWriteApprovals: [],
};
vi.mock('@/app/features/chat/hooks/use-thread-approvals', () => ({
  useThreadApprovals: () => approvals,
}));

const merged = {
  messages: [],
  activeApproval: null,
  activeApprovalInline: null,
};
vi.mock('@/app/features/chat/hooks/use-merged-chat-items', () => ({
  useMergedChatItems: () => merged,
}));

// isThreadGenerating — switchable between two STABLE snapshots so tests can
// walk the real pending→generating→idle handoff that unblocks the next send.
const GENERATING_FALSE = { data: false };
const GENERATING_TRUE = { data: true };
let generating: { data: boolean } = GENERATING_FALSE;
vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => generating,
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: toastSpy,
}));

vi.mock('@/convex/_generated/api', () => ({
  api: { threads: { queries: { isThreadGenerating: 'q' } } },
}));

interface HookOptions {
  organizationId: string;
  agentSlug: string;
  threadId?: string | null;
  resolveThread: () => Promise<string>;
  additionalContext?: Record<string, string>;
  errorMessageText: string;
  analyzeAttachmentsText: string;
}

function baseOptions(overrides: Partial<HookOptions> = {}): HookOptions {
  return {
    organizationId: 'org-1',
    agentSlug: 'issue-desk-implementer',
    resolveThread: vi.fn(async () => 'thread-1'),
    errorMessageText: 'send failed',
    analyzeAttachmentsText: 'analyze attachments',
    ...overrides,
  };
}

function renderChat(options: HookOptions) {
  return renderHook((opts: HookOptions) => useEmbeddedChat(opts), {
    initialProps: options,
  });
}

/** Walk the server handoff (pending → generating → idle) so the panel's
 *  isLoading gate releases and the NEXT send is allowed. */
async function settleGeneration(
  rerender: (opts: HookOptions) => void,
  opts: HookOptions,
) {
  generating = GENERATING_TRUE;
  await act(async () => rerender(opts));
  generating = GENERATING_FALSE;
  await act(async () => rerender(opts));
}

describe('useEmbeddedChat', () => {
  it('acquires the thread lazily on the first send, exactly once', async () => {
    generating = GENERATING_FALSE;
    const resolveThread = vi.fn(async () => 'thread-1');
    const additionalContext = { subject_type: 'task', subject_id: 't1' };
    const opts = baseOptions({ resolveThread, additionalContext });
    const { result, rerender } = renderChat(opts);

    await act(async () => {
      await result.current.handleSendMessage('hello there');
    });

    expect(resolveThread).toHaveBeenCalledTimes(1);
    expect(chatSpy).toHaveBeenLastCalledWith({
      agentSlug: 'issue-desk-implementer',
      threadId: 'thread-1',
      organizationId: 'org-1',
      message: 'hello there',
      attachments: undefined,
      additionalContext,
    });
    expect(result.current.threadId).toBe('thread-1');

    // Second send after the turn settles: the acquired thread is reused —
    // resolveThread stays at one call (idempotent acquisition per mount).
    await settleGeneration(rerender, opts);
    await act(async () => {
      await result.current.handleSendMessage('a different question');
    });
    expect(resolveThread).toHaveBeenCalledTimes(1);
    expect(chatSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ threadId: 'thread-1' }),
    );
  });

  it('never acquires when the host already resolved a thread', async () => {
    generating = GENERATING_FALSE;
    const resolveThread = vi.fn(async () => 'should-not-happen');
    const opts = baseOptions({ resolveThread, threadId: 'existing-thread' });
    const { result } = renderChat(opts);

    await act(async () => {
      await result.current.handleSendMessage('history question');
    });

    expect(resolveThread).not.toHaveBeenCalled();
    expect(chatSpy).toHaveBeenLastCalledWith(
      expect.objectContaining({ threadId: 'existing-thread' }),
    );
  });

  it('drops a duplicate send inside the guard window', async () => {
    generating = GENERATING_FALSE;
    const opts = baseOptions({ threadId: 'dup-thread' });
    const { result, rerender } = renderChat(opts);
    const callsBefore = chatSpy.mock.calls.length;

    await act(async () => {
      await result.current.handleSendMessage('same words');
    });
    await settleGeneration(rerender, opts);
    await act(async () => {
      await result.current.handleSendMessage('same words');
    });

    expect(chatSpy.mock.calls.length).toBe(callsBefore + 1);
  });

  it('rolls back the optimistic bubble and toasts when the send fails', async () => {
    generating = GENERATING_FALSE;
    chatSpy.mockRejectedValueOnce(new Error('boom'));
    const opts = baseOptions({ threadId: 'err-thread' });
    const { result } = renderChat(opts);

    await act(async () => {
      await result.current.handleSendMessage('will fail');
    });

    expect(setPendingMessageSpy).toHaveBeenLastCalledWith(null);
    expect(toastSpy).toHaveBeenCalledWith({
      title: 'send failed',
      variant: 'destructive',
    });
    expect(result.current.isSendPending).toBe(false);
  });
});
