// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { renderHook } from '@/tests/utils/render';

const {
  branchChatThreadForEdit,
  branchChatThreadForRegenerate,
  regenerateChatTurn,
  trashChatThread,
  invalidateChatThreads,
  invalidateBudgetStanding,
} = vi.hoisted(() => ({
  branchChatThreadForEdit: vi.fn(),
  branchChatThreadForRegenerate: vi.fn(),
  regenerateChatTurn: vi.fn(),
  trashChatThread: vi.fn(),
  invalidateChatThreads: vi.fn(),
  invalidateBudgetStanding: vi.fn(),
}));

vi.mock('@/app/lib/backend/chat', () => ({
  branchChatThread: vi.fn(),
  branchChatThreadForEdit,
  branchChatThreadForRegenerate,
  regenerateChatTurn,
  trashChatThread,
  invalidateChatThreads,
  setChatBranchSelection: vi.fn(),
}));
vi.mock('./chat-backend', () => ({
  useChatQueryClient: () => ({}),
  invalidateBudgetStanding,
}));

import { BackendApiError } from '@/app/lib/backend/api-client';

import { useBranchActions } from './branch-actions';

/**
 * A fork is the first half of a turn, and the door measures the budget
 * before forking. The seam must hand that refusal to the surface as a
 * refusal — with the server's code, so the toast is the budget one — not
 * collapse it into the generic "failed" that a network error is.
 */
describe('useBranchActions forks', () => {
  const budgetRefusal = () =>
    new BackendApiError(
      429,
      'Usage limit reached. Your monthly cost limit is used up.',
      'BUDGET_EXCEEDED',
      { scope: 'user', limitCode: 'COST_LIMIT' },
    );

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('surfaces a budget-refused edit fork with its code and nudges the banner', async () => {
    branchChatThreadForEdit.mockRejectedValueOnce(budgetRefusal());
    const { result } = renderHook(() => useBranchActions('org_1'));
    await expect(result.current.branchForEdit('t1', 'm1')).resolves.toEqual({
      status: 'refused',
      reason: 'Usage limit reached. Your monthly cost limit is used up.',
      code: 'BUDGET_EXCEEDED',
    });
    expect(invalidateBudgetStanding).toHaveBeenCalledWith({}, 'org_1');
    expect(invalidateChatThreads).not.toHaveBeenCalled();
  });

  it('surfaces a budget-refused regenerate fork the same way', async () => {
    branchChatThreadForRegenerate.mockRejectedValueOnce(budgetRefusal());
    const { result } = renderHook(() => useBranchActions('org_1'));
    await expect(
      result.current.branchForRegenerate('t1', 'm2'),
    ).resolves.toMatchObject({ status: 'refused', code: 'BUDGET_EXCEEDED' });
    expect(invalidateBudgetStanding).toHaveBeenCalledTimes(1);
  });

  it('resolves created with the sibling and its fork point, and refreshes the thread reads', async () => {
    // The fork point is the server's: forked from `t1` (itself a "try
    // again" sibling), the edit hangs off t1's parent `t0`.
    branchChatThreadForEdit.mockResolvedValueOnce({
      id: 'b1',
      parentId: 't0',
      forkSequence: 2,
    });
    const { result } = renderHook(() => useBranchActions('org_1'));
    await expect(result.current.branchForEdit('t1', 'm1')).resolves.toEqual({
      status: 'created',
      id: 'b1',
      parentId: 't0',
      forkSequence: 2,
    });
    expect(invalidateChatThreads).toHaveBeenCalledWith({}, 'org_1');
    expect(invalidateBudgetStanding).not.toHaveBeenCalled();
  });

  it('collapses any other failure to failed, never a rejection', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => {});
    branchChatThreadForEdit.mockRejectedValueOnce(new Error('offline'));
    const { result } = renderHook(() => useBranchActions('org_1'));
    await expect(result.current.branchForEdit('t1', 'm1')).resolves.toEqual({
      status: 'failed',
    });
    expect(error).toHaveBeenCalled();
    error.mockRestore();
  });
});

describe('useBranchActions regenerate + discard', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('carries the refusal code and whether it is on the record', async () => {
    regenerateChatTurn.mockResolvedValueOnce({
      status: 'refused',
      reason: 'Usage limit reached.',
      code: 'BUDGET_EXCEEDED',
      persisted: false,
    });
    const { result } = renderHook(() => useBranchActions('org_1'));
    await expect(
      result.current.regenerate('b1', { modelSelection: 'auto' }),
    ).resolves.toEqual({
      refused: true,
      reason: 'Usage limit reached.',
      code: 'BUDGET_EXCEEDED',
      persisted: false,
    });
    expect(invalidateBudgetStanding).toHaveBeenCalledTimes(1);
  });

  it('reports a persisted refusal as such, without the budget nudge', async () => {
    regenerateChatTurn.mockResolvedValueOnce({
      status: 'refused',
      reason: 'blocked by the chat filter',
      persisted: true,
    });
    const { result } = renderHook(() => useBranchActions('org_1'));
    await expect(
      result.current.regenerate('b1', { modelId: 'm' }),
    ).resolves.toEqual({
      refused: true,
      reason: 'blocked by the chat filter',
      persisted: true,
    });
    expect(invalidateBudgetStanding).not.toHaveBeenCalled();
  });

  it('discards a sibling through Trash and refreshes the thread reads', async () => {
    trashChatThread.mockResolvedValueOnce(true);
    const { result } = renderHook(() => useBranchActions('org_1'));
    await result.current.discard('b1');
    expect(trashChatThread).toHaveBeenCalledWith('org_1', 'b1');
    expect(invalidateChatThreads).toHaveBeenCalledWith({}, 'org_1');
  });

  it('treats a failed discard as a warning, never a rejection', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => {});
    trashChatThread.mockRejectedValueOnce(new Error('held'));
    const { result } = renderHook(() => useBranchActions('org_1'));
    await expect(result.current.discard('b1')).resolves.toBeUndefined();
    expect(warn).toHaveBeenCalled();
    warn.mockRestore();
  });
});
