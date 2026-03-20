import { renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import type { ChatItem } from '../use-merged-chat-items';
import type { ChatMessage } from '../use-message-processing';

import { useMergedChatItems } from '../use-merged-chat-items';

function makeMessage(
  id: string,
  creationTime: number,
  role: 'user' | 'assistant' = 'user',
): ChatMessage {
  return {
    id,
    key: id,
    content: `Message ${id}`,
    role,
    timestamp: new Date(creationTime),
    _creationTime: creationTime,
  };
}

function makeApproval(
  id: string,
  status: 'pending' | 'executing' | 'completed' | 'rejected',
  messageId: string,
  creationTime: number,
) {
  return {
    _id: id,
    status,
    metadata: {} as never,
    _creationTime: creationTime,
    messageId,
  };
}

function getApprovalId(item: ChatItem | null): string | undefined {
  if (!item || item.type === 'message') return undefined;
  return item.data._id;
}

function getMessageId(item: ChatItem): string | undefined {
  if (item.type !== 'message') return undefined;
  return item.data.id;
}

const emptyParams = {
  messages: [],
  integrationApprovals: undefined,
  workflowCreationApprovals: undefined,
  workflowUpdateApprovals: undefined,
  workflowRunApprovals: undefined,
  humanInputRequests: undefined,
  documentWriteApprovals: undefined,
};

describe('useMergedChatItems', () => {
  it('returns empty results when no messages or approvals', () => {
    const { result } = renderHook(() => useMergedChatItems(emptyParams));
    expect(result.current.messages).toEqual([]);
    expect(result.current.activeApproval).toBeNull();
  });

  it('returns messages only when no approvals exist', () => {
    const msgs = [makeMessage('m1', 1000), makeMessage('m2', 2000)];
    const { result } = renderHook(() =>
      useMergedChatItems({ ...emptyParams, messages: msgs }),
    );
    expect(result.current.messages).toHaveLength(2);
    expect(result.current.messages[0].type).toBe('message');
    expect(result.current.activeApproval).toBeNull();
  });

  it('extracts a single pending approval as activeApproval', () => {
    const msgs = [makeMessage('m1', 1000)];
    const approvals = [makeApproval('a1', 'pending', 'm1', 1500)];
    const { result } = renderHook(() =>
      useMergedChatItems({
        ...emptyParams,
        messages: msgs,
        integrationApprovals: approvals as never,
      }),
    );
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.activeApproval).not.toBeNull();
    expect(result.current.activeApproval?.type).toBe('approval');
    expect(getApprovalId(result.current.activeApproval)).toBe('a1');
  });

  it('extracts executing approval as activeApproval', () => {
    const msgs = [makeMessage('m1', 1000)];
    const approvals = [makeApproval('a1', 'executing', 'm1', 1500)];
    const { result } = renderHook(() =>
      useMergedChatItems({
        ...emptyParams,
        messages: msgs,
        workflowUpdateApprovals: approvals as never,
      }),
    );
    expect(result.current.activeApproval).not.toBeNull();
    expect(result.current.activeApproval?.type).toBe(
      'workflow_update_approval',
    );
  });

  it('hides completed approvals entirely', () => {
    const msgs = [makeMessage('m1', 1000)];
    const approvals = [makeApproval('a1', 'completed', 'm1', 1500)];
    const { result } = renderHook(() =>
      useMergedChatItems({
        ...emptyParams,
        messages: msgs,
        integrationApprovals: approvals as never,
      }),
    );
    expect(result.current.messages).toHaveLength(1);
    expect(result.current.activeApproval).toBeNull();
  });

  it('hides rejected approvals entirely', () => {
    const msgs = [makeMessage('m1', 1000)];
    const approvals = [makeApproval('a1', 'rejected', 'm1', 1500)];
    const { result } = renderHook(() =>
      useMergedChatItems({
        ...emptyParams,
        messages: msgs,
        integrationApprovals: approvals as never,
      }),
    );
    expect(result.current.activeApproval).toBeNull();
  });

  it('picks the latest pending approval when multiple exist', () => {
    const msgs = [makeMessage('m1', 1000), makeMessage('m2', 2000)];
    const integrationApprovals = [makeApproval('a1', 'pending', 'm1', 1500)];
    const workflowApprovals = [makeApproval('a2', 'pending', 'm2', 2500)];
    const { result } = renderHook(() =>
      useMergedChatItems({
        ...emptyParams,
        messages: msgs,
        integrationApprovals: integrationApprovals as never,
        workflowCreationApprovals: workflowApprovals as never,
      }),
    );
    expect(result.current.activeApproval).not.toBeNull();
    expect(getApprovalId(result.current.activeApproval)).toBe('a2');
  });

  it('ignores approvals with no matching messageId', () => {
    const msgs = [makeMessage('m1', 1000)];
    const approvals = [makeApproval('a1', 'pending', 'nonexistent', 1500)];
    const { result } = renderHook(() =>
      useMergedChatItems({
        ...emptyParams,
        messages: msgs,
        integrationApprovals: approvals as never,
      }),
    );
    expect(result.current.activeApproval).toBeNull();
  });

  it('filters completed and picks active from mixed statuses', () => {
    const msgs = [makeMessage('m1', 1000)];
    const approvals = [
      makeApproval('a1', 'completed', 'm1', 1500),
      makeApproval('a2', 'pending', 'm1', 2000),
      makeApproval('a3', 'rejected', 'm1', 2500),
    ];
    const { result } = renderHook(() =>
      useMergedChatItems({
        ...emptyParams,
        messages: msgs,
        integrationApprovals: approvals as never,
      }),
    );
    expect(result.current.activeApproval).not.toBeNull();
    expect(getApprovalId(result.current.activeApproval)).toBe('a2');
  });

  it('sorts messages chronologically', () => {
    const msgs = [makeMessage('m2', 2000), makeMessage('m1', 1000)];
    const { result } = renderHook(() =>
      useMergedChatItems({ ...emptyParams, messages: msgs }),
    );
    expect(getMessageId(result.current.messages[0])).toBe('m1');
    expect(getMessageId(result.current.messages[1])).toBe('m2');
  });
});
