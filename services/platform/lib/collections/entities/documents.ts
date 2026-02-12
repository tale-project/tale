import { api } from '@/convex/_generated/api';
import { toId } from '@/lib/utils/type-guards';

import type { CollectionFactory } from '../collection-registry';
import type { ConvexItemOf } from '../convex-collection-options';

import { convexCollectionOptions } from '../convex-collection-options';

type Document = ConvexItemOf<typeof api.documents.queries.listDocuments>;

export const createDocumentsCollection: CollectionFactory<Document, string> = (
  scopeId,
  queryClient,
  convexQueryFn,
  convexClient,
) =>
  convexCollectionOptions({
    id: 'documents',
    queryFn: api.documents.queries.listDocuments,
    args: { organizationId: scopeId },
    queryClient,
    convexQueryFn,
    getKey: (item) => item.id,
    onUpdate: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) => {
          const { changes } = m;
          return convexClient.mutation(api.documents.mutations.updateDocument, {
            documentId: toId<'documents'>(m.key),
            ...(changes.name !== undefined && { title: changes.name }),
            ...(changes.teamTags !== undefined && {
              teamTags: changes.teamTags,
            }),
            ...(changes.mimeType !== undefined && {
              mimeType: changes.mimeType,
            }),
            ...(changes.extension !== undefined && {
              extension: changes.extension,
            }),
            ...(changes.sourceProvider !== undefined && {
              sourceProvider: changes.sourceProvider,
            }),
          });
        }),
      );
    },
    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) =>
          convexClient.mutation(api.documents.mutations.deleteDocument, {
            documentId: toId<'documents'>(m.key),
          }),
        ),
      );
    },
  });

export type { Document };
