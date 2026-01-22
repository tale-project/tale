/**
 * Hook for fetching human input request approvals in a chat thread
 */

import { useQuery, useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';
import type { Id } from '@/convex/_generated/dataModel';
import type { HumanInputRequestMetadata } from '@/lib/shared/schemas/approvals';

export interface HumanInputRequest {
  _id: Id<'approvals'>;
  status: 'pending' | 'approved' | 'rejected';
  metadata: HumanInputRequestMetadata;
  _creationTime: number;
  messageId?: string;
}

/**
 * Hook to fetch human input requests for a chat thread
 */
export function useHumanInputRequests(threadId: string | undefined) {
  // @ts-ignore - Deep api path may cause TS2589 depending on TypeScript state
  const approvals = useQuery(
    api.approvals.queries.getHumanInputRequestsForThread,
    threadId ? { threadId } : 'skip',
  );

  type ApprovalItem = NonNullable<typeof approvals>[number];

  const humanInputRequests: HumanInputRequest[] = (approvals || [])
    .filter((a: ApprovalItem) => a.metadata)
    .map((a: ApprovalItem) => ({
      _id: a._id,
      status: a.status as 'pending' | 'approved' | 'rejected',
      metadata: a.metadata as unknown as HumanInputRequestMetadata,
      _creationTime: a._creationTime,
      messageId: a.messageId,
    }));

  return {
    requests: humanInputRequests,
    isLoading: approvals === undefined && threadId !== undefined,
  };
}

/**
 * Hook to submit a response to a human input request
 */
export function useSubmitHumanInputResponse() {
  const submitMutation = useMutation(
    api.agent_tools.human_input.submit_human_input_response.submitHumanInputResponse,
  );

  return {
    submit: submitMutation,
  };
}
