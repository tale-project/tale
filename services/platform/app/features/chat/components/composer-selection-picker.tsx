'use client';

/**
 * The composer's ONE selection picker: which agent answers, on which model,
 * at which reasoning effort, equipped with which skills — a single trigger
 * ("<model> <effort> ▾") over a single menu.
 *
 * The menu is a short list of SECTION rows, each opening a submenu whose list
 * is searchable and scrolls after four rows, so a hundred-model catalog never
 * grows the menu past the viewport:
 *
 *   Model      → the direct-served models (picking one is picking the
 *                platform agent — one gesture, never two); inside the
 *                external lane it lists what that harness may run on
 *   Agents     → the platform assistant plus every sandboxed harness
 *   Effort     → Default + the five levels, for a reasoning-capable model
 *   Skills     → org skills the conversation equips
 *   Connectors → enabled connectors the conversation equips
 *
 * A sandbox thread pins its agent for life (`lockAgent`): switching away is
 * disabled, everything else stays live.
 */

import { Button } from '@tale/ui/button';
import {
  DropdownMenu,
  type DropdownMenuGroup,
  type DropdownMenuItem,
} from '@tale/ui/dropdown-menu';
import {
  AlertTriangle,
  Bot,
  ChevronDown,
  Cpu,
  Gauge,
  Plug,
  Sparkles,
  Wrench,
} from 'lucide-react';
import { useMemo, useState, type ComponentType } from 'react';

import { EFFORT_LEVELS, type ReasoningEffort } from '@/lib/chat/effort';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import type {
  ComposerExternalAgentOption,
  ComposerModelOption,
  ComposerSelection,
  ComposerSkillOption,
} from '../types';
import {
  PickerSearchList,
  type PickerSearchOption,
} from './picker-search-list';

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
   * the external model list marks as active. */
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
  // Controlled so a single pick inside a section submenu can close the whole
  // menu the way a plain menu item would.
  const [open, setOpen] = useState(false);
  const closeMenu = () => setOpen(false);

  const isExternal = selection.agentKind === 'external';
  const selectedAgent = externalAgents.find(
    (agent) => agent.harness === selection.harness,
  );
  const modelOptions = isExternal ? externalModels : platformModels;
  const activeModelSelection = isExternal ? externalSelection : selection;
  const selectedModel =
    modelOptions.find(
      (model) =>
        model.id === activeModelSelection.modelId &&
        (activeModelSelection.providerSlug === undefined ||
          model.providerSlug === activeModelSelection.providerSlug),
    ) ??
    modelOptions.find((model) => model.id === activeModelSelection.modelId);

  const effort = selection.reasoningEffort;
  const effortApplies = !isExternal && selectedModel?.reasoning !== undefined;

  /** Model rows — provider-qualified so the same id under two providers is
   * distinguishable, and searchable by either. */
  const modelChoices = useMemo<PickerSearchOption[]>(
    () =>
      modelOptions.map((model) => ({
        key: `${model.providerSlug}:${model.id}`,
        search: `${model.label} ${model.providerSlug}`,
        label: (
          <span className="flex min-w-0 items-center gap-2">
            <span className="truncate">{model.label}</span>
            <span className="text-muted-foreground/70 shrink-0 text-xs">
              {model.providerSlug}
            </span>
          </span>
        ),
        selected:
          model.id === activeModelSelection.modelId &&
          (activeModelSelection.providerSlug === undefined ||
            model.providerSlug === activeModelSelection.providerSlug),
        onSelect: () =>
          onSelectionChange({
            ...selection,
            // A model pick from the platform list also picks the platform
            // agent; inside the external lane it only re-points the harness.
            ...(isExternal
              ? {}
              : { agentKind: 'platform' as const, harness: undefined }),
            modelId: model.id,
            providerSlug: model.providerSlug,
          }),
      })),
    [
      modelOptions,
      activeModelSelection,
      isExternal,
      selection,
      onSelectionChange,
    ],
  );

  /** Agent rows: the platform assistant plus every sandboxed harness. */
  const agentChoices = useMemo<PickerSearchOption[]>(() => {
    const rows: PickerSearchOption[] = [
      {
        key: 'platform',
        search: t('agentSelector.defaultAgent'),
        label: t('agentSelector.defaultAgent'),
        selected: !isExternal,
        disabled: lockAgent,
        onSelect: () =>
          onSelectionChange({
            ...selection,
            agentKind: 'platform',
            harness: undefined,
          }),
      },
    ];
    for (const agent of externalAgents) {
      const degraded = degradedHarnesses?.has(agent.harness) === true;
      const pinned = agent.harness === selection.harness;
      const Icon = degraded ? AlertTriangle : harnessIcon(agent.iconUrl);
      rows.push({
        key: agent.harness,
        search: agent.label,
        label: (
          <span className="flex min-w-0 items-center gap-2">
            <Icon className="text-muted-foreground size-3.5" />
            <span className="truncate">{agent.label}</span>
            {degraded && (
              <span className="text-muted-foreground/70 shrink-0 text-xs">
                {t('agentSelector.degraded')}
              </span>
            )}
          </span>
        ),
        selected: isExternal && pinned,
        disabled: lockAgent && !pinned,
        // The platform model stays in the selection — a harness turn never
        // reads it, and keeping it means returning to the platform agent
        // returns to the model the user already had.
        onSelect: () =>
          onSelectionChange({
            ...selection,
            agentKind: 'external',
            harness: agent.harness,
          }),
      });
    }
    return rows;
  }, [
    externalAgents,
    degradedHarnesses,
    isExternal,
    lockAgent,
    selection,
    onSelectionChange,
    t,
  ]);

  const items = useMemo<DropdownMenuGroup[]>(() => {
    const equipChoices = (
      options: readonly ComposerSkillOption[],
      picked: readonly string[],
      write: (slugs: readonly string[]) => void,
    ): PickerSearchOption[] =>
      options.map((option) => ({
        key: option.slug,
        search: option.label,
        label: option.label,
        selected: picked.includes(option.slug),
        onSelect: () =>
          write(
            picked.includes(option.slug)
              ? picked.filter((slug) => slug !== option.slug)
              : [...picked, option.slug],
          ),
      }));

    /** One section: a submenu row whose panel is a searchable list. */
    const section = (
      label: string,
      icon: ComponentType<{ className?: string }>,
      trailing: string | undefined,
      content: DropdownMenuItem,
    ): DropdownMenuItem => ({
      type: 'sub',
      label,
      icon,
      ...(trailing !== undefined ? { trailing } : {}),
      contentClassName: 'min-w-60',
      items: [[content]],
    });

    const groups: DropdownMenuGroup[] = [
      [
        section(t('picker.sectionModel'), Cpu, selectedModel?.label, {
          type: 'custom',
          content: (
            <PickerSearchList
              options={modelChoices}
              emptyHint={t('modelSelector.noModelsAvailable')}
              onPicked={closeMenu}
            />
          ),
        }),
        section(
          t('picker.sectionAgent'),
          Sparkles,
          isExternal
            ? (selectedAgent?.label ?? t('agentSelector.defaultAgent'))
            : t('agentSelector.defaultAgent'),
          {
            type: 'custom',
            content: (
              <PickerSearchList
                options={agentChoices}
                emptyHint={t('agentSelector.defaultAgent')}
                onPicked={closeMenu}
              />
            ),
          },
        ),
      ],
    ];

    if (effortApplies) {
      groups.push([
        section(
          t('effort.label'),
          Gauge,
          effort === undefined
            ? t('effort.default')
            : t(LEVEL_LABEL_KEY[effort]),
          {
            type: 'custom',
            content: (
              <div className="flex min-w-0 flex-col">
                <p className="text-muted-foreground max-w-56 px-2 pt-1 pb-1.5 text-xs leading-snug">
                  {t('effort.description')}
                </p>
                <PickerSearchList
                  options={[undefined, ...EFFORT_LEVELS].map((level) => ({
                    key: level ?? 'default',
                    search:
                      level === undefined
                        ? t('effort.default')
                        : t(LEVEL_LABEL_KEY[level]),
                    label:
                      level === undefined
                        ? t('effort.default')
                        : t(LEVEL_LABEL_KEY[level]),
                    selected: effort === level,
                    onSelect: () =>
                      onSelectionChange({
                        ...selection,
                        reasoningEffort: level,
                      }),
                  }))}
                  emptyHint={t('effort.default')}
                  onPicked={closeMenu}
                />
                <p className="text-muted-foreground max-w-56 px-2 pt-1.5 pb-1 text-xs leading-snug">
                  {t('effort.maxHint')}
                </p>
              </div>
            ),
          },
        ),
      ]);
    }

    groups.push([
      section(
        t('skills.sectionSkills'),
        Wrench,
        selection.skills.length > 0
          ? String(selection.skills.length)
          : undefined,
        {
          type: 'custom',
          content: (
            <PickerSearchList
              multiSelect
              options={equipChoices(skills, selection.skills, (slugs) =>
                onSelectionChange({ ...selection, skills: slugs }),
              )}
              emptyHint={t('skills.emptySkills')}
            />
          ),
        },
      ),
      section(
        t('skills.sectionConnectors'),
        Plug,
        selection.connectors.length > 0
          ? String(selection.connectors.length)
          : undefined,
        {
          type: 'custom',
          content: (
            <PickerSearchList
              multiSelect
              options={equipChoices(connectors, selection.connectors, (slugs) =>
                onSelectionChange({ ...selection, connectors: slugs }),
              )}
              emptyHint={t('skills.emptyConnectors')}
            />
          ),
        },
      ),
    ]);

    return groups;
  }, [
    modelChoices,
    agentChoices,
    skills,
    connectors,
    selection,
    onSelectionChange,
    selectedModel,
    selectedAgent,
    isExternal,
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
      open={open}
      onOpenChange={setOpen}
      disabled={disabled}
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
