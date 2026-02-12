import { useMemo } from 'react';

import type {
  HumanInputRequest,
  IntegrationApproval,
  WorkflowCreationApproval,
} from './queries';
import type { ChatMessage } from './use-message-processing';

export type ChatItem =
  | { type: 'message'; data: ChatMessage }
  | { type: 'approval'; data: IntegrationApproval }
  | { type: 'workflow_approval'; data: WorkflowCreationApproval }
  | { type: 'human_input_request'; data: HumanInputRequest };

interface UseMergedChatItemsParams {
  messages: ChatMessage[];
  integrationApprovals: IntegrationApproval[] | undefined;
  workflowCreationApprovals: WorkflowCreationApproval[] | undefined;
  humanInputRequests: HumanInputRequest[] | undefined;
}

/**
 * Hook to merge messages with approvals in chronological order.
 * Positions approvals right after their associated message.
 */
export function useMergedChatItems({
  messages,
  integrationApprovals,
  workflowCreationApprovals,
  humanInputRequests,
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

    // Filter and add human input requests
    const filteredHumanInputRequests = (humanInputRequests || []).filter(
      (request) => {
        if (!request.messageId) return false;
        return loadedMessageIds.has(request.messageId);
      },
    );

    for (const request of filteredHumanInputRequests) {
      items.push({ type: 'human_input_request', data: request });
    }

    // Sort items chronologically with approvals after their messages
    items.sort((a, b) => {
      const getItemSortKey = (item: ChatItem): number => {
        if (item.type === 'message') {
          return item.data._creationTime || item.data.timestamp.getTime();
        }
        const approval = item.data;
        const messageTime = approval.messageId
          ? messageTimeMap.get(approval.messageId)
          : undefined;
        if (messageTime !== undefined) {
          // Use different offsets to maintain consistent ordering
          let offset = 0.1;
          if (item.type === 'workflow_approval') offset = 0.11;
          if (item.type === 'human_input_request') offset = 0.12;
          return messageTime + offset;
        }
        return approval._creationTime;
      };

      return getItemSortKey(a) - getItemSortKey(b);
    });

    return items;
  }, [
    messages,
    integrationApprovals,
    workflowCreationApprovals,
    humanInputRequests,
  ]);
}
