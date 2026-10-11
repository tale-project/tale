'use client';

import { Button } from '@tale/ui/button';
import { useLocale } from '@tale/ui/i18n/locale-provider';
import { TestStatusIcon, type TestStatus } from '@tale/ui/test-results';
import { FlaskConical, RotateCcw, X } from 'lucide-react';

import { useT } from '@/lib/i18n/client';

import type { TransientStatus } from '../../lib/automation-tests/transient-run';

/** Where the run laid over the canvas stands: still going, or how it
 * ended — in words, with when it ended. */
export type TransientRunState =
  | { kind: 'running'; words: string }
  | {
      kind: 'done';
      status: TransientStatus;
      words: string;
      at: number;
    };

const GLYPH: Readonly<Record<TransientStatus, TestStatus>> = {
  success: 'passed',
  failed: 'failed',
  cancelled: 'error',
};

export interface TransientRunBannerProps {
  /** Which run it is: "Unsaved test", "Test: Big order". */
  title: string;
  state: TransientRunState;
  /** Says what changed since this run, when something did — the draft
   * since a try, the automation or the test since a test's run; trying
   * again shows it as it is now. */
  changed?: string;
  /** Runs it again, as it ran; left out, the banner offers no Try again. */
  onTryAgain?: () => void;
  /** The words of that action, when not "Try again" (a test's "Run"). */
  againLabel?: string;
  /** Takes the run off the canvas, back to the last stored run. */
  onClear: () => void;
}

/**
 * The strip at the canvas's top edge while a run that was never stored —
 * a try of the draft, a test's run — lies over the canvas in place of the
 * last run: which run, how it ended and when, with Try again and the way
 * back. Its status is a polite live region, so a screen reader hears how a
 * try ended.
 */
export function TransientRunBanner({
  title,
  state,
  changed,
  onTryAgain,
  againLabel,
  onClear,
}: TransientRunBannerProps) {
  const { t } = useT('automations');
  const { locale } = useLocale();
  const time =
    state.kind === 'done'
      ? new Intl.DateTimeFormat(locale, { timeStyle: 'short' }).format(state.at)
      : null;
  return (
    <section
      aria-label={title}
      className="bg-background/95 border-border animate-in fade-in flex min-h-10 shrink-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-1.5 duration-[var(--duration-short)] motion-reduce:animate-none"
    >
      <span className="flex min-w-0 items-center gap-2">
        <FlaskConical
          aria-hidden="true"
          className="text-muted-foreground size-4 shrink-0"
        />
        <span className="text-foreground text-sm font-medium">{title}</span>
      </span>
      <span
        role="status"
        className="text-foreground flex min-w-0 items-center gap-1.5 text-sm"
      >
        <span className="sr-only">{title}: </span>
        <TestStatusIcon
          status={state.kind === 'running' ? 'running' : GLYPH[state.status]}
        />
        <span>{state.words}</span>
        {time !== null && (
          <span className="text-muted-foreground">
            <span aria-hidden="true">· </span>
            {time}
          </span>
        )}
      </span>
      {changed !== undefined && (
        <span className="text-muted-foreground text-xs">{changed}</span>
      )}
      <span className="ml-auto flex items-center gap-1">
        {onTryAgain !== undefined && (
          <Button
            type="button"
            size="sm"
            variant={changed === undefined ? 'secondary' : 'primary'}
            icon={RotateCcw}
            disabled={state.kind === 'running'}
            aria-keyshortcuts="Meta+Shift+Enter Control+Shift+Enter"
            onClick={onTryAgain}
          >
            {againLabel ?? t('try.again')}
          </Button>
        )}
        <Button
          type="button"
          size="icon-sm"
          variant="ghost"
          title={t('try.clear')}
          tooltipSide="bottom"
          onClick={onClear}
        >
          <X aria-hidden="true" className="size-4" />
        </Button>
      </span>
    </section>
  );
}
