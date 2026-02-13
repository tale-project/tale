import type { Collection } from '@tanstack/db';

import { useLiveQuery } from '@tanstack/react-db';

import type { TeamMember } from '@/lib/collections/entities/team-members';
import type { Team } from '@/lib/collections/entities/teams';

export function useTeams(collection: Collection<Team, string>) {
  const { data, isLoading } = useLiveQuery(() => collection);

  return {
    teams: data ?? null,
    isLoading,
  };
}

export function useTeamMembers(collection: Collection<TeamMember, string>) {
  const { data, isLoading } = useLiveQuery(() => collection);

  return {
    teamMembers: data,
    isLoading,
  };
}
