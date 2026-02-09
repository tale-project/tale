/**
 * Hook for fetching human input request approvals in a chat thread
 */

import { useQuery } from 'convex/react';

import type { Id } from '@/convex/_generated/dataModel';

import { api } from '@/convex/_generated/api';
import {
  type HumanInputRequestMetadata,
  humanInputRequestMetadataSchema,
} from '@/lib/shared/schemas/approvals';

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
      _id: a._id,
      status: a.status,
      metadata: humanInputRequestMetadataSchema.parse(a.metadata),
      _creationTime: a._creationTime,
      messageId: a.messageId,
    }));

  return {
    requests: humanInputRequests,
    isLoading: approvals === undefined && threadId !== undefined,
  };
}
