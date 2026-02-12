import { createDocumentsCollection } from '@/lib/collections/entities/documents';
import { useCollection } from '@/lib/collections/use-collection';

export function useDocumentCollection(organizationId: string) {
  return useCollection('documents', createDocumentsCollection, organizationId);
}
