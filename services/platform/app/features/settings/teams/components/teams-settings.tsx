'use client';

import { Plus } from 'lucide-react';
import { useState } from 'react';

import { SearchInput } from '@/app/components/ui/forms/search-input';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { Button } from '@/app/components/ui/primitives/button';
import { useDebounce } from '@/app/hooks/use-debounce';
import { useT } from '@/lib/i18n/client';

import { useTeamCollection, useTeams } from '../hooks/collections';
import { TeamCreateDialog } from './team-create-dialog';
import { TeamTable } from './team-table';

interface TeamsSettingsProps {
  organizationId: string;
}

export function TeamsSettings({ organizationId }: TeamsSettingsProps) {
  const { t: tSettings } = useT('settings');
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  // Debounce search query for filtering
  const debouncedSearch = useDebounce(searchQuery, 300);

  // Fetch teams - in trusted headers mode, teams come from JWT claims
  // In normal auth mode, teams come from the teamMember database table
  const teamCollection = useTeamCollection(organizationId);
  const { teams, isLoading, isExternallyManaged } = useTeams(teamCollection);

  // Filter teams by search query
  const filteredTeams = teams?.filter((team: { id: string; name: string }) =>
    team.name.toLowerCase().includes(debouncedSearch.toLowerCase()),
  );

  return (
    <Stack>
      <Stack gap={1}>
        <h2 className="text-foreground text-base font-semibold">
          {tSettings('teams.title')}
        </h2>
        <p className="text-muted-foreground text-sm tracking-[-0.084px]">
          {isExternallyManaged
            ? tSettings('teams.externallyManagedDescription')
            : tSettings('teams.description')}
        </p>
      </Stack>

      <HStack justify="between" className="pt-4">
        <SearchInput
          placeholder={tSettings('teams.searchTeam')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          wrapperClassName="flex-1 max-w-sm"
        />
        {!isExternallyManaged && (
          <Button
            size="sm"
            onClick={() => setIsCreateDialogOpen(true)}
            className="bg-foreground text-background hover:bg-foreground/90"
          >
            <Plus className="mr-2 size-4" />
            {tSettings('teams.createTeam')}
          </Button>
        )}
      </HStack>

      <TeamTable
        teams={filteredTeams || []}
        isLoading={isLoading}
        organizationId={organizationId}
        isExternallyManaged={isExternallyManaged}
      />

      {!isExternallyManaged && (
        <TeamCreateDialog
          organizationId={organizationId}
          open={isCreateDialogOpen}
          onOpenChange={setIsCreateDialogOpen}
        />
      )}
    </Stack>
  );
}
