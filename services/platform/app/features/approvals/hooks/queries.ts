import type { Collection } from '@tanstack/db';

import { useLiveQuery } from '@tanstack/react-db';

import type { Approval } from '@/lib/collections/entities/approvals';

export function useApprovals(collection: Collection<Approval, string>) {
  const { data, isLoading } = useLiveQuery(() => collection);

  return {
    approvals: data,
    isLoading,
  };
}
