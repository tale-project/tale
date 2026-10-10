'use client';

import { Button } from '@tale/ui/button';
import {
  SearchableSelect,
  type SearchableSelectOption,
} from '@tale/ui/searchable-select';
import { Tooltip } from '@tale/ui/tooltip';
import { type ReactElement, useState } from 'react';

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
 *
 * The list mounts on the picker's first use and stays mounted from then on:
 * every card and row of a board carries one, and a closed picker's options
 * and select cost a 2,000-task board seconds. Until then the trigger
 * stands alone and says what the list's trigger would say while shut.
 */
export function PriorityPicker({
  priority,
  onChange,
  align = 'start',
  disabled = false,
  showLabel = false,
}: {
  priority: TaskPriority | null | undefined;
  onChange: (priority: TaskPriority | null) => void;
  align?: 'start' | 'center' | 'end';
  disabled?: boolean;
  /** Name the priority beside its glyph — for a property list, where there is
   *  room and a bare glyph made the reader hover to learn what it meant.
   *  Cards and rows keep the glyph alone. */
  showLabel?: boolean;
}) {
  const { t } = useT('tasks');
  const [engaged, setEngaged] = useState(false);
  // The list's open state lives here, not in the list: a picker disabled
  // and enabled again (a task archived and then restored) mounts its list
  // anew, and that list must come back shut, never open on its own.
  const [open, setOpen] = useState(false);
  if (disabled && open) setOpen(false);

  const glyph = priority ? (
    <TaskPriorityIcon priority={priority} />
  ) : (
    <NoPriorityGlyph />
  );
  const label = priority ? t(`priority.${priority}`) : t('priority.none');

  if (disabled) {
    return showLabel ? (
      <span className="inline-flex h-7 items-center gap-1.5 px-1.5 text-sm">
        {glyph}
        {label}
      </span>
    ) : (
      <Tooltip content={label}>
        <span className="inline-flex">{glyph}</span>
      </Tooltip>
    );
  }

  // Until its first use the trigger stands alone, carrying what the list's
  // popover trigger says while the list is shut; a click mounts the list open.
  const closedTriggerProps = engaged
    ? {}
    : ({
        'aria-haspopup': 'dialog',
        'aria-expanded': false,
        'data-state': 'closed',
      } as const);
  const engage = () => {
    if (engaged) return;
    setEngaged(true);
    setOpen(true);
  };

  // See AssigneePicker: keep the press/click off the draggable parent so it
  // doesn't start a drag or open the task.
  const trigger = showLabel ? (
    <Button
      type="button"
      variant="ghost"
      aria-label={`${t('fields.priority')}: ${label}`}
      className="h-7 gap-1.5 rounded-md px-1.5 text-sm font-normal"
      {...closedTriggerProps}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        engage();
      }}
    >
      {glyph}
      {label}
    </Button>
  ) : (
    <Button
      type="button"
      variant="ghost"
      size="icon"
      aria-label={t('fields.priority')}
      // 24px, the smallest target a pointer may be asked to hit (WCAG 2.5.8)
      // — the glyph plus `p-1` came to 22.
      className="size-6 rounded-md p-0"
      {...closedTriggerProps}
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => {
        e.stopPropagation();
        engage();
      }}
    >
      {glyph}
    </Button>
  );

  const picker = (
    // Stop pointer/click here: React replays portal events through the React
    // tree, so a click on a portaled option would otherwise bubble to the
    // draggable card/row's onClick and open the task. This span is the common
    // React-tree ancestor of the trigger and the portaled list — a propagation
    // boundary, not a control.
    // oxlint-disable-next-line jsx-a11y/no-static-element-interactions, jsx-a11y/click-events-have-key-events -- propagation boundary, not an interactive control
    <span
      className="inline-flex"
      onPointerDown={(e) => e.stopPropagation()}
      onClick={(e) => e.stopPropagation()}
    >
      {engaged ? (
        <PriorityList
          priority={priority}
          onChange={onChange}
          align={align}
          trigger={trigger}
          open={open}
          onOpenChange={setOpen}
        />
      ) : (
        trigger
      )}
    </span>
  );

  // A labelled trigger already says what the glyph means; the tooltip is
  // only for the bare glyph.
  return showLabel ? picker : <Tooltip content={label}>{picker}</Tooltip>;
}

/** The picker's list, mounted around its trigger on first use. */
function PriorityList({
  priority,
  onChange,
  align,
  trigger,
  open,
  onOpenChange,
}: {
  priority: TaskPriority | null | undefined;
  onChange: (priority: TaskPriority | null) => void;
  align: 'start' | 'center' | 'end';
  trigger: ReactElement;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { t } = useT('tasks');
  const { t: tCommon } = useT('common');

  // "No priority" leads so a set priority can always be cleared back to it.
  const options: SearchableSelectOption[] = [
    { value: NO_PRIORITY, label: t('priority.none') },
    ...TASK_PRIORITY_ORDER.map((p) => ({
      value: p,
      label: t(`priority.${p}`),
    })),
  ];

  return (
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
      open={open}
      onOpenChange={onOpenChange}
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
  );
}
