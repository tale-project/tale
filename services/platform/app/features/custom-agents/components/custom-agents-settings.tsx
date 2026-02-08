'use client';

import { useState } from 'react';
import { Plus } from 'lucide-react';
import { Button } from '@/app/components/ui/primitives/button';
import { SearchInput } from '@/app/components/ui/forms/search-input';
import { Stack, HStack } from '@/app/components/ui/layout/layout';
import { useT } from '@/lib/i18n/client';
import { useDebounce } from '@/app/hooks/use-debounce';
import { CustomAgentTable } from './custom-agent-table';
import { CustomAgentCreateDialog } from './custom-agent-create-dialog';
import { useListCustomAgents } from '../hooks/use-list-custom-agents';

interface CustomAgentsSettingsProps {
  organizationId: string;
}

export function CustomAgentsSettings({ organizationId }: CustomAgentsSettingsProps) {
  const { t } = useT('settings');
  const [searchQuery, setSearchQuery] = useState('');
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);

  const debouncedSearch = useDebounce(searchQuery, 300);
  const { agents, isLoading } = useListCustomAgents(organizationId);

  const filteredAgents = agents
    ? agents.filter((agent) =>
        agent.displayName.toLowerCase().includes(debouncedSearch.toLowerCase()) ||
        agent.name.toLowerCase().includes(debouncedSearch.toLowerCase()),
      )
    : undefined;

  return (
    <Stack>
      <Stack gap={1}>
        <h2 className="text-base font-semibold text-foreground">
          {t('customAgents.title')}
        </h2>
        <p className="text-sm text-muted-foreground tracking-[-0.084px]">
          {t('customAgents.description')}
        </p>
      </Stack>

      <HStack justify="between" className="pt-4">
        <SearchInput
          placeholder={t('customAgents.searchAgent')}
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          wrapperClassName="flex-1 max-w-sm"
        />
        <Button
          size="sm"
          onClick={() => setIsCreateDialogOpen(true)}
          className="bg-foreground text-background hover:bg-foreground/90"
        >
          <Plus className="size-4 mr-2" />
          {t('customAgents.createAgent')}
        </Button>
      </HStack>

      <CustomAgentTable
        agents={filteredAgents || []}
        isLoading={isLoading}
      />

      <CustomAgentCreateDialog
        organizationId={organizationId}
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
      />
    </Stack>
  );
}
