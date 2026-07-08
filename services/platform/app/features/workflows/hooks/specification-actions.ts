import { useConvexAction } from '@/app/hooks/use-convex-action';
import { api } from '@/convex/_generated/api';

export function useGenerateGraphFromSpecification() {
  return useConvexAction(
    api.workflows.specification_actions.previewGraphFromSpecification,
  );
}

export function useGenerateSpecificationFromGraph() {
  return useConvexAction(
    api.workflows.specification_actions.previewSpecificationFromGraph,
  );
}
