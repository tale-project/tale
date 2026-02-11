import { api } from '@/convex/_generated/api';
import { toId } from '@/lib/utils/type-guards';

import type { CollectionFactory } from '../collection-registry';
import type { ConvexItemOf } from '../convex-collection-options';

import { convexCollectionOptions } from '../convex-collection-options';

type Member = ConvexItemOf<typeof api.members.queries.listByOrganization>;

export const createMembersCollection: CollectionFactory<Member, string> = (
  scopeId,
  queryClient,
  convexQueryFn,
  convexClient,
) =>
  convexCollectionOptions({
    id: 'members',
    queryFn: api.members.queries.listByOrganization,
    args: { organizationId: scopeId },
    queryClient,
    convexQueryFn,
    getKey: (item) => item._id,
    onUpdate: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.flatMap((m) => {
          const promises: Promise<unknown>[] = [];
          if (m.changes.role !== undefined) {
            promises.push(
              convexClient.mutation(api.members.mutations.updateMemberRole, {
                memberId: toId<'members'>(m.key),
                role: m.changes.role,
              }),
            );
          }
          if (m.changes.displayName !== undefined) {
            promises.push(
              convexClient.mutation(
                api.members.mutations.updateMemberDisplayName,
                {
                  memberId: toId<'members'>(m.key),
                  displayName: m.changes.displayName,
                },
              ),
            );
          }
          return promises;
        }),
      );
    },
    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) =>
          convexClient.mutation(api.members.mutations.removeMember, {
            memberId: toId<'members'>(m.key),
          }),
        ),
      );
    },
  });

export type { Member };
