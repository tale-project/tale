import { useConvexMutation } from '@/app/hooks/use-convex-mutation';
import { api } from '@/convex/_generated/api';

export function useCreateKnowledgeEntry() {
  return useConvexMutation(
    api.knowledge_entries.mutations.createKnowledgeEntry,
  );
}

export function useUpdateKnowledgeEntry() {
  return useConvexMutation(
    api.knowledge_entries.mutations.updateKnowledgeEntry,
  );
}

export function useDeleteKnowledgeEntry() {
  return useConvexMutation(
    api.knowledge_entries.mutations.deleteKnowledgeEntry,
  );
}
