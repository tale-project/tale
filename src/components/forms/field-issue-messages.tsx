'use client';

import { useT } from '@tale/ui/i18n/client';
import type { ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { IssueSeverityIcon } from '../feedback/issue-severity';

/** A problem with one field, in the reader's words. */
export interface FieldIssue {
  /** Stable across checks (it keys the line). */
  id: string;
  severity: 'error' | 'warning';
  message: ReactNode;
}

/** The id of a field's `index`-th problem line, for `aria-describedby`. */
export function fieldIssueMessageId(idPrefix: string, index: number): string {
  return `${idPrefix}-issue-${index}`;
}

/**
 * The ids of every problem line of a field, joined for `aria-describedby`;
 * `undefined` when there are none.
 */
export function fieldIssueDescribedBy(
  idPrefix: string,
  issues: ReadonlyArray<FieldIssue> | undefined,
): string | undefined {
  if (issues === undefined || issues.length === 0) return undefined;
  return issues
    .map((_, index) => fieldIssueMessageId(idPrefix, index))
    .join(' ');
}

/** Whether any of a field's problems is an error (the control is invalid). */
export function fieldIssuesHaveError(
  issues: ReadonlyArray<FieldIssue> | undefined,
): boolean {
  return issues?.some((issue) => issue.severity === 'error') ?? false;
}

export interface FieldIssueMessagesProps {
  issues: ReadonlyArray<FieldIssue> | undefined;
  /** Prefix of each line's id — {@link fieldIssueMessageId} builds them. */
  idPrefix: string;
  className?: string;
}

/**
 * A field's problems under its control, one line each: the severity glyph,
 * a visually hidden "Error:" or "Warning:", then the message. Error text is
 * the destructive colour; warning text stays the foreground colour (amber
 * text fails AA) beside an amber glyph.
 *
 * Wire each line into the control's `aria-describedby`
 * ({@link fieldIssueDescribedBy}) — the lines are descriptions, not alerts:
 * whatever announces a check's result announces it once, and a field must
 * not repeat it at every keystroke. `Field` does all of this through its
 * `issues` prop; use this component directly in a custom layout
 * (`FieldShell`).
 */
export function FieldIssueMessages({
  issues,
  idPrefix,
  className,
}: FieldIssueMessagesProps) {
  const { t } = useT('issues');
  if (issues === undefined || issues.length === 0) return null;
  return (
    <ul
      data-slot="field-issue-messages"
      className={cn('flex flex-col gap-1', className)}
    >
      {issues.map((issue, index) => (
        <li
          key={issue.id}
          id={fieldIssueMessageId(idPrefix, index)}
          className="flex gap-1.5 text-xs"
        >
          <IssueSeverityIcon
            severity={issue.severity}
            className="mt-px size-3.5"
          />
          <span
            className={cn(
              'min-w-0 break-words',
              issue.severity === 'error'
                ? 'text-destructive'
                : 'text-foreground',
            )}
          >
            <span className="sr-only">{t(`srPrefix.${issue.severity}`)}</span>{' '}
            {issue.message}
          </span>
        </li>
      ))}
    </ul>
  );
}
