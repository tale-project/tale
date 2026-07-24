'use client';

/**
 * The composer's agent picker: WHICH agent answers the turn.
 *
 * Two kinds, and the kind alone decides where the turn runs — so there is no
 * separate sandbox switch. The PLATFORM agent ("Assistant") runs a model
 * directly, and its model is chosen in the picker beside this one. A
 * THIRD-PARTY agent is an external coding harness (Claude Code, Codex) that
 * always runs in a sandbox and brings its own model, so no model picker shows
 * for it.
 */

import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { Bot, ChevronDown, Sparkles } from 'lucide-react';
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';

import type { ComposerSandboxAgentOption, ComposerSelection } from '../types';

interface ComposerAgentPickerProps {
  /** The third-party coding agents (sandbox harnesses) on offer. */
  codingAgents: readonly ComposerSandboxAgentOption[];
  selection: ComposerSelection;
  onSelectionChange: (next: ComposerSelection) => void;
  disabled?: boolean;
}

export function ComposerAgentPicker({
  codingAgents,
  selection,
  onSelectionChange,
  disabled,
}: ComposerAgentPickerProps) {
  const { t } = useT('chat');

  const selectedAgent = codingAgents.find(
    (agent) => agent.harness === selection.harness,
  );

  const items = useMemo<DropdownMenuGroup[]>(() => {
    const groups: DropdownMenuGroup[] = [
      [
        { type: 'label', content: t('agentSelector.sectionPlatform') },
        {
          type: 'item',
          label: t('agentSelector.defaultAgent'),
          icon: Sparkles,
          selected: selection.agentKind === 'platform',
          onClick: () =>
            onSelectionChange({
              ...selection,
              agentKind: 'platform',
              harness: undefined,
            }),
        },
      ],
    ];

    if (codingAgents.length > 0) {
      groups.push([
        { type: 'label', content: t('agentSelector.sectionThirdParty') },
        ...codingAgents.map((agent) => ({
          type: 'item' as const,
          label: agent.label,
          icon: Bot,
          selected:
            selection.agentKind === 'coding' &&
            agent.harness === selection.harness,
          // The platform model stays in the selection — a harness turn never
          // reads it, and keeping it means returning to the platform agent
          // returns to the model the user already had.
          onClick: () =>
            onSelectionChange({
              ...selection,
              agentKind: 'coding',
              harness: agent.harness,
            }),
        })),
      ]);
    }

    return groups;
  }, [codingAgents, selection, onSelectionChange, t]);

  const triggerLabel =
    selection.agentKind === 'coding'
      ? (selectedAgent?.label ?? t('agentSelector.defaultAgent'))
      : t('agentSelector.defaultAgent');

  return (
    <DropdownMenu
      align="start"
      disabled={disabled}
      trigger={
        <Button
          variant="ghost"
          size="sm"
          aria-label={t('agentSelector.label')}
          aria-haspopup="menu"
          className="max-w-56 min-w-0"
        >
          <span className="truncate">{triggerLabel}</span>
          <ChevronDown aria-hidden className="size-3.5 shrink-0" />
        </Button>
      }
      items={items}
    />
  );
}
