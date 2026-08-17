'use client';

/**
 * The composer's ONE selection picker: which model answers, at which
 * reasoning effort — a single trigger ("<model> <effort> ▾") over a single
 * menu.
 *
 * Deliberately nothing else. The chat page offers MODEL SELECTION ONLY (the
 * Chat·Task·Automation boundary model): no agent rows, no skill or connector
 * equipment, no sandbox harnesses — those live on tasks and automations. The
 * menu is two SECTION rows, each opening a submenu whose list is searchable
 * and scrolls after four rows, so a hundred-model catalog never grows the
 * menu past the viewport.
 */

import { Button } from '@tale/ui/button';
import {
  DropdownMenu,
  type DropdownMenuGroup,
  type DropdownMenuItem,
} from '@tale/ui/dropdown-menu';
import { ChevronDown, Cpu, Gauge } from 'lucide-react';
import { useMemo, useState, type ComponentType } from 'react';

import { EFFORT_LEVELS, type ReasoningEffort } from '@/lib/chat/effort';
import { useT } from '@/lib/i18n/client';

import type { ComposerModelOption, ComposerSelection } from '../types';
import { autoAvailable } from './composer-model-picker';
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

interface ComposerSelectionPickerProps {
  /** The direct-served models the chat lane can call. */
  models: readonly ComposerModelOption[];
  selection: ComposerSelection;
  onSelectionChange: (next: ComposerSelection) => void;
  disabled?: boolean;
}

export function ComposerSelectionPicker({
  models,
  selection,
  onSelectionChange,
  disabled,
}: ComposerSelectionPickerProps) {
  const { t } = useT('chat');
  // Controlled so a single pick inside a section submenu can close the whole
  // menu the way a plain menu item would.
  const [open, setOpen] = useState(false);
  const closeMenu = () => setOpen(false);

  const autoSelected = selection.modelSelection === 'auto';
  const selectedModel =
    models.find(
      (model) =>
        model.id === selection.modelId &&
        (selection.providerSlug === undefined ||
          model.providerSlug === selection.providerSlug),
    ) ?? models.find((model) => model.id === selection.modelId);

  const effort = selection.reasoningEffort;
  const effortApplies = selectedModel?.reasoning !== undefined;
  /** The model's endpoint refuses tools+effort together — no levels are
   * offered, the hint says why, and a sticky pick reads as Default (the
   * resolver sends the catalog's off value regardless). */
  const effortLocked = selectedModel?.reasoning?.toolsRequireOff === true;

  /** Model rows — provider-qualified so the same id under two providers is
   * distinguishable, and searchable by either. Auto leads the list when the
   * catalog offers a real choice; picking it clears the pinned model AND the
   * effort (the pick that paired with the old model must not silently steer
   * whatever Auto resolves). Picking a model drops the Auto mode likewise —
   * the two spellings are mutually exclusive all the way to the wire. */
  const modelChoices = useMemo<PickerSearchOption[]>(() => {
    const rows: PickerSearchOption[] = models.map((model) => ({
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
        model.id === selection.modelId &&
        (selection.providerSlug === undefined ||
          model.providerSlug === selection.providerSlug),
      onSelect: () => {
        const { modelSelection: _auto, ...rest } = selection;
        onSelectionChange({
          ...rest,
          modelId: model.id,
          providerSlug: model.providerSlug,
        });
      },
    }));
    if (!autoAvailable(models)) return rows;
    return [
      {
        key: 'auto',
        search: `${t('modelSelector.auto')} auto`,
        // The description rides the row visually but stays out of the
        // accessible name (ariaLabel below keeps announcements short).
        label: (
          <span className="flex min-w-0 flex-col">
            <span className="truncate">{t('modelSelector.auto')}</span>
            <span className="text-muted-foreground/70 text-xs leading-snug text-wrap">
              {t('modelSelector.autoDescription')}
            </span>
          </span>
        ),
        ariaLabel: t('modelSelector.auto'),
        selected: autoSelected,
        onSelect: () => onSelectionChange({ modelSelection: 'auto' }),
      },
      ...rows,
    ];
  }, [models, selection, autoSelected, onSelectionChange, t]);

  const items = useMemo<DropdownMenuGroup[]>(() => {
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
        section(
          t('picker.sectionModel'),
          Cpu,
          autoSelected ? t('modelSelector.auto') : selectedModel?.label,
          {
            type: 'custom',
            content: (
              <PickerSearchList
                options={modelChoices}
                emptyHint={t('modelSelector.noModelsAvailable')}
                onPicked={closeMenu}
              />
            ),
          },
        ),
      ],
    ];

    if (effortApplies) {
      const levels: ReadonlyArray<ReasoningEffort | undefined> = effortLocked
        ? [undefined]
        : [undefined, ...EFFORT_LEVELS];
      groups.push([
        section(
          t('effort.label'),
          Gauge,
          effortLocked || effort === undefined
            ? t('effort.default')
            : t(LEVEL_LABEL_KEY[effort]),
          {
            type: 'custom',
            content: (
              <div className="flex min-w-0 flex-col">
                <p className="text-muted-foreground max-w-56 px-2 pt-1 pb-1.5 text-xs leading-snug">
                  {t(
                    effortLocked
                      ? 'effort.toolsLockedHint'
                      : 'effort.description',
                  )}
                </p>
                <PickerSearchList
                  options={levels.map((level) => ({
                    key: level ?? 'default',
                    search:
                      level === undefined
                        ? t('effort.default')
                        : t(LEVEL_LABEL_KEY[level]),
                    label:
                      level === undefined
                        ? t('effort.default')
                        : t(LEVEL_LABEL_KEY[level]),
                    selected: effortLocked
                      ? level === undefined
                      : effort === level,
                    onSelect: () =>
                      onSelectionChange({
                        ...selection,
                        reasoningEffort: level,
                      }),
                  }))}
                  emptyHint={t('effort.default')}
                  onPicked={closeMenu}
                />
                {!effortLocked && (
                  <p className="text-muted-foreground max-w-56 px-2 pt-1.5 pb-1 text-xs leading-snug">
                    {t('effort.maxHint')}
                  </p>
                )}
              </div>
            ),
          },
        ),
      ]);
    }

    return groups;
  }, [
    modelChoices,
    selection,
    onSelectionChange,
    selectedModel,
    autoSelected,
    effort,
    effortApplies,
    effortLocked,
    t,
  ]);

  // The trigger reads like Claude's: the model (or Auto), with the effort as
  // a muted suffix when one is picked.
  const triggerLabel = autoSelected
    ? t('modelSelector.auto')
    : (selectedModel?.label ??
      (models.length > 0
        ? t('modelSelector.label')
        : t('modelSelector.noModelsAvailable')));
  const triggerSuffix =
    effortApplies && !effortLocked && effort !== undefined
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
          className="max-w-64 min-w-0 gap-1"
        >
          <span className="min-w-0 truncate">{triggerLabel}</span>
          {triggerSuffix !== undefined && (
            <span className="text-muted-foreground shrink-0">
              {` ${triggerSuffix}`}
            </span>
          )}
          <ChevronDown aria-hidden className="size-3.5 shrink-0" />
        </Button>
      }
      items={items}
    />
  );
}
