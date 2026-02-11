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
  _convexClient,
) =>
  convexCollectionOptions({
    id: 'wf-steps',
    queryFn: api.wf_step_defs.queries.getWorkflowSteps,
    args: { wfDefinitionId: toId<'wfDefinitions'>(scopeId) },
    queryClient,
    convexQueryFn,
    getKey: (item) => item._id,
  });

export type { WfStep };
