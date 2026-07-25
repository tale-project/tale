'use client';

/**
 * The composer's agent picker: WHICH agent answers the turn.
 *
 * Two kinds, and the kind alone decides where the turn runs — so there is no
 * separate sandbox switch. The PLATFORM agent ("Assistant") runs a model
 * directly, and its model is chosen in the picker beside this one. A
 * THIRD-PARTY agent is an external harness (Claude Code, OpenClaw, …) that
 * always runs in a sandbox and brings its own model, so no model picker shows
 * for it.
 */

import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { AlertTriangle, Bot, ChevronDown, Sparkles } from 'lucide-react';
import { useMemo } from 'react';

import { useT } from '@/lib/i18n/client';

import type { ComposerExternalAgentOption, ComposerSelection } from '../types';

interface ComposerAgentPickerProps {
  /** The third-party agents (sandbox harnesses) on offer. */
  externalAgents: readonly ComposerExternalAgentOption[];
  selection: ComposerSelection;
  onSelectionChange: (next: ComposerSelection) => void;
  disabled?: boolean;
  /** Harness slugs the circuit breaker flags as recently failing — the picker
   * marks them so the user knows before spending a turn on one. */
  degradedHarnesses?: ReadonlySet<string>;
}

export function ComposerAgentPicker({
  externalAgents,
  selection,
  onSelectionChange,
  disabled,
  degradedHarnesses,
}: ComposerAgentPickerProps) {
  const { t } = useT('chat');

  const selectedAgent = externalAgents.find(
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

    if (externalAgents.length > 0) {
      groups.push([
        { type: 'label', content: t('agentSelector.sectionThirdParty') },
        ...externalAgents.map((agent) => {
          const degraded = degradedHarnesses?.has(agent.harness) === true;
          return {
            type: 'item' as const,
            // A degraded harness keeps its name but gains a "recently failing"
            // suffix + warning icon, so the choice is informed, not blocked.
            label: degraded
              ? `${agent.label} · ${t('agentSelector.degraded')}`
              : agent.label,
            icon: degraded ? AlertTriangle : Bot,
            selected:
              selection.agentKind === 'external' &&
              agent.harness === selection.harness,
            // The platform model stays in the selection — a harness turn never
            // reads it, and keeping it means returning to the platform agent
            // returns to the model the user already had.
            onClick: () =>
              onSelectionChange({
                ...selection,
                agentKind: 'external',
                harness: agent.harness,
              }),
          };
        }),
      ]);
    }

    return groups;
  }, [externalAgents, selection, onSelectionChange, degradedHarnesses, t]);

  const triggerLabel =
    selection.agentKind === 'external'
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
