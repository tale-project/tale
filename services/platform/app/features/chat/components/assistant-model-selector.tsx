'use client';

import * as PopoverPrimitive from '@radix-ui/react-popover';
import { Button } from '@tale/ui/button';
import { Bot, ChevronDown } from 'lucide-react';
import { useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import { useEffectiveAgent } from '../hooks/use-effective-agent';
import { AgentSelector } from './agent-selector';
import { ModelSelector } from './model-selector';

interface AssistantModelSelectorProps {
  organizationId: string;
  /** Project the chat belongs to, if any (restricts agents/models). */
  projectId?: string;
  /** Current thread, if one exists. */
  threadId?: string;
}

/**
 * The mobile-only combined agent + model control. The cramped mobile row can't
 * fit two pickers, so this collapses them behind one compact button: it shows
 * only the current assistant (the model — often a long id — lives in the panel,
 * not the toolbar), and opening it stacks the two real pickers so drilling into
 * either keeps everything (search, per-model details, footers, all states).
 * Desktop is unaffected — it renders the two pickers directly (see ChatInput).
 */
export function AssistantModelSelector({
  organizationId,
  projectId,
  threadId,
}: AssistantModelSelectorProps) {
  const { t } = useT('chat');
  const [open, setOpen] = useState(false);

  // Collapsed label: just the resolved assistant (kept short); the model is a
  // row in the panel, so it never widens the toolbar.
  const { agent } = useEffectiveAgent(organizationId);
  const agentLabel = agent?.displayName ?? t('agentSelector.defaultAgent');

  return (
    <PopoverPrimitive.Root open={open} onOpenChange={setOpen}>
      <PopoverPrimitive.Trigger asChild>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          className="max-w-[9rem] min-w-0 gap-1.5"
          aria-label={t('assistantModelSelector.label')}
        >
          <Bot className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate">{agentLabel}</span>
          <ChevronDown className="size-3 shrink-0" aria-hidden="true" />
        </Button>
      </PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content
          align="start"
          side="top"
          sideOffset={8}
          // Don't pull focus onto the first picker trigger on open — that
          // focus reads as a hover to its Radix tooltip and flashes "Select
          // agent" over the panel.
          onOpenAutoFocus={(e) => e.preventDefault()}
          // The rows drill into the real pickers, whose lists portal to the
          // body; keep this panel open while the user works inside one of them.
          onInteractOutside={(e) => {
            const target = e.detail.originalEvent.target;
            if (
              target instanceof Element &&
              target.closest('[role="listbox"],[role="combobox"]')
            ) {
              e.preventDefault();
            }
          }}
          onFocusOutside={(e) => {
            const target = e.detail.originalEvent.target;
            if (
              target instanceof Element &&
              target.closest('[role="listbox"],[role="combobox"]')
            ) {
              e.preventDefault();
            }
          }}
          className={cn(
            'ring-border bg-popover text-popover-foreground dark:bg-muted data-[state=open]:animate-in data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0 z-50 w-fit min-w-[11rem] max-w-[calc(100vw-2rem)] rounded-lg p-1 shadow-md ring-1 outline-none',
          )}
        >
          {/* Two stacked pickers — their Bot / Cpu icons name each dimension,
              so no extra row labels are needed. `fullWidth` fills each row and
              right-aligns its chevron (icon + name stay left). */}
          <div
            role="group"
            aria-label={t('assistantModelSelector.label')}
            className="flex flex-col gap-0.5"
          >
            <AgentSelector
              organizationId={organizationId}
              projectId={projectId}
              threadId={threadId}
              fullWidth
            />
            <ModelSelector
              organizationId={organizationId}
              projectId={projectId}
              threadId={threadId}
              fullWidth
            />
          </div>
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
