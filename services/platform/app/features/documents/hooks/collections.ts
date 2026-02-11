import type { Collection } from '@tanstack/db';

import { useLiveQuery } from '@tanstack/react-db';

import type { Document } from '@/lib/collections/entities/documents';

import { createDocumentsCollection } from '@/lib/collections/entities/documents';
import { useCollection } from '@/lib/collections/use-collection';

export function useDocumentCollection(organizationId: string) {
  return useCollection('documents', createDocumentsCollection, organizationId);
}

export function useDocuments(collection: Collection<Document, string>) {
  const { data, isLoading } = useLiveQuery((q) =>
    q.from({ document: collection }).select(({ document }) => document),
  );

  return {
    documents: data,
    isLoading,
  };
}
