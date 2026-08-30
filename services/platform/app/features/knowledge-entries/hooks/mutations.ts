import { useBackendMutation } from '@/app/hooks/use-backend-mutation';

export function useCreateKnowledgeEntry() {
  return useBackendMutation('knowledge_entries/mutations:createKnowledgeEntry');
}

export function useUpdateKnowledgeEntry() {
  return useBackendMutation('knowledge_entries/mutations:updateKnowledgeEntry');
}

export function useDeleteKnowledgeEntry() {
  return useBackendMutation('knowledge_entries/mutations:deleteKnowledgeEntry');
}
