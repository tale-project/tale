import { api } from '@/convex/_generated/api';
import { toId } from '@/lib/utils/type-guards';

import type { CollectionFactory } from '../collection-registry';

import { convexCollectionOptions } from '../convex-collection-options';

type TeamMember = {
  _id: string;
  teamId: string;
  userId: string;
  role: string;
  joinedAt: number;
  displayName: string | undefined;
  email: string | undefined;
};

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
    getKey: (item) => item._id,
    onInsert: async ({ transaction }) => {
      await Promise.all(
        transaction.mutations.map((m) => {
          // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- metadata typed as unknown; consumer passes organizationId
          const meta = m.metadata as { organizationId: string } | undefined;
          return convexClient.mutation(api.team_members.mutations.addMember, {
            teamId: m.modified.teamId,
            userId: m.modified.userId,
            organizationId: meta?.organizationId ?? '',
          });
        }),
      );
    },
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
