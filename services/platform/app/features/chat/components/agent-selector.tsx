'use client';

import { Bot, ChevronDown, Check, Search } from 'lucide-react';
import { useCallback, useMemo, useRef, useState } from 'react';

import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/app/components/ui/overlays/popover';
import { useT } from '@/lib/i18n/client';

import { useChatLayout } from '../context/chat-layout-context';
import { useChatAgents } from '../hooks/queries';

interface AgentSelectorProps {
  organizationId: string;
}

const BUILTIN_AGENT_TYPES = [
  'chat',
  'web',
  'crm',
  'document',
  'integration',
  'workflow',
] as const;
const DEFAULT_AGENT_VALUE = '__default__';

interface AgentOption {
  value: string;
  label: string;
  description: string;
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
  const { agents: customAgents } = useChatAgents(organizationId);
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const searchRef = useRef<HTMLInputElement>(null);

  const builtinOptions = useMemo<AgentOption[]>(
    () =>
      BUILTIN_AGENT_TYPES.map((type) => ({
        value: type === 'chat' ? DEFAULT_AGENT_VALUE : `builtin:${type}`,
        label: t(`agentSelector.builtinAgents.${type}.name`),
        description: t(`agentSelector.builtinAgents.${type}.description`),
      })),
    [t],
  );

  const customOptions = useMemo<AgentOption[]>(() => {
    if (!customAgents) return [];
    return customAgents.map((agent) => ({
      value: `custom:${agent.rootVersionId ?? agent._id}`,
      label: agent.displayName,
      description: agent.description || '',
    }));
  }, [customAgents]);

  const filteredBuiltin = useMemo(
    () => filterOptions(builtinOptions, search),
    [builtinOptions, search],
  );
  const filteredCustom = useMemo(
    () => filterOptions(customOptions, search),
    [customOptions, search],
  );

  const currentValue = useMemo(() => {
    if (!selectedAgent) return DEFAULT_AGENT_VALUE;
    if (selectedAgent.type === 'builtin') return `builtin:${selectedAgent._id}`;
    return `custom:${selectedAgent._id}`;
  }, [selectedAgent]);

  const currentLabel =
    selectedAgent?.displayName ?? t('agentSelector.defaultAgent');

  const handleSelect = (value: string) => {
    if (value === DEFAULT_AGENT_VALUE) {
      setSelectedAgent(null);
    } else if (value.startsWith('builtin:')) {
      const agentType = value.replace('builtin:', '');
      const option = builtinOptions.find((o) => o.value === value);
      if (option) {
        setSelectedAgent({
          type: 'builtin',
          _id: agentType,
          displayName: option.label,
        });
      }
    } else if (value.startsWith('custom:')) {
      const agentId = value.replace('custom:', '');
      const agent = customAgents?.find(
        (a) => (a.rootVersionId ?? a._id) === agentId,
      );
      if (agent) {
        setSelectedAgent({
          type: 'custom',
          _id: agent.rootVersionId ?? agent._id,
          displayName: agent.displayName,
        });
      }
    }
    setOpen(false);
  };

  const handleOpenChange = useCallback((nextOpen: boolean) => {
    setOpen(nextOpen);
    if (!nextOpen) {
      setSearch('');
    }
  }, []);

  const hasCustomAgents = filteredCustom.length > 0;
  const hasNoResults =
    filteredBuiltin.length === 0 && filteredCustom.length === 0;

  return (
    <Popover open={open} onOpenChange={handleOpenChange}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="text-muted-foreground hover:text-foreground flex items-center gap-1.5 text-xs transition-colors"
          aria-label={t('agentSelector.label')}
        >
          <Bot className="size-3.5" aria-hidden="true" />
          <span>{currentLabel}</span>
          <ChevronDown className="size-3" aria-hidden="true" />
        </button>
      </PopoverTrigger>
      <PopoverContent
        align="start"
        side="top"
        sideOffset={8}
        className="w-[20rem] p-0"
        onOpenAutoFocus={(e) => {
          e.preventDefault();
          searchRef.current?.focus();
        }}
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
          {filteredBuiltin.map((option) => (
            <OptionButton
              key={option.value}
              option={option}
              isSelected={currentValue === option.value}
              onSelect={handleSelect}
            />
          ))}

          {hasCustomAgents && (
            <>
              {filteredBuiltin.length > 0 && (
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
      </PopoverContent>
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
