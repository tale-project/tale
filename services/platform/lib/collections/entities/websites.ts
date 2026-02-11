import { api } from '@/convex/_generated/api';
import { toId } from '@/lib/utils/type-guards';

import type { CollectionFactory } from '../collection-registry';
import type { ConvexItemOf } from '../convex-collection-options';

import { convexCollectionOptions } from '../convex-collection-options';

type Website = ConvexItemOf<typeof api.websites.queries.listWebsites>;

export const createWebsitesCollection: CollectionFactory<Website, string> = (
  scopeId,
  queryClient,
  convexQueryFn,
  convexClient,
) =>
  convexCollectionOptions({
    id: 'websites',
    queryFn: api.websites.queries.listWebsites,
    args: { organizationId: scopeId },
    queryClient,
    convexQueryFn,
    getKey: (item) => item._id,
    onInsert: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) => {
          const { _id, _creationTime, ...fields } = m.modified;
          return convexClient.mutation(api.websites.mutations.createWebsite, {
            organizationId: scopeId,
            domain: fields.domain,
            title: fields.title,
            description: fields.description,
            scanInterval: fields.scanInterval,
          });
        }),
      );
    },
    onUpdate: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) => {
          const {
            _id,
            _creationTime,
            organizationId: _org,
            lastScannedAt: _ls,
            metadata: _meta,
            ...fields
          } = m.changes;
          return convexClient.mutation(api.websites.mutations.updateWebsite, {
            websiteId: toId<'websites'>(m.key),
            ...fields,
          });
        }),
      );
    },
    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) =>
          convexClient.mutation(api.websites.mutations.deleteWebsite, {
            websiteId: toId<'websites'>(m.key),
          }),
        ),
      );
    },
  });

export type { Website };
