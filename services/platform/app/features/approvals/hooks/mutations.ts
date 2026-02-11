import type { Collection } from '@tanstack/db';

import { useCallback } from 'react';

import type { Approval } from '@/lib/collections/entities/approvals';

import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

// Note: Updates nested metadata - uses preloaded query with complex filters
export function useRemoveRecommendedProduct() {
  return useConvexMutation(api.approvals.mutations.removeRecommendedProduct);
}

export function useUpdateApprovalStatus(
  collection: Collection<Approval, string>,
) {
  return useCallback(
    async (args: {
      approvalId: string;
      status: 'pending' | 'approved' | 'rejected';
      comments?: string;
    }) => {
      const tx = collection.update(args.approvalId, (draft) => {
        draft.status = args.status;
        if (args.comments !== undefined) {
          Object.assign(draft, { comments: args.comments });
        }
      });
      await tx.isPersisted.promise;
    },
    [collection],
  );
}
