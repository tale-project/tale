import { api } from '@/convex/_generated/api';
import { toId } from '@/lib/utils/type-guards';

import type { CollectionFactory } from '../collection-registry';
import type { ConvexItemOf } from '../convex-collection-options';

import { convexCollectionOptions } from '../convex-collection-options';

type WfAutomation = ConvexItemOf<
  typeof api.wf_definitions.queries.listAutomations
>;

export const createWfAutomationsCollection: CollectionFactory<
  WfAutomation,
  string
> = (scopeId, queryClient, convexQueryFn, convexClient) =>
  convexCollectionOptions({
    id: 'wf-automations',
    queryFn: api.wf_definitions.queries.listAutomations,
    args: { organizationId: scopeId },
    queryClient,
    convexQueryFn,
    getKey: (item) => item._id,
    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) =>
          convexClient.mutation(api.wf_definitions.mutations.deleteWorkflow, {
            wfDefinitionId: toId<'wfDefinitions'>(m.key),
          }),
        ),
      );
    },
  });

export type { WfAutomation };
