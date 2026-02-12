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
    onUpdate: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) => {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- TanStack DB types metadata as unknown; we control the shape via collection.update() calls
          const meta = m.metadata as
            | { updatedBy: string; metadataOnly?: boolean }
            | undefined;
          const updatedBy = meta?.updatedBy ?? '';
          if (meta?.metadataOnly) {
            return convexClient.mutation(
              api.wf_definitions.mutations.updateWorkflowMetadata,
              {
                wfDefinitionId: toId<'wfDefinitions'>(m.key),
                metadata: m.modified.metadata ?? {},
                updatedBy,
              },
            );
          }
          const {
            name,
            description,
            version,
            status,
            workflowType,
            config,
            metadata,
          } = m.changes;
          return convexClient.mutation(
            api.wf_definitions.mutations.updateWorkflow,
            {
              wfDefinitionId: toId<'wfDefinitions'>(m.key),
              updates: {
                name,
                description,
                version,
                // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex query types status as string; mutation validator uses narrow union; values are always valid workflow statuses
                status: status as 'draft' | 'active' | 'archived' | undefined,
                workflowType,
                config,
                metadata,
              },
              updatedBy,
            },
          );
        }),
      );
    },
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
