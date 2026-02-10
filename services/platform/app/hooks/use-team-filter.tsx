'use client';

import { useQuery } from 'convex/react';
import {
  createContext,
  useContext,
  useState,
  useCallback,
  useMemo,
  type ReactNode,
} from 'react';

import { api } from '@/convex/_generated/api';

function getStorageKey(organizationId: string) {
  return `team-filter:${organizationId}`;
}

interface Team {
  id: string;
  name: string;
}

interface TeamFilterContextType {
  teams: Team[] | null;
  isLoadingTeams: boolean;
  selectedTeamId: string | null;
  setSelectedTeamId: (teamId: string | null) => void;
  filterByTeam: <
    T extends { teamId?: string | null; sharedWithTeamIds?: string[] },
  >(
    items: T[],
  ) => T[];
}

const TeamFilterContext = createContext<TeamFilterContextType | null>(null);

export function useTeamFilter() {
  const context = useContext(TeamFilterContext);
  if (!context) {
    throw new Error('useTeamFilter must be used within TeamFilterProvider');
  }
  return context;
}

interface TeamFilterProviderProps {
  organizationId: string;
  children: ReactNode;
}

export function TeamFilterProvider({
  organizationId,
  children,
}: TeamFilterProviderProps) {
  const storageKey = getStorageKey(organizationId);

  const [selectedTeamId, setSelectedTeamIdRaw] = useState<string | null>(() => {
    if (typeof window === 'undefined') return null;
    return localStorage.getItem(storageKey);
  });

  const teamsResult = useQuery(api.members.queries.getMyTeams, {
    organizationId,
  });
  const teams = teamsResult?.teams ?? null;
  const isLoadingTeams = teamsResult === undefined;

  // Validate: clear selection if stored team no longer exists
  const validatedTeamId =
    selectedTeamId && teams && !teams.some((t) => t.id === selectedTeamId)
      ? null
      : selectedTeamId;

  const setSelectedTeamId = useCallback(
    (teamId: string | null) => {
      setSelectedTeamIdRaw(teamId);
      if (teamId) {
        localStorage.setItem(storageKey, teamId);
      } else {
        localStorage.removeItem(storageKey);
      }
    },
    [storageKey],
  );

  const filterByTeam = useCallback(
    <T extends { teamId?: string | null; sharedWithTeamIds?: string[] }>(
      items: T[],
    ): T[] => {
      if (!validatedTeamId) return items;
      return items.filter((item) => {
        if (!item.teamId) return true;
        if (item.teamId === validatedTeamId) return true;
        return item.sharedWithTeamIds?.includes(validatedTeamId) ?? false;
      });
    },
    [validatedTeamId],
  );

  const value = useMemo(
    () => ({
      teams,
      isLoadingTeams,
      selectedTeamId: validatedTeamId,
      setSelectedTeamId,
      filterByTeam,
    }),
    [teams, isLoadingTeams, validatedTeamId, setSelectedTeamId, filterByTeam],
  );

  return (
    <TeamFilterContext.Provider value={value}>
      {children}
    </TeamFilterContext.Provider>
  );
}
