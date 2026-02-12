import { api } from '@/convex/_generated/api';
import { toId } from '@/lib/utils/type-guards';

import type { CollectionFactory } from '../collection-registry';
import type { ConvexItemOf } from '../convex-collection-options';

import { convexCollectionOptions } from '../convex-collection-options';

type TeamMember = ConvexItemOf<typeof api.team_members.queries.listByTeam>;

export const createTeamMembersCollection: CollectionFactory<
  TeamMember,
  string
> = (scopeId, queryClient, convexQueryFn, convexClient) =>
  convexCollectionOptions({
    id: 'team-members',
    queryFn: api.team_members.queries.listByTeam,
    args: { teamId: scopeId },
    queryClient,
    convexQueryFn,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- Convex codegen resolves TeamMember to object; _id exists at runtime as all Convex documents have _id
    getKey: (item) => (item as { _id: string })._id,
    onDelete: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) => {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- metadata typed as unknown; consumer passes organizationId
          const meta = m.metadata as { organizationId: string } | undefined;
          return convexClient.mutation(
            api.team_members.mutations.removeMember,
            {
              teamMemberId: toId<'teamMembers'>(m.key),
              organizationId: meta?.organizationId ?? '',
            },
          );
        }),
      );
    },
  });

export type { TeamMember };
