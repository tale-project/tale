import { useBackendMutation } from '@/app/hooks/use-backend-mutation';

// Every caller of these writes reports a failure itself: the create and edit
// dialogs in their own toast (a duplicate topic by name), a delete in the
// one toast of the delete dialog or the table's bulk bar, with the refusal's
// words. The default toast would report the same failure a second time.

export function useCreateKnowledgeEntry() {
  return useBackendMutation(
    'knowledge_entries/mutations:createKnowledgeEntry',
    {
      errorToast: false,
    },
  );
}

export function useUpdateKnowledgeEntry() {
  return useBackendMutation(
    'knowledge_entries/mutations:updateKnowledgeEntry',
    {
      errorToast: false,
    },
  );
}

export function useDeleteKnowledgeEntry() {
  return useBackendMutation(
    'knowledge_entries/mutations:deleteKnowledgeEntry',
    {
      errorToast: false,
    },
  );
}
