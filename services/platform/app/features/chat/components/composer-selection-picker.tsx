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

  const selectedModel =
    models.find(
      (model) =>
        model.id === selection.modelId &&
        (selection.providerSlug === undefined ||
          model.providerSlug === selection.providerSlug),
    ) ?? models.find((model) => model.id === selection.modelId);

  const effort = selection.reasoningEffort;
  const effortApplies = selectedModel?.reasoning !== undefined;

  /** Model rows — provider-qualified so the same id under two providers is
   * distinguishable, and searchable by either. */
  const modelChoices = useMemo<PickerSearchOption[]>(
    () =>
      models.map((model) => ({
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
        onSelect: () =>
          onSelectionChange({
            ...selection,
            modelId: model.id,
            providerSlug: model.providerSlug,
          }),
      })),
    [models, selection, onSelectionChange],
  );

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

    return groups;
  }, [
    modelChoices,
    selection,
    onSelectionChange,
    selectedModel,
    effort,
    effortApplies,
    t,
  ]);

  // The trigger reads like Claude's: the model, with the effort as a muted
  // suffix when one is picked.
  const triggerLabel =
    selectedModel?.label ??
    (models.length > 0
      ? t('modelSelector.label')
      : t('modelSelector.noModelsAvailable'));
  const triggerSuffix =
    effortApplies && effort !== undefined
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
