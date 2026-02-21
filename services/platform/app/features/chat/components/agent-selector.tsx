'use client';

import { Bot, ChevronDown, Check, Search } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';

import { Popover } from '@/app/components/ui/overlays/popover';
import { useT } from '@/lib/i18n/client';

import { useChatLayout } from '../context/chat-layout-context';
import { useChatAgents } from '../hooks/queries';

interface AgentSelectorProps {
  organizationId: string;
}

const DEFAULT_AGENT_VALUE = '__default__';

/** Stable ordering for system default agents by slug */
const SYSTEM_SLUG_ORDER: Record<string, number> = {
  chat: 0,
  web: 1,
  crm: 2,
  document: 3,
  integration: 4,
  workflow: 5,
};

interface AgentOption {
  value: string;
  label: string;
  description: string;
  isSystemDefault?: boolean;
  isDefaultChat?: boolean;
  systemAgentSlug?: string;
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
  const { selectedAgent, setSelectedAgent } = useChatLayout();
  const { agents: allAgents } = useChatAgents(organizationId);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const { systemOptions, customOptions } = useMemo(() => {
    if (!allAgents) return { systemOptions: [], customOptions: [] };

    const system: AgentOption[] = [];
    const custom: AgentOption[] = [];

    for (const agent of allAgents) {
      const rootId = agent.rootVersionId ?? agent._id;
      const isSystem = Boolean(agent.isSystemDefault);
      const isDefaultChat = isSystem && agent.systemAgentSlug === 'chat';

      const option: AgentOption = {
        value: isDefaultChat ? DEFAULT_AGENT_VALUE : rootId,
        label: agent.displayName,
        description: agent.description || '',
        isSystemDefault: isSystem,
        isDefaultChat,
        systemAgentSlug: agent.systemAgentSlug,
      };

      if (isSystem) {
        system.push(option);
      } else {
        custom.push(option);
      }
    }

    // Sort system agents by stable slug order
    system.sort((a, b) => {
      const aOrder = SYSTEM_SLUG_ORDER[a.systemAgentSlug ?? ''] ?? 99;
      const bOrder = SYSTEM_SLUG_ORDER[b.systemAgentSlug ?? ''] ?? 99;
      return aOrder - bOrder;
    });

    return { systemOptions: system, customOptions: custom };
  }, [allAgents]);

  const filteredSystem = useMemo(
    () => filterOptions(systemOptions, search),
    [systemOptions, search],
  );
  const filteredCustom = useMemo(
    () => filterOptions(customOptions, search),
    [customOptions, search],
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
            isSystemDefault: agent.isSystemDefault,
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

  const hasCustomAgents = filteredCustom.length > 0;
  const hasNoResults =
    filteredSystem.length === 0 && filteredCustom.length === 0;

  return (
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
        {filteredSystem.map((option) => (
          <OptionButton
            key={option.value}
            option={option}
            isSelected={currentValue === option.value}
            onSelect={handleSelect}
          />
        ))}

        {hasCustomAgents && (
          <>
            {filteredSystem.length > 0 && (
              <hr className="border-border mx-2 my-1 border-t" />
            )}
            <div className="text-muted-foreground px-2 py-1 text-[10px] font-medium tracking-wider uppercase">
              {t('agentSelector.customSection')}
            </div>
            {filteredCustom.map((option) => (
              <OptionButton
                key={option.value}
                option={option}
                isSelected={currentValue === option.value}
                onSelect={handleSelect}
              />
            ))}
          </>
        )}

        {hasNoResults && (
          <div className="text-muted-foreground px-3 py-4 text-center text-sm">
            {t('agentSelector.noResults')}
          </div>
        )}
      </div>
    </Popover>
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
