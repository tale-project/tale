import { useConvexMutation } from '@/app/hooks/use-convex-mutation';

export function useCreateKnowledgeEntry() {
  return useConvexMutation('knowledge_entries/mutations:createKnowledgeEntry');
}

export function useUpdateKnowledgeEntry() {
  return useConvexMutation('knowledge_entries/mutations:updateKnowledgeEntry');
}

export function useDeleteKnowledgeEntry() {
  return useConvexMutation('knowledge_entries/mutations:deleteKnowledgeEntry');
}
