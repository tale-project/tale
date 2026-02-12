import { api } from '@/convex/_generated/api';
import { toId } from '@/lib/utils/type-guards';

import type { CollectionFactory } from '../collection-registry';
import type { ConvexItemOf } from '../convex-collection-options';

import { convexCollectionOptions } from '../convex-collection-options';

type WfStep = ConvexItemOf<typeof api.wf_step_defs.queries.getWorkflowSteps>;

export const createWfStepsCollection: CollectionFactory<WfStep, string> = (
  scopeId,
  queryClient,
  convexQueryFn,
  convexClient,
) =>
  convexCollectionOptions({
    id: 'wf-steps',
    queryFn: api.wf_step_defs.queries.getWorkflowSteps,
    args: { wfDefinitionId: toId<'wfDefinitions'>(scopeId) },
    queryClient,
    convexQueryFn,
    getKey: (item) => item._id,
    onUpdate: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) => {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- TanStack DB types metadata as unknown; we control the shape via collection.update() calls
          const meta = m.metadata as
            | { editMode: 'visual' | 'json' | 'ai' }
            | undefined;
          return convexClient.mutation(api.wf_step_defs.mutations.updateStep, {
            stepRecordId: toId<'wfStepDefs'>(m.key),
            updates: m.changes,
            editMode: meta?.editMode ?? 'visual',
          });
        }),
      );
    },
  });

export type { WfStep };
