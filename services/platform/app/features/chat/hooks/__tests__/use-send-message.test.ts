// @vitest-environment jsdom
import { renderHook, act } from '@testing-library/react';
import { describe, it, expect, vi, beforeEach } from 'vitest';

import type { PendingMessage } from '../../context/chat-layout-context';

const mockCreateThread = vi.fn();
const mockUpdateThread = vi.fn();
const mockChatWithAgent = vi.fn();

vi.mock('../mutations', () => ({
  useCreateThread: () => ({ mutateAsync: mockCreateThread }),
  useUpdateThread: () => ({ mutateAsync: mockUpdateThread }),
  useUnifiedChatWithAgent: () => ({ mutateAsync: mockChatWithAgent }),
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
