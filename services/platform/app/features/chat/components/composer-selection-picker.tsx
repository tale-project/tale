'use client';

/**
 * The composer's ONE selection picker: which agent answers, on which model,
 * at which reasoning effort — a single trigger ("<model> <effort> ▾") over a
 * single menu, the way Claude's model picker reads.
 *
 * Menu shape:
 *   · the platform models, grouped by provider — picking one IS picking the
 *     platform "Chat" agent;
 *   · the sandboxed third-party agents;
 *   · while an external agent is active, its direct-served model group;
 *   · while a reasoning-capable platform model is active, an "Effort"
 *     submenu (Default + the five levels) with a plain-language description
 *     and a cost warning on Max.
 *
 * A sandbox thread pins its agent for life (`lockAgent`): the pinned agent's
 * entries stay live, everything that would switch away is disabled.
 */

import { Button } from '@tale/ui/button';
import {
  DropdownMenu,
  type DropdownMenuGroup,
  type DropdownMenuItem,
} from '@tale/ui/dropdown-menu';
import { AlertTriangle, Bot, ChevronDown, Info, Sparkles } from 'lucide-react';
import { useMemo, type ComponentType } from 'react';

import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { EFFORT_LEVELS, type ReasoningEffort } from '@/lib/chat/effort';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type {
  ComposerExternalAgentOption,
  ComposerModelOption,
  ComposerSelection,
  ComposerSkillOption,
} from '../types';

/** Explicit key map so the i18n usage check sees every catalog key. */
const LEVEL_LABEL_KEY: Record<ReasoningEffort, string> = {
  low: 'effort.low',
  medium: 'effort.medium',
  high: 'effort.high',
  extra: 'effort.extra',
  max: 'effort.max',
};

/**
 * A dropdown-item icon for a harness's shipped icon: the inline data URL when
 * one ships, the generic agent glyph otherwise. Decorative — the label names
 * the agent — so the image carries an empty alt.
 */
function harnessIcon(
  iconUrl: string | undefined,
): ComponentType<{ className?: string }> {
  if (iconUrl === undefined) return Bot;
  return function HarnessIcon({ className }: { className?: string }) {
    return <img src={iconUrl} alt="" className={cn('rounded-sm', className)} />;
  };
}

interface ComposerSelectionPickerProps {
  /** Direct-served models for the platform agent. */
  platformModels: readonly ComposerModelOption[];
  /** Direct-served models an external agent may run on. */
  externalModels: readonly ComposerModelOption[];
  /** The selection with the external lane's model fallback resolved — what
   * the external model group marks as active. */
  externalSelection: ComposerSelection;
  externalAgents: readonly ComposerExternalAgentOption[];
  /** Skills and connectors the conversation can equip — for EVERY agent
   * kind: the platform lane injects equipped skills into its context, the
   * sandbox lane stages them into its session. */
  skills: readonly ComposerSkillOption[];
  connectors: readonly ComposerSkillOption[];
  selection: ComposerSelection;
  onSelectionChange: (next: ComposerSelection) => void;
  disabled?: boolean;
  /** The thread pins its external agent — switching away is disabled. */
  lockAgent?: boolean;
  /** Harness slugs the circuit breaker flags as recently failing. */
  degradedHarnesses?: ReadonlySet<string>;
}

export function ComposerSelectionPicker({
  platformModels,
  externalModels,
  externalSelection,
  externalAgents,
  skills,
  connectors,
  selection,
  onSelectionChange,
  disabled,
  lockAgent = false,
  degradedHarnesses,
}: ComposerSelectionPickerProps) {
  const { t } = useT('chat');

  const isExternal = selection.agentKind === 'external';
  const selectedAgent = externalAgents.find(
    (agent) => agent.harness === selection.harness,
  );
  const selectedModel = isExternal
    ? externalModels.find(
        (model) =>
          model.id === externalSelection.modelId &&
          (externalSelection.providerSlug === undefined ||
            model.providerSlug === externalSelection.providerSlug),
      )
    : (platformModels.find(
        (model) =>
          model.id === selection.modelId &&
          (selection.providerSlug === undefined ||
            model.providerSlug === selection.providerSlug),
      ) ?? platformModels.find((model) => model.id === selection.modelId));

  const effort = selection.reasoningEffort;
  const effortApplies = !isExternal && selectedModel?.reasoning !== undefined;

  const items = useMemo<DropdownMenuGroup[]>(() => {
    const groups: DropdownMenuGroup[] = [];

    if (isExternal) {
      // The way back: ONE "Chat" row instead of repeating the platform
      // model list — the external lane's own model group is below, and two
      // lists of the same models would read as duplicates.
      groups.push([
        {
          type: 'item',
          label: t('agentSelector.defaultAgent'),
          icon: Sparkles,
          disabled: lockAgent,
          onClick: () =>
            onSelectionChange({
              ...selection,
              agentKind: 'platform',
              harness: undefined,
            }),
        },
      ]);
    } else {
      // Platform models, grouped by provider. Picking one is picking the
      // platform agent — one gesture, never two.
      const providers = [...new Set(platformModels.map((m) => m.providerSlug))];
      for (const provider of providers) {
        const group: DropdownMenuGroup = [{ type: 'label', content: provider }];
        for (const model of platformModels) {
          if (model.providerSlug !== provider) continue;
          group.push({
            type: 'item',
            label: model.label,
            selected:
              model.id === selection.modelId &&
              (selection.providerSlug === undefined ||
                model.providerSlug === selection.providerSlug),
            disabled: lockAgent,
            onClick: () =>
              onSelectionChange({
                ...selection,
                agentKind: 'platform',
                harness: undefined,
                modelId: model.id,
                providerSlug: model.providerSlug,
              }),
          });
        }
        groups.push(group);
      }
    }

    // The sandboxed agents.
    if (externalAgents.length > 0) {
      groups.push([
        { type: 'label', content: t('agentSelector.sectionThirdParty') },
        ...externalAgents.map((agent): DropdownMenuItem => {
          const degraded = degradedHarnesses?.has(agent.harness) === true;
          const pinned = agent.harness === selection.harness;
          return {
            type: 'item',
            label: degraded
              ? `${agent.label} · ${t('agentSelector.degraded')}`
              : agent.label,
            icon: degraded ? AlertTriangle : harnessIcon(agent.iconUrl),
            selected: isExternal && pinned,
            disabled: lockAgent && !pinned,
            // The platform model stays in the selection — a harness turn
            // never reads it, and keeping it means returning to the platform
            // agent returns to the model the user already had.
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

    // The external agent's model, on its own direct-served list.
    if (isExternal && externalModels.length > 0) {
      groups.push([
        { type: 'label', content: t('modelSelector.label') },
        ...externalModels.map(
          (model): DropdownMenuItem => ({
            type: 'item',
            label: model.label,
            selected:
              model.id === externalSelection.modelId &&
              (externalSelection.providerSlug === undefined ||
                model.providerSlug === externalSelection.providerSlug),
            onClick: () =>
              onSelectionChange({
                ...selection,
                modelId: model.id,
                providerSlug: model.providerSlug,
              }),
          }),
        ),
      ]);
    }

    // The effort submenu, Claude-style: current value trails the row.
    if (effortApplies) {
      const pick = (level: ReasoningEffort | undefined): DropdownMenuItem => ({
        type: 'item',
        label:
          level === undefined ? t('effort.default') : t(LEVEL_LABEL_KEY[level]),
        selected: effort === level,
        ...(level === 'max'
          ? {
              trailing: (
                <Tooltip content={t('effort.maxHint')} side="right">
                  <Info
                    aria-label={t('effort.maxHint')}
                    className="text-muted-foreground size-3.5"
                  />
                </Tooltip>
              ),
            }
          : {}),
        onClick: () =>
          onSelectionChange({ ...selection, reasoningEffort: level }),
      });
      groups.push([
        {
          type: 'sub',
          label: t('effort.label'),
          trailing:
            effort === undefined
              ? t('effort.default')
              : t(LEVEL_LABEL_KEY[effort]),
          contentClassName: 'max-w-64',
          items: [
            [
              {
                type: 'label',
                content: (
                  <span className="text-muted-foreground block max-w-56 text-xs leading-snug font-normal normal-case">
                    {t('effort.description')}
                  </span>
                ),
              },
              pick(undefined),
              ...EFFORT_LEVELS.map((level) => pick(level)),
            ],
          ],
        },
      ]);
    }

    // What the conversation equips its agent with — skills and connectors,
    // as checkbox submenus that keep the menu open while assembling.
    const equipSub = (
      label: string,
      emptyHint: string,
      options: readonly ComposerSkillOption[],
      picked: readonly string[],
      write: (slugs: readonly string[]) => void,
    ): DropdownMenuItem => ({
      type: 'sub',
      label,
      ...(picked.length > 0 ? { trailing: String(picked.length) } : {}),
      contentClassName: 'max-w-72',
      items: [
        options.length === 0
          ? [
              {
                type: 'label',
                content: (
                  <span className="text-muted-foreground block max-w-60 text-xs leading-snug font-normal normal-case">
                    {emptyHint}
                  </span>
                ),
              },
            ]
          : options.map(
              (option): DropdownMenuItem => ({
                type: 'checkbox',
                label: option.label,
                checked: picked.includes(option.slug),
                onCheckedChange: (next) =>
                  write(
                    next
                      ? [...picked, option.slug]
                      : picked.filter((slug) => slug !== option.slug),
                  ),
              }),
            ),
      ],
    });
    groups.push([
      equipSub(
        t('skills.sectionSkills'),
        t('skills.emptySkills'),
        skills,
        selection.skills,
        (slugs) => onSelectionChange({ ...selection, skills: slugs }),
      ),
      equipSub(
        t('skills.sectionConnectors'),
        t('skills.emptyConnectors'),
        connectors,
        selection.connectors,
        (slugs) => onSelectionChange({ ...selection, connectors: slugs }),
      ),
    ]);

    return groups;
  }, [
    platformModels,
    skills,
    connectors,
    externalAgents,
    externalModels,
    externalSelection,
    isExternal,
    selection,
    onSelectionChange,
    lockAgent,
    degradedHarnesses,
    effort,
    effortApplies,
    t,
  ]);

  // The trigger reads like Claude's: the primary identity, with a muted
  // suffix — the effort on a platform model, the resolved model (or its
  // absence) on an external agent.
  const triggerLabel = isExternal
    ? (selectedAgent?.label ?? t('agentSelector.defaultAgent'))
    : (selectedModel?.label ??
      (platformModels.length > 0
        ? t('modelSelector.label')
        : t('modelSelector.noModelsAvailable')));
  const triggerSuffix = isExternal
    ? (selectedModel?.label ??
      (externalModels.length === 0
        ? t('modelSelector.noModelsAvailable')
        : undefined))
    : effortApplies && effort !== undefined
      ? t(LEVEL_LABEL_KEY[effort])
      : undefined;

  return (
    <DropdownMenu
      align="start"
      disabled={disabled || items.length === 0}
      trigger={
        <Button
          variant="ghost"
          size="sm"
          aria-label={t('picker.ariaLabel')}
          aria-haspopup="menu"
          className="max-w-64 min-w-0"
        >
          <span className="truncate">{triggerLabel}</span>
          {triggerSuffix !== undefined && (
            <span className="text-muted-foreground min-w-0 truncate">
              {triggerSuffix}
            </span>
          )}
          <ChevronDown aria-hidden className="size-3.5 shrink-0" />
        </Button>
      }
      items={items}
    />
  );
}
