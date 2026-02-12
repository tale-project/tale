import type { Collection } from '@tanstack/db';

import { useLiveQuery } from '@tanstack/react-db';

import type { TeamMember } from '@/lib/collections/entities/team-members';
import type { Team } from '@/lib/collections/entities/teams';

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
