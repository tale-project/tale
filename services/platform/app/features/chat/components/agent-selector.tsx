'use client';

import { Bot, ChevronDown, Check, Plus, Search } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';

import { Popover } from '@/app/components/ui/overlays/popover';
import { Button } from '@/app/components/ui/primitives/button';
import { CreateCustomAgentDialog } from '@/app/features/custom-agents/components/custom-agent-create-dialog';
import { useAbility } from '@/app/hooks/use-ability';
import { useDialogSearchParam } from '@/app/hooks/use-dialog-search-param';
import { useT } from '@/lib/i18n/client';

import { useChatLayout } from '../context/chat-layout-context';
import { useChatAgents } from '../hooks/queries';

interface AgentSelectorProps {
  organizationId: string;
}

const DEFAULT_AGENT_VALUE = '__default__';

interface AgentOption {
  value: string;
  label: string;
  description: string;
  isDefaultChat?: boolean;
}

function filterOptions(options: AgentOption[], query: string) {
  if (!query) return options;
  const lower = query.toLowerCase();
  return options.filter(
    (o) =>
      o.label.toLowerCase().includes(lower) ||
      o.description.toLowerCase().includes(lower),
  );
}

export function AgentSelector({ organizationId }: AgentSelectorProps) {
  const { t } = useT('chat');
  const ability = useAbility();
  const { selectedAgent, setSelectedAgent } = useChatLayout();
  const { agents: allAgents } = useChatAgents(organizationId);
  const canManageAgents = ability.can('write', 'customAgents');
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);
  const createAgentDialog = useDialogSearchParam({
    paramValue: 'create-agent',
  });

  const options = useMemo(() => {
    if (!allAgents) return [];

    const result: AgentOption[] = [];

    for (const agent of allAgents) {
      const rootId = agent.rootVersionId ?? agent._id;
      const isDefaultChat =
        Boolean(agent.isSystemDefault) && agent.systemAgentSlug === 'chat';

      result.push({
        value: isDefaultChat ? DEFAULT_AGENT_VALUE : rootId,
        label: agent.displayName,
        description: agent.description || '',
        isDefaultChat,
      });
    }

    // Default chat agent first, then alphabetical
    result.sort((a, b) => {
      if (a.isDefaultChat) return -1;
      if (b.isDefaultChat) return 1;
      return a.label.localeCompare(b.label);
    });

    return result;
  }, [allAgents]);

  const filteredOptions = useMemo(
    () => filterOptions(options, search),
    [options, search],
  );

  const currentValue = useMemo(() => {
    if (!selectedAgent) return DEFAULT_AGENT_VALUE;
    return selectedAgent._id;
  }, [selectedAgent]);

  const currentLabel =
    selectedAgent?.displayName ?? t('agentSelector.defaultAgent');

  const handleSelect = useCallback(
    (value: string) => {
      if (value === DEFAULT_AGENT_VALUE) {
        setSelectedAgent(null);
      } else {
        const agent = allAgents?.find(
          (a) => (a.rootVersionId ?? a._id) === value,
        );
        if (agent) {
          setSelectedAgent({
            _id: agent.rootVersionId ?? agent._id,
            displayName: agent.displayName,
          });
        }
      }
      setOpen(false);
    },
    [allAgents, setSelectedAgent],
  );

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSearch('');
    }
  }, []);

  const handleAddAgentClick = useCallback(() => {
    setOpen(false);
    createAgentDialog.open();
  }, [createAgentDialog]);

  const hasNoResults = filteredOptions.length === 0;

  return (
    <>
      <Popover
        open={open}
        onOpenChange={handleOpenChange}
        align="start"
        side="top"
        sideOffset={8}
        contentClassName="w-[20rem] p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          searchRef.current?.focus();
        }}
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
      >
        <div className="border-border flex items-center gap-2 border-b px-3 py-2">
          <Search
            className="text-muted-foreground size-3.5 shrink-0"
            aria-hidden="true"
          />
          <input
            ref={searchRef}
            type="text"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder={t('agentSelector.searchPlaceholder')}
            className="placeholder:text-muted-foreground flex-1 bg-transparent text-sm outline-none"
            aria-label={t('agentSelector.searchPlaceholder')}
          />
        </div>

        <div className="max-h-[20rem] overflow-y-auto p-1" role="listbox">
          {filteredOptions.map((option) => (
            <OptionButton
              key={option.value}
              option={option}
              isSelected={currentValue === option.value}
              onSelect={handleSelect}
            />
          ))}

          {hasNoResults && (
            <div className="text-muted-foreground px-3 py-4 text-center text-sm">
              {t('agentSelector.noResults')}
            </div>
          )}
        </div>

        {canManageAgents && (
          <div className="border-border border-t p-1">
            <Button
              variant="ghost"
              size="sm"
              className="w-full"
              icon={Plus}
              onClick={handleAddAgentClick}
            >
              {t('agentSelector.addAgent')}
            </Button>
          </div>
        )}
      </Popover>

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

function OptionButton({
  option,
  isSelected,
  onSelect,
}: {
  option: AgentOption;
  isSelected: boolean;
  onSelect: (value: string) => void;
}) {
  return (
    <button
      type="button"
      role="option"
      aria-selected={isSelected}
      onClick={() => onSelect(option.value)}
      className="hover:bg-accent flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors"
    >
      <div className="min-w-0 flex-1">
        <div className="text-foreground text-sm font-medium">
          {option.label}
        </div>
        {option.description && (
          <div className="text-muted-foreground text-xs">
            {option.description}
          </div>
        )}
      </div>
      {isSelected && (
        <Check className="text-primary size-4 shrink-0" aria-hidden="true" />
      )}
    </button>
  );
}
