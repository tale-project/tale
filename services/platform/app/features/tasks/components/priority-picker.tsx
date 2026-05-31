'use client';

import { Button } from '@tale/ui/button';

import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@/app/components/ui/forms/searchable-select';
import { Tooltip } from '@/app/components/ui/overlays/tooltip';
import { useT } from '@/lib/i18n/client';

import { TASK_PRIORITY_ORDER, type TaskPriority } from '../lib/display';
import { TaskPriorityIcon } from './task-priority-icon';

const NO_PRIORITY = 'none';

/** Dimmed bar glyph for the "No priority" state — the default for a new task
 *  and a selectable option in the picker. */
function NoPriorityGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      className="text-muted-foreground size-3.5"
      aria-hidden="true"
    >
      <rect
        x="1"
        y="9"
        width="3.5"
        height="6"
        rx="1"
        fill="currentColor"
        className="opacity-30"
      />
      <rect
        x="6.25"
        y="5"
        width="3.5"
        height="10"
        rx="1"
        fill="currentColor"
        className="opacity-30"
      />
      <rect
        x="11.5"
        y="1"
        width="3.5"
        height="14"
        rx="1"
        fill="currentColor"
        className="opacity-30"
      />
    </svg>
  );
}

/**
 * Inline priority editor reusing the shared {@link SearchableSelect}. The
 * priority glyph is the icon-button trigger; selecting an option (or "No
 * priority") updates the task. Read-only callers pass `disabled` to render just
 * the glyph.
 */
export function PriorityPicker({
  priority,
  onChange,
  align = 'start',
  disabled = false,
}: {
  priority: TaskPriority | null | undefined;
  onChange: (priority: TaskPriority | null) => void;
  align?: 'start' | 'center' | 'end';
  disabled?: boolean;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');

  const glyph = priority ? (
    <TaskPriorityIcon priority={priority} />
  ) : (
    <NoPriorityGlyph />
  );
  const label = priority ? t(`priority.${priority}`) : t('priority.none');

  if (disabled) {
    return (
      <Tooltip content={label}>
        <span className="inline-flex">{glyph}</span>
      </Tooltip>
    );
  }

  // "No priority" leads so a set priority can always be cleared back to it.
  const options: SearchableSelectOption[] = [
    { value: NO_PRIORITY, label: t('priority.none') },
    ...TASK_PRIORITY_ORDER.map((p) => ({
      value: p,
      label: t(`priority.${p}`),
    })),
  ];

  const trigger = (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={t('fields.priority')}
      className="h-auto w-auto rounded-md p-1"
      // See AssigneePicker: keep the press/click off the draggable parent so it
      // doesn't start a drag or open the task.
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {glyph}
    </Button>
  );

  return (
    <Tooltip content={label}>
      {/* Stop pointer/click here: React replays portal events through the React
          tree, so a click on a portaled option would otherwise bubble to the
          draggable card/row's onClick and open the task. This span is the
          common React-tree ancestor of the trigger and the portaled list — a
          propagation boundary, not a control. */}
      {/* oxlint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- propagation boundary, not an interactive control */}
      <span
        className="inline-flex"
        onPointerDown={(e) => e.stopPropagation()}
        onClick={(e) => e.stopPropagation()}
      >
        <SearchableSelect
          value={priority ?? NO_PRIORITY}
          onValueChange={(val) => {
            if (val === NO_PRIORITY) {
              onChange(null);
              return;
            }
            const match = TASK_PRIORITY_ORDER.find((p) => p === val);
            if (match) onChange(match);
          }}
          options={options}
          align={align}
          trigger={trigger}
          aria-label={t('fields.priority')}
          searchPlaceholder={t('fields.priority')}
          emptyText={tCommon('search.noResults')}
          optionAction={(opt) => {
            const match = TASK_PRIORITY_ORDER.find((p) => p === opt.value);
            return match ? (
              <TaskPriorityIcon priority={match} />
            ) : (
              <NoPriorityGlyph />
            );
          }}
        />
      </span>
    </Tooltip>
  );
}
