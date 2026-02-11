import { api } from '@/convex/_generated/api';
import { toId } from '@/lib/utils/type-guards';

import type { CollectionFactory } from '../collection-registry';
import type { ConvexItemOf } from '../convex-collection-options';

import { convexCollectionOptions } from '../convex-collection-options';

type Approval = ConvexItemOf<
  typeof api.approvals.queries.listApprovalsByOrganization
>;

export const createApprovalsCollection: CollectionFactory<Approval, string> = (
  scopeId,
  queryClient,
  convexQueryFn,
  convexClient,
) =>
  convexCollectionOptions({
    id: 'approvals',
    queryFn: api.approvals.queries.listApprovalsByOrganization,
    args: { organizationId: scopeId },
    queryClient,
    convexQueryFn,
    getKey: (item) => item._id,
    onUpdate: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) =>
          convexClient.mutation(api.approvals.mutations.updateApprovalStatus, {
            approvalId: toId<'approvals'>(m.key),
            status: m.modified.status,
            comments: m.modified.comments,
          }),
        ),
      );
    },
  });

export type { Approval };
