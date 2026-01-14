import { useMemo } from 'react';
import type { ChatMessage } from './use-message-processing';
import type { IntegrationApproval } from './use-integration-approvals';
import type { WorkflowCreationApproval } from './use-workflow-creation-approvals';

export type ChatItem =
  | { type: 'message'; data: ChatMessage }
  | { type: 'approval'; data: IntegrationApproval }
  | { type: 'workflow_approval'; data: WorkflowCreationApproval };

interface UseMergedChatItemsParams {
  messages: ChatMessage[];
  integrationApprovals: IntegrationApproval[] | undefined;
  workflowCreationApprovals: WorkflowCreationApproval[] | undefined;
}

/**
 * Hook to merge messages with approvals in chronological order.
 * Positions approvals right after their associated message.
 */
export function useMergedChatItems({
  messages,
  integrationApprovals,
  workflowCreationApprovals,
}: UseMergedChatItemsParams): ChatItem[] {
  return useMemo((): ChatItem[] => {
    const items: ChatItem[] = [];

    // Build maps for filtering and positioning approvals
    const loadedMessageIds = new Set<string>();
    const messageTimeMap = new Map<string, number>();
    for (const message of messages || []) {
      loadedMessageIds.add(message.id);
      const time = message._creationTime || message.timestamp.getTime();
      messageTimeMap.set(message.id, time);
    }

    // Add messages
    for (const message of messages || []) {
      items.push({ type: 'message', data: message });
    }

    // Filter and add integration approvals
    const filteredIntegrationApprovals = (integrationApprovals || []).filter(
      (approval) => {
        if (!approval.messageId) return false;
        return loadedMessageIds.has(approval.messageId);
      },
    );

    for (const approval of filteredIntegrationApprovals) {
      items.push({ type: 'approval', data: approval });
    }

    // Filter and add workflow creation approvals
    const filteredWorkflowApprovals = (workflowCreationApprovals || []).filter(
      (approval) => {
        if (!approval.messageId) return false;
        return loadedMessageIds.has(approval.messageId);
      },
    );

    for (const approval of filteredWorkflowApprovals) {
      items.push({ type: 'workflow_approval', data: approval });
    }

    // Sort items chronologically with approvals after their messages
    items.sort((a, b) => {
      const getItemSortKey = (item: ChatItem): number => {
        if (item.type === 'message') {
          return item.data._creationTime || item.data.timestamp.getTime();
        }
        const approval = item.data;
        const messageTime = messageTimeMap.get(approval.messageId!);
        if (messageTime !== undefined) {
          const offset = item.type === 'workflow_approval' ? 0.11 : 0.1;
          return messageTime + offset;
        }
        return approval._creationTime;
      };

      return getItemSortKey(a) - getItemSortKey(b);
    });

    return items;
  }, [messages, integrationApprovals, workflowCreationApprovals]);
}
