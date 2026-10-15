'use client';

import { Button } from '@tale/ui/button';
import { useT } from '@tale/ui/i18n/client';
import {
  CircleAlert,
  CircleCheck,
  CircleX,
  LoaderCircle,
  TriangleAlert,
} from 'lucide-react';
import { forwardRef, useEffect, useRef, useState, type ReactNode } from 'react';

import { cn } from '../../lib/cn';
import { ISSUE_SEVERITY_ICON_CLASS } from './issue-severity';

/** How many problems of each blocking kind a check found. */
export interface IssueCounts {
  errors: number;
  warnings: number;
}

/**
 * The translate function of the session's language. Every key these helpers
 * read names its namespace (`issues`), so any bound `t` will do — the one
 * from `useT('issues')` or a page's own.
 */
export type IssueTranslate = (
  key: string,
  options?: Record<string, unknown>,
) => string;

/** A count as the catalog reads it: a whole number, never below zero. */
function countOf(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/**
 * The counts as one phrase: "2 errors and 1 warning", "1 warning",
 * "No problems". One message per language, so each word order and plural is
 * the translator's, never assembled from fragments.
 */
export function formatIssueCounts(
  t: IssueTranslate,
  counts: IssueCounts,
): string {
  return t('summary', {
    ns: 'issues',
    errors: countOf(counts.errors),
    warnings: countOf(counts.warnings),
  });
}

export type IssueCheckStatus = 'ready' | 'checking' | 'failed';

export interface IssueCountButtonProps {
  counts: IssueCounts;
  /**
   * `checking` keeps the last counts beside a spinner; `failed` says the
   * check did not finish. Defaults to `ready`.
   */
  status?: IssueCheckStatus;
  /** Whether the panel this button toggles is open (`aria-expanded`). */
  expanded?: boolean;
  /** The id of the panel this button toggles (`aria-controls`). */
  controls?: string;
  onClick?: () => void;
  /** `sm` (32px, toolbars) by default; `default` is the 36px control. */
  size?: 'sm' | 'default';
  className?: string;
}

/** The spinner of a running check, in a glyph's place. */
function CheckingGlyph() {
  return (
    <LoaderCircle
      aria-hidden="true"
      className="text-muted-foreground size-4 shrink-0 motion-safe:animate-spin"
    />
  );
}

/** A count that pops once when it changes — `CountBadge`'s recipe, on the
 * motion tokens: the medium duration, landing on the out-quint ease. While a
 * check runs the spinner takes its glyph's place, as `Button`'s does: the
 * button keeps its width, so the toolbar around it never jumps. */
function CountPart({
  count,
  severity,
  checking = false,
}: {
  count: number;
  severity: 'error' | 'warning';
  checking?: boolean;
}) {
  const Icon = severity === 'error' ? CircleX : TriangleAlert;
  return (
    <span className="animate-in zoom-in-50 inline-flex items-center gap-1 duration-[var(--duration-medium)] ease-[var(--ease-out-quint)] motion-reduce:animate-none">
      {checking ? (
        <CheckingGlyph />
      ) : (
        <Icon
          aria-hidden="true"
          className={cn('size-4 shrink-0', ISSUE_SEVERITY_ICON_CLASS[severity])}
        />
      )}
      {count}
    </span>
  );
}

/**
 * The toggle of a problems panel: `[×] 2 [!] 1` while problems stand,
 * "No problems" without them, a spinner while a check runs and "Couldn't
 * check" when it failed. Its accessible name says it in words ("Problems:
 * 2 errors and 1 warning"), since the glyphs alone mean nothing to a screen
 * reader. A changed number pops once; reduced motion keeps it still.
 *
 * A check runs at every pause in typing, so it never changes the button's
 * width: the last counts stay and the spinner takes the first one's glyph.
 * With none, "No problems" and "Checking…" share one grid cell, the idle
 * one invisible, so the button is as wide as the wider of the two.
 */
export const IssueCountButton = forwardRef<
  HTMLButtonElement,
  IssueCountButtonProps
>(function IssueCountButton(
  {
    counts,
    status = 'ready',
    expanded,
    controls,
    onClick,
    size = 'sm',
    className,
  },
  ref,
) {
  const { t } = useT('issues');
  const errors = countOf(counts.errors);
  const warnings = countOf(counts.warnings);
  const summary = formatIssueCounts(t, { errors, warnings });
  const total = errors + warnings;

  let name: string;
  if (status === 'failed') name = t('buttonLabelFailed');
  // With no counts to keep, a running check claims nothing: "Problems:
  // Checking…", never "No problems" before the result is in.
  else if (status === 'checking' && total === 0) {
    name = t('buttonLabel', { summary: t('checking') });
  } else if (status === 'checking') {
    name = t('buttonLabelChecking', { summary });
  } else if (total === 0) name = summary;
  else name = t('buttonLabel', { summary });

  const checking = status === 'checking';
  const parts =
    total === 0 ? null : (
      <>
        {errors > 0 && (
          <CountPart
            key={`errors-${errors}`}
            count={errors}
            severity="error"
            checking={checking}
          />
        )}
        {warnings > 0 && (
          <CountPart
            key={`warnings-${warnings}`}
            count={warnings}
            severity="warning"
            checking={checking && errors === 0}
          />
        )}
      </>
    );

  let content: ReactNode;
  if (status === 'failed') {
    content = (
      <>
        <CircleAlert
          aria-hidden="true"
          className="text-destructive size-4 shrink-0"
        />
        <span>{t('checkFailed')}</span>
      </>
    );
  } else if (total === 0) {
    content = (
      <>
        {checking ? (
          <CheckingGlyph />
        ) : (
          <CircleCheck
            aria-hidden="true"
            className="text-muted-foreground size-4 shrink-0"
          />
        )}
        <span className="grid justify-items-start">
          <span
            className={cn('col-start-1 row-start-1', checking && 'invisible')}
          >
            {summary}
          </span>
          <span
            className={cn('col-start-1 row-start-1', !checking && 'invisible')}
          >
            {t('checking')}
          </span>
        </span>
      </>
    );
  } else {
    content = parts;
  }

  return (
    <Button
      ref={ref}
      type="button"
      variant="ghost"
      size={size}
      aria-label={name}
      aria-expanded={expanded}
      aria-controls={controls}
      onClick={onClick}
      data-slot="issue-count-button"
      className={cn(
        // `sm` is 32px tall: keep the box and widen the touch area to 44px
        // on phones, as the Save cluster beside it does.
        "relative gap-2 tabular-nums max-sm:after:absolute max-sm:after:-inset-1.5 max-sm:after:content-['']",
        className,
      )}
    >
      {content}
    </Button>
  );
});

export interface IssueAnnouncerProps {
  counts: IssueCounts;
  status: IssueCheckStatus;
  /**
   * Identifies one result worth saying. The announcer speaks once per new
   * key while `status` is `ready` — so a host changes the key when the
   * result changes (or answers something, such as a refused save), never
   * per keystroke or per finished check. The key the announcer mounts with
   * is never spoken.
   */
  announceKey: string | number;
  /** Leads the sentence when the result answers something ("Saving was refused"). */
  context?: string;
}

/**
 * Speaks a check's result to screen readers: a visually hidden polite status
 * region that says "2 errors and 1 warning" once per settled result. A
 * result identical to the last one is spoken again, since the region's
 * content is replaced rather than left unchanged.
 */
export function IssueAnnouncer({
  counts,
  status,
  announceKey,
  context,
}: IssueAnnouncerProps) {
  const { t } = useT('issues');
  const spokenKey = useRef<string | number>(announceKey);
  const [spoken, setSpoken] = useState<{ text: string; serial: number }>({
    text: '',
    serial: 0,
  });

  const errors = countOf(counts.errors);
  const warnings = countOf(counts.warnings);

  useEffect(() => {
    if (status !== 'ready' || spokenKey.current === announceKey) return;
    spokenKey.current = announceKey;
    const summary = formatIssueCounts(t, { errors, warnings });
    const text =
      context === undefined || context === ''
        ? summary
        : t('announce', { context, summary });
    setSpoken((previous) => ({ text, serial: previous.serial + 1 }));
  }, [announceKey, context, errors, status, t, warnings]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
      data-slot="issue-announcer"
    >
      {spoken.text === '' ? null : (
        <span key={spoken.serial}>{spoken.text}</span>
      )}
    </div>
  );
}
