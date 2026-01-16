import { useMutation } from 'convex/react';
import { api } from '@/convex/_generated/api';

// Note: Optimistic updates not added because getDocuments uses complex pagination params
export function useDeleteDocument() {
  return useMutation(api.mutations.documents.deleteDocument);
}
