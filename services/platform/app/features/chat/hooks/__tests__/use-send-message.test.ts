// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { PendingMessage } from '../../context/chat-layout-context';

const mockCreateThread = vi.fn();
const mockUpdateThread = vi.fn();
const mockChatWithAgent = vi.fn();

const mockArenaChat = vi.fn();

vi.mock('../mutations', () => ({
  useCreateThread: () => ({ mutateAsync: mockCreateThread }),
  useUpdateThread: () => ({ mutateAsync: mockUpdateThread }),
  useUnifiedChatWithAgent: () => ({ mutateAsync: mockChatWithAgent }),
  useArenaChat: () => ({ mutateAsync: mockArenaChat }),
}));

const mockResetGlobalFreeze = vi.fn();
vi.mock('../use-stream-buffer', () => ({
  resetGlobalFreeze: () => mockResetGlobalFreeze(),
}));

const mockToast = vi.fn();
vi.mock('@/app/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

import { useSendMessage } from '../use-send-message';

function createParams(
  overrides?: Partial<Parameters<typeof useSendMessage>[0]>,
) {
  return {
    organizationId: 'org_1',
    threadId: 'thread_1',
    messages: [],
    setIsPending: vi.fn(),
    setPendingThreadId: vi.fn(),
    setPendingMessage: vi.fn<(msg: PendingMessage | null) => void>(),
    clearChatState: vi.fn(),
    selectedAgent: { name: 'test-agent', displayName: 'Test Agent' },
    ...overrides,
  };
}

describe('useSendMessage — thread creation optimization', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockCreateThread.mockResolvedValue('new_thread_id');
    mockChatWithAgent.mockResolvedValue({
      messageAlreadyExists: false,
      streamId: 'stream_1',
    });
  });

  it('does not call updateThread for new conversations (title passed to createThread)', async () => {
    const params = createParams({ threadId: undefined, messages: [] });
    const { result } = renderHook(() => useSendMessage(params));

    await act(async () => {
      await result.current.sendMessage('Hello world');
    });

    // createThread should be called with the title
    expect(mockCreateThread).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Hello world' }),
    );
    // updateThread should NOT be called — title was already set in createThread
    expect(mockUpdateThread).not.toHaveBeenCalled();
  });

  it('does not call updateThread for first message on existing thread', async () => {
    const params = createParams({ threadId: 'existing_thread', messages: [] });
    const { result } = renderHook(() => useSendMessage(params));

    await act(async () => {
      await result.current.sendMessage('Hello world');
    });

    // No thread creation needed
    expect(mockCreateThread).not.toHaveBeenCalled();
    // Title update is skipped — title was already set when thread was created
    expect(mockUpdateThread).not.toHaveBeenCalled();
  });

  it('does not call updateThread for subsequent messages', async () => {
    const existingMessages = [
      { key: 'msg_1', role: 'user', content: 'First message' },
    ];
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test mock
    const params = createParams({
      threadId: 'existing_thread',
      messages: existingMessages as unknown as Parameters<
        typeof useSendMessage
      >[0]['messages'],
    });
    const { result } = renderHook(() => useSendMessage(params));

    await act(async () => {
      await result.current.sendMessage('Second message');
    });

    expect(mockCreateThread).not.toHaveBeenCalled();
    expect(mockUpdateThread).not.toHaveBeenCalled();
  });
});

describe('useSendMessage — error handling', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockChatWithAgent.mockResolvedValue({
      messageAlreadyExists: false,
      streamId: 'stream_1',
    });
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
    expect(params.setIsPending).not.toHaveBeenCalled();
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
