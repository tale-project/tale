import { api } from '@/convex/_generated/api';
import { toId } from '@/lib/utils/type-guards';

import type { CollectionFactory } from '../collection-registry';
import type { ConvexItemOf } from '../convex-collection-options';

import { convexCollectionOptions } from '../convex-collection-options';

type CustomAgent = ConvexItemOf<
  typeof api.custom_agents.queries.listCustomAgents
>;

export const createCustomAgentsCollection: CollectionFactory<
  CustomAgent,
  string
> = (scopeId, queryClient, convexQueryFn, convexClient) =>
  convexCollectionOptions({
    id: 'custom-agents',
    queryFn: api.custom_agents.queries.listCustomAgents,
    args: { organizationId: scopeId },
    queryClient,
    convexQueryFn,
    getKey: (item) => item._id,
    onUpdate: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) => {
          const {
            _id,
            _creationTime,
            organizationId: _org,
            rootVersionId: _root,
            versionNumber: _ver,
            status: _status,
            isActive: _active,
            createdBy: _created,
            publishedAt: _pubAt,
            publishedBy: _pubBy,
            parentVersionId: _parent,
            changeLog: _cl,
            ...fields
          } = m.changes;
          return convexClient.mutation(
            api.custom_agents.mutations.updateCustomAgent,
            {
              customAgentId: toId<'customAgents'>(m.key),
              ...fields,
            },
          );
        }),
      );
    },
    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) =>
          convexClient.mutation(api.custom_agents.mutations.deleteCustomAgent, {
            customAgentId: toId<'customAgents'>(m.key),
          }),
        ),
      );
    },
  });

export type { CustomAgent };
