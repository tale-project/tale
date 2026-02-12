'use client';

import type { TeamMember } from '@/lib/collections/entities/team-members';
import type { Team } from '@/lib/collections/entities/teams';

import { createTeamMembersCollection } from '@/lib/collections/entities/team-members';
import { createTeamsCollection } from '@/lib/collections/entities/teams';
import { useCollection } from '@/lib/collections/use-collection';

export function useTeamCollection(organizationId: string | undefined) {
  return useCollection('teams', createTeamsCollection, organizationId ?? '');
}

export function useTeamMemberCollection(teamId: string | undefined) {
  return useCollection(
    'team-members',
    createTeamMembersCollection,
    teamId ?? '',
  );
}

export type { Team, TeamMember };
