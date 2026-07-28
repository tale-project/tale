'use client';

/**
 * The reasoning-effort control: one uniform five-step scale
 * (low → medium → high → extra → max) plus a Default resting state that
 * sends no reasoning parameter at all. Rendered only when the selected
 * model has a controllable reasoning depth — a permanently disabled knob on
 * a model that cannot think harder teaches nothing. The pick is a
 * per-conversation setting (persisted on the thread by the surface), not a
 * message property.
 */

import { Button } from '@tale/ui/button';
import { DropdownMenu, type DropdownMenuGroup } from '@tale/ui/dropdown-menu';
import { Brain, ChevronDown } from 'lucide-react';
import { useMemo } from 'react';

import { EFFORT_LEVELS, type ReasoningEffort } from '@/lib/chat/effort';
import { useT } from '@/lib/i18n/client';

import type { ComposerModelOption, ComposerSelection } from '../types';

/** Explicit key map so the i18n usage check sees every catalog key. */
const LEVEL_LABEL_KEY: Record<ReasoningEffort, string> = {
  low: 'effort.low',
  medium: 'effort.medium',
  high: 'effort.high',
  extra: 'effort.extra',
  max: 'effort.max',
};

export function ComposerEffortPicker({
  model,
  selection,
  onSelectionChange,
  disabled,
}: {
  /** The selected model's listing row, when one is selected. */
  model: ComposerModelOption | undefined;
  selection: ComposerSelection;
  onSelectionChange: (next: ComposerSelection) => void;
  disabled?: boolean;
}) {
  const { t } = useT('chat');
  const current = selection.reasoningEffort;

  const items = useMemo<DropdownMenuGroup[]>(() => {
    const pick = (effort: ReasoningEffort | undefined) => ({
      type: 'item' as const,
      label:
        effort === undefined ? t('effort.default') : t(LEVEL_LABEL_KEY[effort]),
      selected: current === effort,
      onClick: () =>
        onSelectionChange({
          ...selection,
          ...(effort !== undefined ? { reasoningEffort: effort } : {}),
          ...(effort === undefined ? { reasoningEffort: undefined } : {}),
        }),
    });
    return [
      [
        { type: 'label' as const, content: t('effort.label') },
        pick(undefined),
        ...EFFORT_LEVELS.map((level) => pick(level)),
      ],
    ];
  }, [current, onSelectionChange, selection, t]);

  // After the hooks: a model without a reasoning knob renders no control.
  if (model?.reasoning === undefined) return null;

  return (
    <DropdownMenu
      align="start"
      disabled={disabled}
      trigger={
        <Button
          variant="ghost"
          size="sm"
          aria-label={t('effort.label')}
          aria-haspopup="menu"
          className="min-w-0"
        >
          <Brain aria-hidden className="size-3.5 shrink-0" />
          <span className="truncate">
            {current === undefined
              ? t('effort.default')
              : t(LEVEL_LABEL_KEY[current])}
          </span>
          <ChevronDown aria-hidden className="size-3.5 shrink-0" />
        </Button>
      }
      items={items}
    />
  );
}
