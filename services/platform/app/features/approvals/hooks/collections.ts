import type { Collection } from '@tanstack/db';

import { useLiveQuery } from '@tanstack/react-db';

import type { Approval } from '@/lib/collections/entities/approvals';

import { createApprovalsCollection } from '@/lib/collections/entities/approvals';
import { useCollection } from '@/lib/collections/use-collection';

export function useApprovalCollection(organizationId: string) {
  return useCollection('approvals', createApprovalsCollection, organizationId);
}

export function useApprovals(collection: Collection<Approval, string>) {
  const { data, isLoading } = useLiveQuery((q) =>
    q.from({ approval: collection }).select(({ approval }) => approval),
  );

  return {
    approvals: data,
    isLoading,
  };
}
