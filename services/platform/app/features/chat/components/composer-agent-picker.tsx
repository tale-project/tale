'use client';

/**
 * The composer's agent control: who answers in a project chat — the
 * workspace's chat assistant, or one of the project's own agents.
 *
 * Shown only in a project chat whose project has agents of its own. An
 * agent answers with its instructions, its equipped skills and its model;
 * its runtime, connectors, tools and secrets stay on its tasks, which the
 * menu says under the list. The project's default for new chats carries a
 * **Default** mark.
 */

import { Badge } from '@tale/ui/badge';
import { Button } from '@tale/ui/button';
import { cn } from '@tale/ui/cn';
import { DropdownMenu } from '@tale/ui/dropdown-menu';
import { Bot, ChevronDown, Sparkles } from 'lucide-react';
import { useMemo, useState } from 'react';

import type { ChatAgentChoice } from '@/app/lib/backend/contract/projects';
import { useT } from '@/lib/i18n/client';

import {
  PickerSearchList,
  type PickerSearchOption,
} from './picker-search-list';

export function ComposerAgentPicker({
  agents,
  agentId,
  defaultAgentId,
  modelLabel,
  unservedModel,
  onChange,
  disabled,
}: {
  /** The project's own agents, oldest first. */
  agents: readonly ChatAgentChoice[];
  /** Who answers now; null is the assistant. */
  agentId: string | null;
  /** Who the project's new chats start with; null is the assistant. */
  defaultAgentId: string | null;
  /** The name a model id reads by in this person's model list, if any. */
  modelLabel: (agent: ChatAgentChoice) => string | undefined;
  /** The chosen agent's model cannot answer in chat for this person: the
   * person's own model answers, and the menu says so. */
  unservedModel?: boolean;
  onChange: (agentId: string | null) => void;
  disabled?: boolean;
}) {
  const { t } = useT('chat');
  const [open, setOpen] = useState(false);
  const agent =
    agentId === null ? undefined : agents.find((row) => row.id === agentId);
  const label = agent?.name ?? t('agentPicker.assistant');

  const options = useMemo<PickerSearchOption[]>(() => {
    const defaultMark = (
      <Badge variant="outline" className="shrink-0 px-1.5 py-0 text-[11px]">
        {t('agentPicker.default')}
      </Badge>
    );
    return [
      {
        key: '__assistant__',
        search: t('agentPicker.assistant'),
        ariaLabel: t('agentPicker.assistant'),
        label: (
          <span className="flex min-w-0 items-center gap-2">
            <Sparkles aria-hidden className="size-4 shrink-0" />
            <span className="flex min-w-0 flex-col">
              <span className="truncate">{t('agentPicker.assistant')}</span>
              <span className="text-muted-foreground text-xs leading-snug text-wrap">
                {t('agentPicker.assistantDescription')}
              </span>
            </span>
            {defaultAgentId === null && defaultMark}
          </span>
        ),
        selected: agentId === null,
        onSelect: () => onChange(null),
      },
      ...agents.map((row): PickerSearchOption => {
        const model = modelLabel(row) ?? row.model;
        return {
          key: row.id,
          search: `${row.name} ${model}`,
          ariaLabel:
            row.id === defaultAgentId
              ? `${row.name}, ${t('agentPicker.default')}`
              : row.name,
          fullLabel: `${row.name} · ${model}`,
          label: (
            <span className="flex min-w-0 items-center gap-2">
              <Bot aria-hidden className="size-4 shrink-0" />
              <span className="flex min-w-0 flex-col">
                <span className="truncate">{row.name}</span>
                <span className="text-muted-foreground truncate text-xs">
                  {model}
                </span>
              </span>
              {row.id === defaultAgentId && defaultMark}
            </span>
          ),
          selected: row.id === agentId,
          onSelect: () => onChange(row.id),
        };
      }),
    ];
  }, [agents, agentId, defaultAgentId, modelLabel, onChange, t]);

  return (
    <DropdownMenu
      align="start"
      open={open}
      onOpenChange={setOpen}
      disabled={disabled}
      // The whole name, which a narrow toolbar cuts.
      tooltip={t('agentPicker.tooltip', { name: label })}
      contentClassName="w-80 max-w-(--radix-dropdown-menu-content-available-width)"
      trigger={
        <Button
          variant="ghost"
          size="sm"
          aria-label={t('agentPicker.aria', { name: label })}
          aria-haspopup="menu"
          data-testid="composer-agent-picker"
          className="max-w-44 min-w-0 shrink-0 gap-1.5 px-2"
        >
          {agent !== undefined ? (
            <Bot aria-hidden className="size-4 shrink-0" />
          ) : (
            <Sparkles aria-hidden className="size-4 shrink-0" />
          )}
          {/* An agent stays named on a phone, shorter there; the assistant
              is its mark alone, leaving the room to the model's name. */}
          <span
            className={cn(
              'min-w-0 truncate',
              agent !== undefined
                ? 'max-w-20 @lg/composer-toolbar:max-w-none'
                : 'hidden @lg/composer-toolbar:inline',
            )}
          >
            {label}
          </span>
          {/* A narrow toolbar keeps the room for the names. */}
          <ChevronDown
            aria-hidden
            className="hidden size-3.5 shrink-0 @lg/composer-toolbar:block"
          />
        </Button>
      }
      items={[
        [
          {
            type: 'custom',
            content: (
              <PickerSearchList
                options={options}
                emptyHint={t('agentPicker.assistant')}
                onPicked={() => setOpen(false)}
                tall
              />
            ),
          },
        ],
        [
          {
            type: 'label',
            content: (
              <span className="text-muted-foreground flex max-w-72 flex-col gap-1 text-xs leading-snug font-normal text-wrap">
                {unservedModel === true && agent !== undefined && (
                  <span className="text-foreground">
                    {t('agentPicker.unservedModel', { name: agent.name })}
                  </span>
                )}
                <span>{t('agentPicker.hint')}</span>
              </span>
            ),
          },
        ],
      ]}
    />
  );
}
