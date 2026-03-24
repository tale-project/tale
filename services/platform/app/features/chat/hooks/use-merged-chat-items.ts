import { useMemo } from 'react';

import type {
  DocumentWriteApproval,
  HumanInputRequest,
  IntegrationApproval,
  LocationRequest,
  WorkflowCreationApproval,
  WorkflowRunApproval,
  WorkflowUpdateApproval,
} from './queries';
import type { ChatMessage } from './use-message-processing';

export type ChatItem =
  | { type: 'message'; data: ChatMessage }
  | { type: 'approval'; data: IntegrationApproval }
  | { type: 'workflow_approval'; data: WorkflowCreationApproval }
  | { type: 'workflow_update_approval'; data: WorkflowUpdateApproval }
  | { type: 'workflow_run_approval'; data: WorkflowRunApproval }
  | { type: 'human_input_request'; data: HumanInputRequest }
  | { type: 'document_write_approval'; data: DocumentWriteApproval }
  | { type: 'location_request'; data: LocationRequest };

type ApprovalChatItem = Exclude<ChatItem, { type: 'message' }>;

interface UseMergedChatItemsParams {
  messages: ChatMessage[];
  integrationApprovals: IntegrationApproval[] | undefined;
  workflowCreationApprovals: WorkflowCreationApproval[] | undefined;
  workflowUpdateApprovals: WorkflowUpdateApproval[] | undefined;
  workflowRunApprovals: WorkflowRunApproval[] | undefined;
  humanInputRequests: HumanInputRequest[] | undefined;
  locationRequests: LocationRequest[] | undefined;
  documentWriteApprovals: DocumentWriteApproval[] | undefined;
}

export interface MergedChatItemsResult {
  messages: ChatItem[];
  activeApproval: ChatItem | null;
}

function isActiveStatus(status: string) {
  return status === 'pending' || status === 'executing';
}

/**
 * Hook to merge messages with approvals.
 * Messages are returned chronologically.
 * Only the latest active (pending/executing) approval is returned separately — completed/rejected are hidden.
 */
export function useMergedChatItems({
  messages,
  integrationApprovals,
  workflowCreationApprovals,
  workflowUpdateApprovals,
  workflowRunApprovals,
  humanInputRequests,
  locationRequests,
  documentWriteApprovals,
}: UseMergedChatItemsParams): MergedChatItemsResult {
  return useMemo((): MergedChatItemsResult => {
    // Build message items
    const loadedMessageIds = new Set<string>();
    for (const message of messages || []) {
      loadedMessageIds.add(message.id);
    }

    const messageItems: ChatItem[] = (messages || []).map((message) => ({
      type: 'message' as const,
      data: message,
    }));

    // Sort messages chronologically
    messageItems.sort((a, b) => {
      if (a.type !== 'message' || b.type !== 'message') return 0;
      const aTime = a.data._creationTime ?? a.data.timestamp.getTime();
      const bTime = b.data._creationTime ?? b.data.timestamp.getTime();
      return aTime - bTime;
    });

    // Collect active approvals (pending/executing only, linked to loaded messages)
    const activeApprovals: ApprovalChatItem[] = [];

    for (const a of integrationApprovals ?? []) {
      if (
        a.messageId &&
        loadedMessageIds.has(a.messageId) &&
        isActiveStatus(a.status)
      ) {
        activeApprovals.push({ type: 'approval', data: a });
      }
    }
    for (const a of workflowCreationApprovals ?? []) {
      if (
        a.messageId &&
        loadedMessageIds.has(a.messageId) &&
        isActiveStatus(a.status)
      ) {
        activeApprovals.push({ type: 'workflow_approval', data: a });
      }
    }
    for (const a of workflowUpdateApprovals ?? []) {
      if (
        a.messageId &&
        loadedMessageIds.has(a.messageId) &&
        isActiveStatus(a.status)
      ) {
        activeApprovals.push({ type: 'workflow_update_approval', data: a });
      }
    }
    for (const a of workflowRunApprovals ?? []) {
      if (
        a.messageId &&
        loadedMessageIds.has(a.messageId) &&
        isActiveStatus(a.status)
      ) {
        activeApprovals.push({ type: 'workflow_run_approval', data: a });
      }
    }
    for (const a of humanInputRequests ?? []) {
      if (
        a.messageId &&
        loadedMessageIds.has(a.messageId) &&
        isActiveStatus(a.status)
      ) {
        activeApprovals.push({ type: 'human_input_request', data: a });
      }
    }
    for (const a of locationRequests ?? []) {
      if (
        a.messageId &&
        loadedMessageIds.has(a.messageId) &&
        isActiveStatus(a.status)
      ) {
        activeApprovals.push({ type: 'location_request', data: a });
      }
    }
    for (const a of documentWriteApprovals ?? []) {
      if (
        a.messageId &&
        loadedMessageIds.has(a.messageId) &&
        isActiveStatus(a.status)
      ) {
        activeApprovals.push({ type: 'document_write_approval', data: a });
      }
    }

    // Pick the latest active approval by creation time
    let activeApproval: ChatItem | null = null;
    if (activeApprovals.length > 0) {
      activeApprovals.sort(
        (a, b) => b.data._creationTime - a.data._creationTime,
      );
      activeApproval = activeApprovals[0];
    }

    return { messages: messageItems, activeApproval };
  }, [
    messages,
    integrationApprovals,
    workflowCreationApprovals,
    workflowUpdateApprovals,
    workflowRunApprovals,
    humanInputRequests,
    locationRequests,
    documentWriteApprovals,
  ]);
}
