import { renderHook } from '@testing-library/react';
import { describe, it, expect } from 'vitest';

import type { ChatItem } from './use-merged-chat-items';
import { useMergedChatItems } from './use-merged-chat-items';
import type { ChatMessage } from './use-message-processing';

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
  locationRequests: undefined,
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

  describe('identity hold', () => {
    it('reuses the result array reference when nothing changed across a re-render', () => {
      const m1 = makeMessage('m1', 1000, 'user');
      const m2 = makeMessage('m2', 2000, 'assistant');
      const { result, rerender } = renderHook(
        (props: Parameters<typeof useMergedChatItems>[0]) =>
          useMergedChatItems(props),
        { initialProps: { ...emptyParams, messages: [m1, m2] } },
      );
      const first = result.current.messages;
      // A new array carrying the SAME element identities — what the upstream
      // per-message identity hold yields for unchanged messages each token.
      rerender({ ...emptyParams, messages: [m1, m2] });
      expect(result.current.messages).toBe(first);
    });

    it('yields a new array but reuses unchanged item wrappers when the tail changes', () => {
      const m1 = makeMessage('m1', 1000, 'user');
      const m2 = makeMessage('m2', 2000, 'assistant');
      const { result, rerender } = renderHook(
        (props: Parameters<typeof useMergedChatItems>[0]) =>
          useMergedChatItems(props),
        { initialProps: { ...emptyParams, messages: [m1, m2] } },
      );
      const firstItems = result.current.messages;
      const firstHead = firstItems[0];
      // Tail advanced (streaming): a new object identity for the tail only.
      const m2b: ChatMessage = { ...m2, content: 'Message m2 more' };
      rerender({ ...emptyParams, messages: [m1, m2b] });
      // New array identity (so ChatMessages re-renders the changed tail)...
      expect(result.current.messages).not.toBe(firstItems);
      // ...but the unchanged head wrapper is reused so its bubble memo bails.
      expect(result.current.messages[0]).toBe(firstHead);
    });

    it('yields a new array identity when the message count changes (edit-swap release)', () => {
      const m1 = makeMessage('m1', 1000, 'user');
      const m2 = makeMessage('m2', 2000, 'assistant');
      const { result, rerender } = renderHook(
        (props: Parameters<typeof useMergedChatItems>[0]) =>
          useMergedChatItems(props),
        { initialProps: { ...emptyParams, messages: [m1, m2] } },
      );
      const first = result.current.messages;
      rerender({ ...emptyParams, messages: [m1] });
      expect(result.current.messages).not.toBe(first);
      expect(result.current.messages).toHaveLength(1);
    });
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

describe('useMergedChatItems — inline resolved human-input requests', () => {
  function makePill(id: string, creationTime: number): ChatMessage {
    return {
      id,
      key: id,
      content: '[HUMAN_INPUT_RESPONSE] My answer',
      role: 'system',
      timestamp: new Date(creationTime),
      _creationTime: creationTime,
      systemMessageDisplay: 'pill',
      systemMessageBody: 'My answer',
    };
  }

  const baseMessages = [
    makeMessage('m1', 1000),
    makeMessage('m2', 2000, 'assistant'),
    makeMessage('m3', 3000),
  ];

  it('splices a completed request immediately after its source message', () => {
    const { result } = renderHook(() =>
      useMergedChatItems({
        ...emptyParams,
        messages: baseMessages,
        resolvedHumanInputRequests: [
          makeApproval('h1', 'completed', 'm2', 2500) as never,
        ],
      }),
    );
    const kinds = result.current.messages.map((i) =>
      i.type === 'message' ? i.data.id : `card:${i.data._id}`,
    );
    expect(kinds).toEqual(['m1', 'm2', 'card:h1', 'm3']);
    expect(result.current.activeApproval).toBeNull();
  });

  it('includes rejected requests inline', () => {
    const { result } = renderHook(() =>
      useMergedChatItems({
        ...emptyParams,
        messages: baseMessages,
        resolvedHumanInputRequests: [
          makeApproval('h1', 'rejected', 'm2', 2500) as never,
        ],
      }),
    );
    expect(
      result.current.messages.some(
        (i) => i.type === 'human_input_request' && i.data._id === 'h1',
      ),
    ).toBe(true);
  });

  it('orders multiple requests under one message by creation time', () => {
    const { result } = renderHook(() =>
      useMergedChatItems({
        ...emptyParams,
        messages: baseMessages,
        resolvedHumanInputRequests: [
          makeApproval('h2', 'completed', 'm2', 2600) as never,
          makeApproval('h1', 'completed', 'm2', 2500) as never,
        ],
      }),
    );
    const kinds = result.current.messages.map((i) =>
      i.type === 'message' ? i.data.id : `card:${i.data._id}`,
    );
    expect(kinds).toEqual(['m1', 'm2', 'card:h1', 'card:h2', 'm3']);
  });

  it('drops requests whose source message is not loaded (pagination)', () => {
    const { result } = renderHook(() =>
      useMergedChatItems({
        ...emptyParams,
        messages: baseMessages,
        resolvedHumanInputRequests: [
          makeApproval('h1', 'completed', 'older-msg', 500) as never,
        ],
      }),
    );
    expect(result.current.messages.every((i) => i.type === 'message')).toBe(
      true,
    );
  });

  it('never renders two cards for one request during the status-flip race', () => {
    // The same approval id appears in BOTH subscriptions for a moment when
    // pending flips to completed — the ACTIVE row wins and renders exactly
    // one inline card (active human input is inlined too, so the card keeps
    // one stable DOM slot through pending → executing → completed).
    const { result } = renderHook(() =>
      useMergedChatItems({
        ...emptyParams,
        messages: baseMessages,
        humanInputRequests: [
          makeApproval('h1', 'executing', 'm2', 2500) as never,
        ],
        resolvedHumanInputRequests: [
          makeApproval('h1', 'completed', 'm2', 2500) as never,
        ],
      }),
    );
    const inlineCards = result.current.messages.filter(
      (i) => i.type === 'human_input_request',
    );
    expect(inlineCards).toHaveLength(1);
    expect(
      inlineCards[0].type === 'human_input_request' &&
        inlineCards[0].data.status,
    ).toBe('executing');
    expect(getApprovalId(result.current.activeApproval)).toBe('h1');
    expect(result.current.activeApprovalInline).toBe(true);
  });

  it('renders the active (pending) request inline and flags the footer skip', () => {
    const { result } = renderHook(() =>
      useMergedChatItems({
        ...emptyParams,
        messages: baseMessages,
        humanInputRequests: [
          makeApproval('h1', 'pending', 'm2', 2500) as never,
        ],
      }),
    );
    const kinds = result.current.messages.map((i) =>
      i.type === 'message' ? i.data.id : `card:${i.data._id}`,
    );
    expect(kinds).toEqual(['m1', 'm2', 'card:h1', 'm3']);
    expect(result.current.activeApprovalInline).toBe(true);
  });

  it('does NOT flag inline when the active approval is not human input', () => {
    const { result } = renderHook(() =>
      useMergedChatItems({
        ...emptyParams,
        messages: baseMessages,
        integrationApprovals: [
          makeApproval('a1', 'pending', 'm2', 2500) as never,
        ],
      }),
    );
    expect(result.current.activeApprovalInline).toBe(false);
    expect(getApprovalId(result.current.activeApproval)).toBe('a1');
  });

  it('suppresses [HUMAN_INPUT_RESPONSE] pills when a card is inserted', () => {
    const { result } = renderHook(() =>
      useMergedChatItems({
        ...emptyParams,
        messages: [...baseMessages, makePill('p1', 2600)],
        resolvedHumanInputRequests: [
          makeApproval('h1', 'completed', 'm2', 2500) as never,
        ],
      }),
    );
    expect(
      result.current.messages.some(
        (i) => i.type === 'message' && i.data.id === 'p1',
      ),
    ).toBe(false);
    expect(
      result.current.messages.some(
        (i) => i.type === 'human_input_request' && i.data._id === 'h1',
      ),
    ).toBe(true);
  });

  it('keeps the pill as a fallback when no card was inserted', () => {
    const { result } = renderHook(() =>
      useMergedChatItems({
        ...emptyParams,
        messages: [...baseMessages, makePill('p1', 2600)],
        resolvedHumanInputRequests: [],
      }),
    );
    expect(
      result.current.messages.some(
        (i) => i.type === 'message' && i.data.id === 'p1',
      ),
    ).toBe(true);
  });
});

describe('useMergedChatItems — inline plan approvals', () => {
  function makePlanApproval(
    id: string,
    status: 'pending' | 'executing' | 'completed' | 'rejected',
    messageId: string,
    creationTime: number,
  ) {
    return {
      _id: id as never,
      status,
      metadata: {
        plan: '# Plan',
        planSource: 'exit_plan_mode' as const,
        agentSlug: 'claude-code',
        modelRef: 'm',
        requestedAt: creationTime,
      },
      _creationTime: creationTime,
      messageId,
    };
  }

  const baseMessages = [
    makeMessage('u1', 1000, 'user'),
    makeMessage('a1', 2000, 'assistant'),
    makeMessage('u2', 3000, 'user'),
  ];

  it('splices the plan card immediately after its source assistant message', () => {
    const { result } = renderHook(() =>
      useMergedChatItems({
        ...emptyParams,
        messages: baseMessages,
        planApprovals: [makePlanApproval('plan1', 'pending', 'a1', 2500)],
      }),
    );
    const keys = result.current.messages.map(
      (i) => getMessageId(i) ?? `${i.type}:${getApprovalId(i)}`,
    );
    expect(keys).toEqual(['u1', 'a1', 'plan_approval:plan1', 'u2']);
  });

  it('NEVER populates activeApproval (the composer must stay usable)', () => {
    const { result } = renderHook(() =>
      useMergedChatItems({
        ...emptyParams,
        messages: baseMessages,
        planApprovals: [makePlanApproval('plan1', 'pending', 'a1', 2500)],
      }),
    );
    expect(result.current.activeApproval).toBeNull();
  });

  it('drops plan cards whose source message is not loaded (pagination)', () => {
    const { result } = renderHook(() =>
      useMergedChatItems({
        ...emptyParams,
        messages: baseMessages,
        planApprovals: [
          makePlanApproval('plan1', 'pending', 'not-loaded', 2500),
        ],
      }),
    );
    expect(
      result.current.messages.some((i) => i.type === 'plan_approval'),
    ).toBe(false);
  });

  it('orders multiple plan cards under one message by creation time', () => {
    const { result } = renderHook(() =>
      useMergedChatItems({
        ...emptyParams,
        messages: baseMessages,
        planApprovals: [
          makePlanApproval('plan2', 'pending', 'a1', 2600),
          makePlanApproval('plan1', 'rejected', 'a1', 2500),
        ],
      }),
    );
    const planIds = result.current.messages
      .filter((i) => i.type === 'plan_approval')
      .map((i) => getApprovalId(i));
    expect(planIds).toEqual(['plan1', 'plan2']);
  });
});
