'use client';

import * as ToggleGroupPrimitive from '@radix-ui/react-toggle-group';
import { cn } from '@tale/ui/cn';
import {
  Check,
  ChevronLeft,
  ChevronRight,
  type LucideIcon,
} from 'lucide-react';
import type { KeyboardEvent, ReactNode, Ref } from 'react';

import type { TriggerTooltipGuard } from '../../hooks/use-trigger-tooltip-guard';
import type { RecurrenceCompactLabel } from '../../lib/recurrence/format';
import { hasDisabledReason } from '../overlays/disabled-reason';
import { Button } from '../primitives/button';
import { IconButton } from '../primitives/icon-button';
import { OPTION_ROW_CLASSES, OPTION_ROW_INSET } from './option-row';

// The pieces both modes of the recurrence picker draw the same way: the
// compact trigger, a preset row, a row that opens a custom view, a custom
// view's header and the Save footer.

/** The props both modes of the recurrence picker take. */
export interface RecurrencePickerSharedProps {
  /** The control's name: the trigger's hidden prefix and the popover's
   *  name. @default "Repeat"; "Schedule" with `granularity="time"` */
  label?: string;
  /** A second line under the rule in the tooltip and the accessible
   *  description, while a rule is set. */
  description?: string;
  /** @default Repeat */
  icon?: LucideIcon;
  /** With a `disabledReason`, the trigger stays focusable (`aria-disabled`)
   *  and explains itself; without one it is natively disabled. */
  disabled?: boolean;
  disabledReason?: ReactNode;
  /** The rule as plain text, with no control at all. */
  readOnly?: boolean;
  /** `ghost` fits a property list's `h-7` row; `default` is an `h-9`
   *  outlined field for forms. @default 'ghost' */
  variant?: 'ghost' | 'default';
  /** @default 'end' */
  align?: 'start' | 'center' | 'end';
  /** Traps focus and makes the page inert while open; keep it on inside a
   *  Dialog, Sheet or Drawer, whose scroll lock otherwise swallows the
   *  popover's wheel events. @default true */
  modal?: boolean;
  /** Id of the trigger. */
  id?: string;
  className?: string;
}

const PICKER_ROW_CLASSES = cn(
  OPTION_ROW_CLASSES,
  OPTION_ROW_INSET,
  'hover:bg-accent focus-visible:bg-accent outline-none',
);

export interface PickerTriggerOptions {
  /** The saved rule as a sentence, or null while none is set. */
  sentence: string | null;
  /** The saved rule for the trigger line, or null while none is set. */
  compact: RecurrenceCompactLabel | null;
  /** What a missing rule reads as. */
  never: string;
  /** The hidden prefix of the trigger's name — "Repeat:". */
  namePrefix: string;
  description?: string;
  icon: LucideIcon;
  disabled: boolean;
  disabledReason?: ReactNode;
  variant: 'ghost' | 'default';
  id?: string;
  className?: string;
  descriptionId: string;
  triggerRef: Ref<HTMLButtonElement>;
  tooltipGuard: TriggerTooltipGuard;
}

/**
 * The picker's closed state: the read-only text, the trigger button, and the
 * hidden description the trigger points at.
 */
export function pickerTrigger({
  sentence,
  compact,
  never,
  namePrefix,
  description,
  icon: Icon,
  disabled,
  disabledReason,
  variant,
  id,
  className,
  descriptionId,
  triggerRef,
  tooltipGuard,
}: PickerTriggerOptions) {
  const reason =
    disabled && hasDisabledReason(disabledReason) ? disabledReason : undefined;
  const hostDescription =
    sentence !== null && description ? description : undefined;
  const hasDescription =
    sentence !== null || hostDescription !== undefined || reason !== undefined;
  const tip = hasDescription ? (
    <span className="flex flex-col gap-0.5">
      {sentence !== null && <span>{sentence}</span>}
      {hostDescription !== undefined && <span>{hostDescription}</span>}
      {reason !== undefined && <span>{reason}</span>}
    </span>
  ) : undefined;

  // "Repeat: Weekly, Tue" — the visible words behind the control's name, so
  // a voice command that reads the label out finds it.
  const visibleText = compact
    ? [compact.head, compact.tail].filter(Boolean).join(', ')
    : never;
  const accessibleName = `${namePrefix} ${visibleText}`;

  // One line whatever the width: a tail that does not fit wraps onto a
  // second line the box hides, so it leaves whole rather than mid-word.
  const icon = (
    <Icon
      className="text-muted-foreground size-4 shrink-0"
      aria-hidden="true"
    />
  );
  const text = (
    <span className="flex h-5 min-w-0 flex-wrap overflow-hidden leading-5">
      {compact ? (
        <>
          <span className="max-w-full truncate">{compact.head}</span>
          {compact.tail !== undefined && (
            <span className="whitespace-nowrap">
              {' · '}
              {compact.tail}
            </span>
          )}
        </>
      ) : (
        <span className="text-muted-foreground max-w-full truncate">
          {never}
        </span>
      )}
    </span>
  );

  // Plain text: the full sentence for assistive technology, the compact
  // line (and the sentence on hover) for sight.
  const readOnly = (
    <span
      id={id}
      title={sentence ?? undefined}
      className={cn(
        'inline-flex w-full min-w-0 items-center gap-1.5 text-sm',
        variant === 'ghost' ? 'h-7 px-1.5' : 'h-9 px-2',
        className,
      )}
    >
      {icon}
      <span aria-hidden="true" className="flex min-w-0">
        {text}
      </span>
      <span className="sr-only">{sentence ?? never}</span>
    </span>
  );

  const trigger = (
    <Button
      ref={triggerRef}
      id={id}
      type="button"
      variant="ghost"
      disabled={disabled}
      disabledReason={reason !== undefined ? tip : undefined}
      tooltip={disabled ? undefined : tip}
      tooltipOpen={tooltipGuard.open}
      onTooltipOpenChange={tooltipGuard.onOpenChange}
      aria-label={accessibleName}
      aria-describedby={hasDescription ? descriptionId : undefined}
      className={cn(
        'w-full min-w-0 justify-start gap-1.5 text-sm font-normal',
        variant === 'ghost'
          ? 'h-7 px-1.5'
          : 'ring-border h-9 rounded-md px-2 ring-1',
        // Locked is not dimmed: the rule stays readable at full contrast
        // and the tooltip says why it cannot change.
        reason !== undefined &&
          'hover:bg-transparent aria-disabled:cursor-default aria-disabled:opacity-100 aria-disabled:hover:opacity-100',
        className,
      )}
    >
      {icon}
      {text}
    </Button>
  );

  // Read by assistive technology whether or not the tooltip is open. One
  // run of text, so every engine hears the spaces between the lines.
  const descriptionText = [sentence, hostDescription]
    .filter((part) => part !== null && part !== undefined)
    .join(' ');
  const descriptionNode = hasDescription ? (
    <span id={descriptionId} hidden>
      {descriptionText}
      {descriptionText !== '' && reason !== undefined && ' '}
      {reason}
    </span>
  ) : null;

  return { readOnly, trigger, description: descriptionNode };
}

/** One preset row; choosing it saves. */
export function presetRow<Choice extends string>({
  choice,
  label,
  badge,
  checked,
  onPick,
}: {
  choice: Choice;
  label: string;
  badge?: string;
  checked: boolean;
  onPick: (choice: Choice) => void;
}) {
  return (
    <ToggleGroupPrimitive.Item
      key={choice}
      value={choice}
      onClick={() => onPick(choice)}
      className={cn(PICKER_ROW_CLASSES, 'items-center')}
    >
      <span className="min-w-0 flex-1">{label}</span>
      {badge !== undefined && (
        <span
          aria-hidden="true"
          className="text-muted-foreground shrink-0 text-xs"
        >
          {badge}
        </span>
      )}
      <Check
        aria-hidden="true"
        className={cn('text-primary size-4 shrink-0', !checked && 'invisible')}
      />
    </ToggleGroupPrimitive.Item>
  );
}

/** A row that opens a custom view; while the draft is its kind of custom
 *  rule it is checked and its description is the rule. */
export function customRow({
  rowRef,
  label,
  labelId,
  ruleId,
  rule,
  onOpen,
}: {
  rowRef?: Ref<HTMLButtonElement>;
  label: string;
  labelId: string;
  ruleId: string;
  /** The draft rule in words while this row is the checked one, else null. */
  rule: string | null;
  onOpen: () => void;
}) {
  return (
    <button
      ref={rowRef}
      type="button"
      onClick={onOpen}
      aria-labelledby={labelId}
      aria-describedby={rule !== null ? ruleId : undefined}
      className={cn(PICKER_ROW_CLASSES, 'items-start')}
    >
      <span className="min-w-0 flex-1">
        <span id={labelId} className="block">
          {label}
        </span>
        {rule !== null && (
          <span
            id={ruleId}
            className="text-muted-foreground line-clamp-2 block text-xs"
          >
            {rule}
          </span>
        )}
      </span>
      {rule !== null && (
        <Check
          aria-hidden="true"
          className="text-primary mt-0.5 size-4 shrink-0"
        />
      )}
      <ChevronRight
        aria-hidden="true"
        className="text-muted-foreground mt-0.5 size-4 shrink-0"
      />
    </button>
  );
}

/** A custom view's header: Back to presets and the view's heading. */
export function customHeader({
  headingId,
  title,
  backLabel,
  onBack,
}: {
  headingId: string;
  title: string;
  backLabel: string;
  onBack: () => void;
}) {
  return (
    <div className="border-border flex items-center gap-1 border-b p-1">
      <IconButton
        icon={ChevronLeft}
        size="sm"
        aria-label={backLabel}
        onClick={onBack}
      />
      <h2 id={headingId} className="text-sm font-medium">
        {title}
      </h2>
    </div>
  );
}

/** Cancel and Save. Save stays focusable with its reason while blocked. */
export function pickerFooter({
  cancelLabel,
  saveLabel,
  onCancel,
  onSave,
  blockedReason,
}: {
  cancelLabel: string;
  saveLabel: string;
  onCancel: () => void;
  onSave: () => void;
  blockedReason?: string;
}) {
  return (
    <div className="border-border flex justify-end gap-2 border-t p-2">
      <Button type="button" variant="secondary" size="sm" onClick={onCancel}>
        {cancelLabel}
      </Button>
      <Button
        type="button"
        size="sm"
        onClick={onSave}
        aria-keyshortcuts="Control+Enter Meta+Enter"
        {...(blockedReason !== undefined
          ? { disabled: true, disabledReason: blockedReason }
          : {})}
      >
        {saveLabel}
      </Button>
    </div>
  );
}

/**
 * Enter never leaves the popover: React bubbles it through the portal to
 * whatever form or shortcut the host wraps the picker in. Ctrl+Enter (Cmd
 * on a Mac) saves from anywhere in it.
 */
export function popoverKeyDown(save: () => void) {
  return (event: KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Enter') return;
    event.stopPropagation();
    if (event.ctrlKey || event.metaKey) {
      event.preventDefault();
      save();
    }
  };
}
