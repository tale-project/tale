'use client';

import { useState } from 'react';
import { Search, Plus } from 'lucide-react';
import { Button } from '@/app/components/ui/primitives/button';
import { Input } from '@/app/components/ui/forms/input';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { useT } from '@/lib/i18n/client';
import { useDebounce } from '@/app/hooks/use-debounce';
import { TeamTable } from './team-table';
import { TeamCreateDialog } from './team-create-dialog';
import { useListTeams } from '../hooks/use-list-teams';

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
  const { teams, isLoading, isExternallyManaged } = useListTeams(organizationId);

  // Filter teams by search query
  const filteredTeams = teams?.filter((team: { id: string; name: string }) =>
    team.name.toLowerCase().includes(debouncedSearch.toLowerCase()),
  );

  return (
    <Stack>
      <Stack gap={1}>
        <h2 className="text-base font-semibold text-foreground">
          {tSettings('teams.title')}
        </h2>
        <p className="text-sm text-muted-foreground tracking-[-0.084px]">
          {isExternallyManaged
            ? tSettings('teams.externallyManagedDescription')
            : tSettings('teams.description')}
        </p>
      </Stack>

      <HStack justify="between" className="pt-4">
        <div className="relative flex-1 max-w-sm">
          <Search className="absolute left-3 top-1/2 transform -translate-y-1/2 size-4 text-muted-foreground" />
          <Input
            placeholder={tSettings('teams.searchTeam')}
            size="sm"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            className="pl-10"
          />
        </div>
        {!isExternallyManaged && (
          <Button
            size="sm"
            onClick={() => setIsCreateDialogOpen(true)}
            className="bg-foreground text-background hover:bg-foreground/90"
          >
            <Plus className="size-4 mr-2" />
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
