'use client';

import { Button } from '@tale/ui/button';
import { useNavigate } from '@tanstack/react-router';
import { Bot, ChevronDown, Plus } from 'lucide-react';
import { useCallback, useMemo, useState } from 'react';

import { SearchableSelect } from '@/app/components/ui/forms/searchable-select';
import { CreateAgentDialog } from '@/app/features/agents/components/agent-create-dialog';
import { useAbility } from '@/app/hooks/use-ability';
import { useDialogSearchParam } from '@/app/hooks/use-dialog-search-param';
import { useT } from '@/lib/i18n/client';

import { useChatLayout } from '../context/chat-layout-context';
import { useChatAgents } from '../hooks/queries';
import {
  getAgentMissingIntegrations,
  useIntegrationReadiness,
} from '../hooks/use-composer-capabilities';
import { useEffectiveAgent } from '../hooks/use-effective-agent';

interface AgentSelectorProps {
  organizationId: string;
}

export function AgentSelector({ organizationId }: AgentSelectorProps) {
  const { t } = useT('chat');
  const { t: tComposer } = useT('composer');
  const navigate = useNavigate();
  const ability = useAbility();
  const { setSelectedAgent } = useChatLayout();
  const { agent: effectiveAgent } = useEffectiveAgent(organizationId);
  const { agents: allAgents } = useChatAgents(organizationId);
  const readiness = useIntegrationReadiness(organizationId);
  const canManageAgents = ability.can('write', 'agents');
  const [open, setOpen] = useState(false);
  const createAgentDialog = useDialogSearchParam({
    paramValue: 'create-agent',
  });

  const options = useMemo(() => {
    if (!allAgents) return [];

    return [...allAgents]
      .map((agent) => {
        const missing = getAgentMissingIntegrations(agent, readiness);
        const missingTitle = missing[0]
          ? (readiness.titleBySlug.get(missing[0]) ?? missing[0])
          : undefined;
        return {
          value: agent.name,
          label: agent.displayName,
          description: agent.description || '',
          isDefaultChat: agent.name === 'chat-agent',
          labelBadge: missingTitle ? (
            <span className="text-muted-foreground text-xs">
              {tComposer('requiresIntegration', { name: missingTitle })}
            </span>
          ) : undefined,
          ready: missing.length === 0,
        };
      })
      .sort((a, b) => {
        if (a.isDefaultChat) return -1;
        if (b.isDefaultChat) return 1;
        return a.label.localeCompare(b.label);
      });
  }, [allAgents, readiness, tComposer]);

  const currentValue = effectiveAgent?.name ?? null;

  const currentLabel =
    effectiveAgent?.displayName ?? t('agentSelector.defaultAgent');

  const handleSelect = useCallback(
    (value: string) => {
      const agent = allAgents?.find((a) => a.name === value);
      if (!agent) return;
      const missing = getAgentMissingIntegrations(agent, readiness);
      if (missing.length > 0) {
        void navigate({
          to: '/dashboard/$id/settings/integrations',
          params: { id: organizationId },
          search: { tab: 'all', slug: missing[0] },
        });
        return;
      }
      setSelectedAgent({
        name: agent.name,
        displayName: agent.displayName,
      });
    },
    [allAgents, readiness, navigate, organizationId, setSelectedAgent],
  );

  const handleAddAgentClick = useCallback(() => {
    setOpen(false);
    createAgentDialog.open();
  }, [createAgentDialog]);

  return (
    <>
      <SearchableSelect
        value={currentValue}
        onValueChange={handleSelect}
        options={options}
        open={open}
        onOpenChange={setOpen}
        align="start"
        side="top"
        sideOffset={8}
        contentClassName="w-[16.25rem]"
        searchPlaceholder={t('agentSelector.searchPlaceholder')}
        emptyText={t('agentSelector.noResults')}
        aria-label={t('agentSelector.label')}
        trigger={
          <Button
            type="button"
            className="gap-2"
            size="icon"
            variant="ghost"
            aria-label={t('agentSelector.label')}
          >
            <Bot className="size-3.5" aria-hidden="true" />
            <span>{currentLabel}</span>
            <ChevronDown className="size-3" aria-hidden="true" />
          </Button>
        }
        footer={
          canManageAgents ? (
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              icon={Plus}
              onClick={handleAddAgentClick}
            >
              {t('agentSelector.addAgent')}
            </Button>
          ) : undefined
        }
      />

      {canManageAgents && (
        <CreateAgentDialog
          open={createAgentDialog.isOpen}
          onOpenChange={createAgentDialog.onOpenChange}
          organizationId={organizationId}
        />
      )}
    </>
  );
}
