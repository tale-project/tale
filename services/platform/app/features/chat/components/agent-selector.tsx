'use client';

import { useMemo, useState } from 'react';
import { Bot, ChevronDown, Check } from 'lucide-react';
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from '@/app/components/ui/overlays/popover';
import { useT } from '@/lib/i18n/client';
import { useChatLayout } from '../context/chat-layout-context';
import { useListChatAgents } from '../hooks/use-list-chat-agents';

interface AgentSelectorProps {
  organizationId: string;
}

const DEFAULT_AGENT_VALUE = '__default__';

export function AgentSelector({ organizationId }: AgentSelectorProps) {
  const { t } = useT('chat');
  const { selectedAgent, setSelectedAgent } = useChatLayout();
  const agents = useListChatAgents(organizationId);
  const [open, setOpen] = useState(false);

  const options = useMemo(() => {
    const items = [
      {
        value: DEFAULT_AGENT_VALUE,
        label: t('agentSelector.defaultAgent'),
        description: t('agentSelector.defaultAgentDescription'),
      },
    ];

    if (agents) {
      for (const agent of agents) {
        items.push({
          value: agent._id,
          label: agent.displayName,
          description: agent.description || '',
        });
      }
    }

    return items;
  }, [agents, t]);

  const currentValue = selectedAgent?._id ?? DEFAULT_AGENT_VALUE;
  const currentLabel = selectedAgent?.displayName ?? t('agentSelector.defaultAgent');

  const handleSelect = (value: string) => {
    if (value === DEFAULT_AGENT_VALUE) {
      setSelectedAgent(null);
    } else {
      const agent = agents?.find((a) => a._id === value);
      if (agent) {
        setSelectedAgent({
          _id: agent._id,
          displayName: agent.displayName,
        });
      }
    }
    setOpen(false);
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          className="flex items-center gap-1.5 text-muted-foreground hover:text-foreground transition-colors text-xs"
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
        className="p-1 min-w-[12rem] max-w-[16rem]"
      >
        {options.map((option) => (
          <button
            key={option.value}
            type="button"
            onClick={() => handleSelect(option.value)}
            className="flex items-center gap-2 w-full rounded-md px-2 py-1.5 text-left text-sm hover:bg-accent transition-colors"
          >
            <div className="flex-1 min-w-0">
              <div className="font-medium text-foreground text-sm">{option.label}</div>
              {option.description && (
                <div className="text-xs text-muted-foreground truncate">{option.description}</div>
              )}
            </div>
            {currentValue === option.value && (
              <Check className="size-4 text-primary shrink-0" aria-hidden="true" />
            )}
          </button>
        ))}
      </PopoverContent>
    </Popover>
  );
}
