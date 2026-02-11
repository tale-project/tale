'use client';

import type { Collection } from '@tanstack/db';

import { useLiveQuery } from '@tanstack/react-db';

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

export function useTeams(collection: Collection<Team, string>) {
  const { data, isLoading } = useLiveQuery(
    (q) => q.from({ team: collection }).select(({ team }) => team),
    [],
  );

  return {
    teams: data,
    isLoading,
  };
}

export function useTeamMembers(collection: Collection<TeamMember, string>) {
  const { data, isLoading } = useLiveQuery(
    (q) => q.from({ member: collection }).select(({ member }) => member),
    [],
  );

  return {
    teamMembers: data,
    isLoading,
  };
}

export type { Team, TeamMember };
