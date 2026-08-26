'use client';

import { Text } from '@tale/ui/text';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

import { Textarea } from '@/app/components/ui/forms/textarea';
import {
  detectMentionTrigger,
  type MentionTrigger,
} from '@/app/features/shared/mentions/use-kb-mentions';
import type { Id } from '@/convex/_generated/dataModel';
import { useT } from '@/lib/i18n/client';
import { cn } from '@/lib/utils/cn';

import {
  filterMentionActorOptions,
  type MentionActorOption,
  useMentionActorOptions,
} from '../lib/mention-actor-options';
import { AssigneeAvatar } from './assignee-avatar';

interface MentionTextareaProps extends Omit<
  React.ComponentPropsWithoutRef<'textarea'>,
  'value' | 'onChange'
> {
  organizationId: string;
  projectId: Id<'projects'>;
  value: string;
  onValueChange: (value: string) => void;
  label?: string;
  /** Popover side. Composers at the bottom of a panel want 'above' (default);
   *  fields near the top of a dialog want 'below'. */
  placement?: 'above' | 'below';
}

/**
 * A {@link Textarea} with an `@`-mention autocomplete over the project's
 * mentionable actors (org members + project agents). Combobox pattern: the
 * textarea keeps focus; typing `@` opens the listbox, Up/Down navigate,
 * Enter/Tab insert the selected actor's plain-text `@handle` (the format the
 * task mutations parse), Escape closes. Caret moves only update/close an
 * already-open picker, so clicking into existing `@handle` prose doesn't
 * reopen it.
 */
export function MentionTextarea({
  organizationId,
  projectId,
  value,
  onValueChange,
  placement = 'above',
  onKeyDown,
  onKeyUp,
  onClick,
  onBlur,
  id,
  ...textareaProps
}: MentionTextareaProps) {
  const { t } = useT('tasks');
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const listRef = useRef<HTMLUListElement>(null);
  const [trigger, setTrigger] = useState<MentionTrigger | null>(null);
  const [highlight, setHighlight] = useState(0);

  const options = useMentionActorOptions(organizationId, projectId);
  const results = useMemo(
    () => filterMentionActorOptions(options, trigger?.query ?? ''),
    [options, trigger?.query],
  );
  const clampedHighlight = Math.min(highlight, Math.max(results.length - 1, 0));

  const generatedId = `mention-textarea-${projectId}`;
  const textareaId = id ?? generatedId;
  const listboxId = `${textareaId}-mention-listbox`;
  const optionId = (index: number) => `${textareaId}-mention-option-${index}`;
  const open = trigger !== null && !textareaProps.disabled;

  /** Re-evaluate the `@` trigger from the caret. `onlyWhenOpen` restricts
   *  caret-move events (clicks, arrows) to updating/closing an open picker —
   *  only typing opens it. */
  const updateTrigger = useCallback((onlyWhenOpen: boolean) => {
    const textarea = textareaRef.current;
    if (!textarea) return;
    const next = detectMentionTrigger(
      textarea.value,
      textarea.selectionStart ?? textarea.value.length,
    );
    setTrigger((prev) => {
      if (onlyWhenOpen && prev === null) return prev;
      if (prev === null || next === null || prev.query !== next.query) {
        setHighlight(0);
      }
      return next;
    });
  }, []);

  const selectOption = useCallback(
    (option: MentionActorOption) => {
      const textarea = textareaRef.current;
      if (!textarea || !trigger) return;
      // setRangeText on the DOM node keeps the caret + undo stack intact
      // (same rationale as the chat composer's mention insert).
      textarea.setRangeText(
        `@${option.handle} `,
        trigger.start,
        trigger.end,
        'end',
      );
      onValueChange(textarea.value);
      setTrigger(null);
      setHighlight(0);
    },
    [trigger, onValueChange],
  );

  // Keep the highlighted option visible while navigating with the keyboard.
  useEffect(() => {
    const active = listRef.current?.querySelector('[aria-selected="true"]');
    active?.scrollIntoView({ block: 'nearest' });
  }, [clampedHighlight]);

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // An IME commit (Enter/arrow during composition) must never drive the
    // picker — `keyCode === 229` is the legacy Safari path.
    const isComposing = e.nativeEvent.isComposing || e.keyCode === 229;
    if (open && !isComposing && results.length > 0) {
      if (e.key === 'ArrowDown') {
        e.preventDefault();
        setHighlight((i) => Math.min(i + 1, results.length - 1));
        return;
      }
      if (e.key === 'ArrowUp') {
        e.preventDefault();
        setHighlight((i) => Math.max(i - 1, 0));
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        setTrigger(null);
        return;
      }
      // Bare Enter / Tab select; modified Enter (⌘/Ctrl/Shift) falls through
      // to the caller (comment composers submit on ⌘Enter).
      if (
        (e.key === 'Enter' && !e.metaKey && !e.ctrlKey && !e.shiftKey) ||
        e.key === 'Tab'
      ) {
        e.preventDefault();
        selectOption(results[clampedHighlight]);
        return;
      }
    }
    onKeyDown?.(e);
  };

  return (
    <div className="relative">
      <Textarea
        {...textareaProps}
        id={textareaId}
        ref={textareaRef}
        value={value}
        onChange={(e) => {
          onValueChange(e.target.value);
          updateTrigger(false);
        }}
        onKeyDown={handleKeyDown}
        onKeyUp={(e) => {
          updateTrigger(true);
          onKeyUp?.(e);
        }}
        onClick={(e) => {
          updateTrigger(true);
          onClick?.(e);
        }}
        onBlur={(e) => {
          setTrigger(null);
          onBlur?.(e);
        }}
        role="combobox"
        aria-autocomplete="list"
        aria-expanded={open}
        aria-controls={open ? listboxId : undefined}
        aria-activedescendant={
          open && results.length > 0 ? optionId(clampedHighlight) : undefined
        }
      />
      {open && (
        <div
          className={cn(
            'border-border bg-popover text-popover-foreground absolute right-0 left-0 z-50 overflow-hidden rounded-xl border shadow-lg',
            placement === 'above' ? 'bottom-full mb-2' : 'top-full mt-2',
          )}
        >
          {results.length === 0 ? (
            <Text
              as="div"
              variant="caption"
              className="text-muted-foreground px-3 py-2.5"
            >
              {t('mentionPicker.empty')}
            </Text>
          ) : (
            <ul
              ref={listRef}
              id={listboxId}
              role="listbox"
              aria-label={t('mentionPicker.title')}
              className="max-h-56 overflow-y-auto py-1"
            >
              {results.map((option, index) => {
                const isActive = index === clampedHighlight;
                return (
                  <li
                    key={`${option.type}:${option.id}`}
                    id={optionId(index)}
                    role="option"
                    aria-selected={isActive}
                    className={cn(
                      'flex cursor-pointer items-center gap-2.5 px-3 py-1.5',
                      isActive && 'bg-accent text-accent-foreground',
                    )}
                    // Select on mousedown (and prevent default) so the click
                    // doesn't blur the textarea and close the picker first.
                    onMouseDown={(e) => {
                      e.preventDefault();
                      selectOption(option);
                    }}
                    onMouseEnter={() => setHighlight(index)}
                  >
                    <AssigneeAvatar
                      // The avatar speaks the task worker vocabulary, where
                      // an automation is `app`.
                      assigneeType={
                        option.type === 'automation' ? 'app' : option.type
                      }
                      assigneeId={option.id}
                      name={option.name}
                    />
                    <span className="min-w-0 flex-1">
                      <Text
                        as="span"
                        variant="label"
                        className="block truncate"
                      >
                        {option.name}
                      </Text>
                      <Text
                        as="span"
                        variant="caption"
                        className="text-muted-foreground block truncate"
                      >
                        @{option.handle}
                        {option.type === 'agent' &&
                          ` · ${t('assignee.agents')}`}
                        {option.type === 'automation' &&
                          ` · ${t('assignee.automations')}`}
                      </Text>
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
