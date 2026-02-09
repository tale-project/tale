/**
 * Hook for fetching human input request approvals in a chat thread
 */

import { useQuery, useMutation } from 'convex/react';

import type { Id } from '@/convex/_generated/dataModel';
import type { HumanInputRequestMetadata } from '@/lib/shared/schemas/approvals';

import { api } from '@/convex/_generated/api';

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
  const approvals = useQuery(
    api.approvals.queries.getHumanInputRequestsForThread,
    threadId ? { threadId } : 'skip',
  );

  type ApprovalItem = NonNullable<typeof approvals>[number];

  const humanInputRequests: HumanInputRequest[] = (approvals || [])
    .filter((a: ApprovalItem) => a.metadata)
    .map((a: ApprovalItem) => ({
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex query returns string but downstream expects Id<'approvals'>
      _id: a._id as Id<'approvals'>,
      status: a.status,
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- narrowing from generic JSON record to specific schema type
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
    api.agent_tools.human_input.mutations.submitHumanInputResponse,
  );

  return {
    submit: submitMutation,
  };
}
