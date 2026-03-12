'use client';

import { useNavigate } from '@tanstack/react-router';
import { Bot, ChevronDown, Plus, Settings } from 'lucide-react';
import { type MouseEvent, useCallback, useMemo, useState } from 'react';

import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/app/components/ui/forms/searchable-select';
import { Button } from '@/app/components/ui/primitives/button';
import { IconButton } from '@/app/components/ui/primitives/icon-button';
import { CreateCustomAgentDialog } from '@/app/features/custom-agents/components/custom-agent-create-dialog';
import { useAbility } from '@/app/hooks/use-ability';
import { useDialogSearchParam } from '@/app/hooks/use-dialog-search-param';
import { useT } from '@/lib/i18n/client';

import { useChatLayout } from '../context/chat-layout-context';
import { useChatAgents } from '../hooks/queries';
import { useEffectiveAgent } from '../hooks/use-effective-agent';

interface AgentSelectorProps {
  organizationId: string;
}

export function AgentSelector({ organizationId }: AgentSelectorProps) {
  const { t } = useT('chat');
  const ability = useAbility();
  const navigate = useNavigate();
  const { setSelectedAgent } = useChatLayout();
  const effectiveAgent = useEffectiveAgent(organizationId);
  const { agents: allAgents } = useChatAgents(organizationId);
  const canManageAgents = ability.can('write', 'customAgents');
  const [open, setOpen] = useState(false);
  const createAgentDialog = useDialogSearchParam({
    paramValue: 'create-agent',
  });

  const options = useMemo(() => {
    if (!allAgents) return [];

    return [...allAgents]
      .map((agent) => ({
        value: agent.rootVersionId ?? agent._id,
        label: agent.displayName,
        description: agent.description || '',
        isDefaultChat:
          Boolean(agent.isSystemDefault) && agent.systemAgentSlug === 'chat',
      }))
      .sort((a, b) => {
        if (a.isDefaultChat) return -1;
        if (b.isDefaultChat) return 1;
        return a.label.localeCompare(b.label);
      });
  }, [allAgents]);

  const currentValue = effectiveAgent?._id ?? null;

  const currentLabel =
    effectiveAgent?.displayName ?? t('agentSelector.defaultAgent');

  const handleSelect = useCallback(
    (value: string) => {
      const agent = allAgents?.find(
        (a) => (a.rootVersionId ?? a._id) === value,
      );
      if (agent) {
        setSelectedAgent({
          _id: agent.rootVersionId ?? agent._id,
          displayName: agent.displayName,
        });
      }
    },
    [allAgents, setSelectedAgent],
  );

  const handleAddAgentClick = useCallback(() => {
    setOpen(false);
    createAgentDialog.open();
  }, [createAgentDialog]);

  const handleConfigClick = useCallback(
    (option: SearchableSelectOption, e: MouseEvent) => {
      e.stopPropagation();
      setOpen(false);
      void navigate({
        to: '/dashboard/$id/custom-agents/$agentId',
        params: { id: organizationId, agentId: option.value },
      });
    },
    [navigate, organizationId],
  );

  const renderOptionAction = useCallback(
    (option: SearchableSelectOption) => {
      if (!canManageAgents) return null;
      return (
        <IconButton
          icon={Settings}
          aria-label={t('agentSelector.configureAgent')}
          variant="ghost"
          iconSize={4}
          className="size-8 shrink-0 rounded-md"
          onClick={(e) => handleConfigClick(option, e)}
        />
      );
    },
    [canManageAgents, t, handleConfigClick],
  );

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
        contentClassName="w-[20rem]"
        searchPlaceholder={t('agentSelector.searchPlaceholder')}
        emptyText={t('agentSelector.noResults')}
        aria-label={t('agentSelector.label')}
        showRadio
        optionAction={renderOptionAction}
        trigger={
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs transition-colors"
            aria-label={t('agentSelector.label')}
          >
            <Bot className="size-3.5" aria-hidden="true" />
            <span>{currentLabel}</span>
            <ChevronDown className="size-3" aria-hidden="true" />
          </button>
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
        <CreateCustomAgentDialog
          open={createAgentDialog.isOpen}
          onOpenChange={createAgentDialog.onOpenChange}
          organizationId={organizationId}
        />
      )}
    </>
  );
}
