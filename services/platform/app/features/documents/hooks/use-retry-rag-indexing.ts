import { useAction } from 'convex/react';
import { api } from '@/convex/_generated/api';

// Note: useAction - calls external RAG service, can't predict result
export function useRetryRagIndexing() {
  return useAction(api.documents.actions.retryRagIndexing);
}
