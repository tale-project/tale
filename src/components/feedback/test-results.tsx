'use client';

import { Button } from '@tale/ui/button';
import { useT } from '@tale/ui/i18n/client';
import {
  CircleAlert,
  CircleCheck,
  CircleDashed,
  CircleX,
  Clock,
  FlaskConical,
  History,
  LoaderCircle,
  type LucideIcon,
} from 'lucide-react';
import {
  forwardRef,
  useCallback,
  useEffect,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';

import { cn } from '../../lib/cn';

/**
 * Where one test stands. `failed` is a test that ran and did not get what
 * it expects; `error` is one that could not run at all (a broken setup, a
 * refused run). `stale` is a result kept from before the thing under test
 * changed; `not-run` has no result yet.
 */
export type TestStatus =
  | 'passed'
  | 'failed'
  | 'error'
  | 'running'
  | 'queued'
  | 'not-run'
  | 'stale';

/**
 * Glyph, glyph colour and the key of the status's word (in the
 * `testResults` namespace). Every status has its own glyph, so none is told
 * by colour alone, and every colour keeps 3:1 on the page, a card and a
 * muted row fill in both themes: "passed" takes the success token a flow
 * node's "Succeeded" has, and "couldn't run" amber-700, since amber-600
 * drops to 2.9:1 on a muted fill.
 */
export const TEST_STATUS: Readonly<
  Record<TestStatus, { icon: LucideIcon; iconClass: string; labelKey: string }>
> = {
  passed: {
    icon: CircleCheck,
    iconClass: 'text-[hsl(var(--success))]',
    labelKey: 'status.passed',
  },
  failed: {
    icon: CircleX,
    iconClass: 'text-destructive',
    labelKey: 'status.failed',
  },
  error: {
    icon: CircleAlert,
    iconClass: 'text-amber-700 dark:text-amber-500',
    labelKey: 'status.error',
  },
  running: {
    icon: LoaderCircle,
    iconClass: 'text-muted-foreground motion-safe:animate-spin',
    labelKey: 'status.running',
  },
  queued: {
    icon: Clock,
    iconClass: 'text-muted-foreground',
    labelKey: 'status.queued',
  },
  'not-run': {
    icon: CircleDashed,
    iconClass: 'text-muted-foreground',
    labelKey: 'status.notRun',
  },
  stale: {
    icon: History,
    iconClass: 'text-muted-foreground',
    labelKey: 'status.stale',
  },
};

/** The status's word in the session's language ("Couldn't run"). The same
 * function across renders while the language stays, so a table's columns
 * built from it are not rebuilt — and its rows not remounted — on every
 * render. */
export function useTestStatusLabel(): (status: TestStatus) => string {
  const { t } = useT('testResults');
  return useCallback(
    (status: TestStatus) => t(TEST_STATUS[status].labelKey),
    [t],
  );
}

export interface TestStatusIconProps {
  status: TestStatus;
  /** Size and placement, e.g. `size-4 mt-0.5`. Defaults to `size-4`. */
  className?: string;
  /**
   * Names the glyph for assistive technology. Without it the glyph is
   * decoration (`aria-hidden`) and the surrounding text must say the
   * status — `TestResultList` adds a visually hidden "Failed:".
   */
  label?: string;
}

/** The status glyph in its colour; a running test's spins unless the
 * reader asked for less motion. */
export function TestStatusIcon({
  status,
  className,
  label,
}: TestStatusIconProps) {
  const { icon: Icon, iconClass } = TEST_STATUS[status];
  const classes = cn('size-4 shrink-0', iconClass, className);
  if (label === undefined || label === '') {
    return <Icon aria-hidden="true" className={classes} />;
  }
  return <Icon role="img" aria-label={label} className={classes} />;
}

/** How many tests stand where. `total` counts every test, the running and
 * waiting ones included. */
export interface TestCounts {
  passed: number;
  failed: number;
  error: number;
  notRun: number;
  stale: number;
  total: number;
}

/**
 * The translate function of the session's language. Every key these helpers
 * read names its namespace (`testResults`), so any bound `t` will do — the
 * one from `useT('testResults')` or a page's own.
 */
export type TestTranslate = (
  key: string,
  options?: Record<string, unknown>,
) => string;

/** A count as the catalog reads it: a whole number, never below zero. */
function countOf(value: number): number {
  return Number.isFinite(value) && value > 0 ? Math.floor(value) : 0;
}

/** The counts of a list of statuses. */
export function countTestStatuses(statuses: Iterable<TestStatus>): TestCounts {
  const counts: TestCounts = {
    passed: 0,
    failed: 0,
    error: 0,
    notRun: 0,
    stale: 0,
    total: 0,
  };
  for (const status of statuses) {
    counts.total += 1;
    if (status === 'passed') counts.passed += 1;
    else if (status === 'failed') counts.failed += 1;
    else if (status === 'error') counts.error += 1;
    else if (status === 'not-run') counts.notRun += 1;
    else if (status === 'stale') counts.stale += 1;
  }
  return counts;
}

/**
 * The counts in words, the statuses that occur only: "2 passed, 1 failed",
 * "3 not run yet", "No tests". Each part is one message with its own
 * plural; the parts are joined the way the language lists units. With only
 * running or waiting tests it says how many there are ("3 tests").
 */
export function formatTestCounts(
  t: TestTranslate,
  counts: TestCounts,
  locale = 'en',
): string {
  const ns = 'testResults';
  const passed = countOf(counts.passed);
  const failed = countOf(counts.failed);
  const error = countOf(counts.error);
  const notRun = countOf(counts.notRun);
  const stale = countOf(counts.stale);
  const parts = [
    passed > 0 ? t('counts.passed', { ns, count: passed }) : null,
    failed > 0 ? t('counts.failed', { ns, count: failed }) : null,
    error > 0 ? t('counts.error', { ns, count: error }) : null,
    notRun > 0 ? t('counts.notRun', { ns, count: notRun }) : null,
    stale > 0 ? t('counts.stale', { ns, count: stale }) : null,
  ].filter((part): part is string => part !== null);
  if (parts.length > 0) {
    return new Intl.ListFormat(locale, { type: 'unit', style: 'short' }).format(
      parts,
    );
  }
  const total = countOf(counts.total);
  return total > 0
    ? t('counts.total', { ns, count: total })
    : t('none', { ns });
}

/** The session's language, for joining a list the way it does. */
function useListLocale(): string {
  const { i18n } = useTranslation();
  return i18n?.resolvedLanguage ?? i18n?.language ?? 'en';
}

/** One test, already in the reader's words. */
export interface TestResultItem {
  /** Stable across runs, so focus and the current row survive a re-run. */
  id: string;
  name: ReactNode;
  status: TestStatus;
  /** One line on why: "Output differs at total", "Ran out of time". */
  reason?: ReactNode;
  /**
   * A result's short trailing figure: "120 ms", "unsaved". Leave it out
   * while the test waits or runs — the status's word takes the trailing
   * edge then, and the row keeps one line from start to result.
   */
  meta?: ReactNode;
  /** Text chips under the reason ("Simulates 2 nodes"); never controls —
   * a row's controls belong in `renderActions`. */
  badges?: ReactNode;
}

export interface TestResultListHandle {
  /** Focuses the row of `id`, else the list's current row. */
  focus(id?: string): void;
}

export type TestRunStatus = 'ready' | 'running' | 'failed';

/** What a row's trailing controls need to join the list's tab order. */
export interface TestResultRowState {
  /** `0` for the list's current row, `-1` for the others: a row's
   * controls are reachable with Tab only while it is the current one. */
  tabIndex: 0 | -1;
  current: boolean;
}

export interface TestResultListProps {
  items: readonly TestResultItem[];
  /** Names the list; defaults to "Tests". */
  'aria-label'?: string;
  'aria-labelledby'?: string;
  /** The row the host is showing (marked `aria-current`). */
  activeId?: string | null;
  /**
   * Called when a row is activated. Absent, the list is static — no row
   * buttons, no roving focus — for run pages and other read-only views.
   */
  onActivate?: (item: TestResultItem) => void;
  /** A row's trailing controls (a menu), outside the row's button. */
  renderActions?: (item: TestResultItem, row: TestResultRowState) => ReactNode;
  /**
   * `running` marks the list busy while its rows say which test runs;
   * `failed` says the run did not finish above whatever the list still
   * shows.
   */
  status?: TestRunStatus;
  /** Replaces the default "couldn't run the tests" sentence. */
  failedMessage?: ReactNode;
  /** Replaces the default "No tests". */
  emptyMessage?: ReactNode;
  /** `compact` leaves the badges out. */
  density?: 'comfortable' | 'compact';
  className?: string;
}

/**
 * The row grid: status · name and reason · the status's word and the meta.
 * The list is a size container, and the trailing column needs room: below
 * 32rem (a phone, a side panel) the word and the meta drop under the
 * reason instead, so a long name keeps the width to wrap in. Every row is
 * at least 36px tall.
 */
const ROW_GRID =
  'grid min-h-9 w-full grid-cols-[1rem_minmax(0,1fr)] gap-x-2 gap-y-0.5 px-3 py-2 text-left @lg/test-results:grid-cols-[1rem_minmax(0,1fr)_auto]';

/** The grid row the trailing words take in a narrow list: the first one
 * free under the name, after the reason and the badges. */
const NARROW_TRAILING_ROW = [
  'row-start-2',
  'row-start-3',
  'row-start-4',
] as const;

/** A changed status fades its glyph in, on opacity alone; reduced motion
 * shows it at once. The row never moves. */
const STATUS_FADE =
  'animate-in fade-in duration-[var(--duration-short)] ease-[var(--ease-out-quint)] motion-reduce:animate-none';

/** Statuses whose glyph says them to anyone: a tick and a cross. Every
 * other status writes its word on the row as well. */
const SELF_EVIDENT: ReadonlySet<TestStatus> = new Set(['passed', 'failed']);

function RowContent({
  item,
  word,
  prefix,
  compact,
}: {
  item: TestResultItem;
  /** The status's word ("Waiting"). */
  word: string;
  /** The visually hidden lead of the row's name ("Waiting:"). */
  prefix: string;
  compact: boolean;
}) {
  // A status its glyph cannot say alone is written out on the trailing
  // edge, over the meta — hidden from assistive technology, whose name for
  // the row already starts with the same word. On the first line, so a
  // row keeps its height as its test goes from waiting to running to done.
  const shownWord = SELF_EVIDENT.has(item.status) ? undefined : word;
  return (
    <>
      <span
        key={item.status}
        data-status={item.status}
        className={cn('col-start-1 row-start-1 mt-0.5 flex', STATUS_FADE)}
      >
        <TestStatusIcon status={item.status} />
      </span>
      <span className="text-foreground col-start-2 row-start-1 text-sm font-medium break-words">
        <span className="sr-only">{prefix}</span> {item.name}
      </span>
      {item.reason !== undefined && (
        <span className="text-muted-foreground col-start-2 row-start-2 text-xs break-words">
          {item.reason}
        </span>
      )}
      {!compact && item.badges !== undefined && (
        <span
          className={cn(
            'col-start-2 flex flex-wrap gap-1 pt-0.5',
            item.reason === undefined ? 'row-start-2' : 'row-start-3',
          )}
        >
          {item.badges}
        </span>
      )}
      {(shownWord !== undefined || item.meta !== undefined) && (
        // Narrow: one line under the reason and the badges. Wide: stacked
        // on the trailing edge.
        <span
          data-slot="test-result-trailing"
          className={cn(
            'text-muted-foreground col-start-2 flex flex-wrap items-baseline gap-x-2 text-xs',
            NARROW_TRAILING_ROW[
              (item.reason === undefined ? 0 : 1) +
                (compact || item.badges === undefined ? 0 : 1)
            ],
            '@lg/test-results:col-start-3 @lg/test-results:row-span-2 @lg/test-results:row-start-1 @lg/test-results:flex-col @lg/test-results:flex-nowrap @lg/test-results:items-end @lg/test-results:gap-0.5 @lg/test-results:pt-0.5',
          )}
        >
          {shownWord !== undefined && (
            <span
              aria-hidden="true"
              data-slot="test-status-word"
              className="break-words @lg/test-results:max-w-36 @lg/test-results:text-right"
            >
              {shownWord}
            </span>
          )}
          {item.meta !== undefined && (
            <span className="whitespace-nowrap tabular-nums">{item.meta}</span>
          )}
        </span>
      )}
    </>
  );
}

/**
 * The results of a run of tests, one row per test: its status glyph (with
 * the status as a visually hidden word), its name, why it stands there and
 * a trailing figure. Use it for checks that were *run*; problems found by
 * reading a document belong in `IssueList`.
 *
 * With `onActivate` every row is a button: the list is one tab stop, ↑/↓
 * and Home/End move between rows, and Enter or Space activates. A row's
 * `renderActions` sit beside its button and join the tab order only while
 * that row is the current one, so Tab goes row → its actions → out.
 */
export const TestResultList = forwardRef<
  TestResultListHandle,
  TestResultListProps
>(function TestResultList(
  {
    items,
    'aria-label': ariaLabel,
    'aria-labelledby': ariaLabelledBy,
    activeId = null,
    onActivate,
    renderActions,
    status = 'ready',
    failedMessage,
    emptyMessage,
    density = 'comfortable',
    className,
  },
  ref,
) {
  const { t } = useT('testResults');
  const statusLabel = useTestStatusLabel();
  const rows = useRef(new Map<string, HTMLButtonElement>());
  const [focusedId, setFocusedId] = useState<string | null>(null);

  const listed = (id: string | null): id is string =>
    id !== null && items.some((item) => item.id === id);
  // The one tab stop: the row last focused while it is still listed, else
  // the row the host shows, else the first.
  const rovingId = listed(focusedId)
    ? focusedId
    : listed(activeId)
      ? activeId
      : (items[0]?.id ?? null);

  // The roving row as of the last focus, read by the handle between
  // renders (two calls in one task see the first one's row).
  const rovingRef = useRef(rovingId);
  useLayoutEffect(() => {
    rovingRef.current = rovingId;
  }, [rovingId]);

  const focusRow = useCallback((id: string) => {
    const row = rows.current.get(id);
    if (row === undefined) return;
    rovingRef.current = id;
    setFocusedId(id);
    row.focus();
  }, []);

  useImperativeHandle(
    ref,
    () => ({
      focus(id?: string) {
        const target =
          id !== undefined && rows.current.has(id) ? id : rovingRef.current;
        if (target !== null) focusRow(target);
      },
    }),
    [focusRow],
  );

  const onRowKeyDown = (
    event: KeyboardEvent<HTMLButtonElement>,
    index: number,
  ) => {
    let next: number;
    switch (event.key) {
      case 'ArrowDown':
        next = Math.min(index + 1, items.length - 1);
        break;
      case 'ArrowUp':
        next = Math.max(index - 1, 0);
        break;
      case 'Home':
        next = 0;
        break;
      case 'End':
        next = items.length - 1;
        break;
      default:
        return;
    }
    event.preventDefault();
    const target = items[next];
    if (target !== undefined) focusRow(target.id);
  };

  const running = status === 'running';
  const failed = status === 'failed';
  const compact = density === 'compact';
  const listLabel =
    ariaLabelledBy === undefined ? (ariaLabel ?? t('listLabel')) : undefined;

  let body: ReactNode;
  if (items.length === 0) {
    if (failed) body = null;
    else if (running) {
      body = (
        <p className="text-muted-foreground flex gap-2 px-3 py-2 text-sm">
          <LoaderCircle
            aria-hidden="true"
            className="mt-0.5 size-4 shrink-0 motion-safe:animate-spin"
          />
          <span>{t('running')}</span>
        </p>
      );
    } else {
      body = (
        <p className="text-muted-foreground flex gap-2 px-3 py-2 text-sm">
          <FlaskConical aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>{emptyMessage ?? t('none')}</span>
        </p>
      );
    }
  } else {
    body = (
      <ul
        role="list"
        aria-label={listLabel}
        aria-labelledby={ariaLabelledBy}
        className="divide-border divide-y"
      >
        {items.map((item, index) => {
          const word = statusLabel(item.status);
          const prefix = t('statusPrefix', { status: word });
          const isCurrent = item.id === rovingId;
          const isActive = item.id === activeId;
          const actions = renderActions?.(item, {
            tabIndex: onActivate === undefined || isCurrent ? 0 : -1,
            current: isCurrent,
          });
          const trailing =
            actions === undefined || actions === null ? null : (
              <div className="flex shrink-0 items-center self-start py-1 pr-2">
                {actions}
              </div>
            );

          if (onActivate === undefined) {
            return (
              <li
                key={item.id}
                data-slot="test-result-row"
                className="flex items-start"
              >
                <div className={cn(ROW_GRID, 'min-w-0 flex-1')}>
                  <RowContent
                    item={item}
                    word={word}
                    prefix={prefix}
                    compact={compact}
                  />
                </div>
                {trailing}
              </li>
            );
          }

          return (
            // oxlint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- focus bubbling up from the row's button and actions marks the current row; the row itself takes no input
            <li
              key={item.id}
              data-slot="test-result-row"
              className={cn('flex items-start', isActive && 'bg-muted/60')}
              // A click or Tab into a row's actions makes it the current row.
              onFocus={() => setFocusedId(item.id)}
            >
              <button
                ref={(node) => {
                  if (node === null) rows.current.delete(item.id);
                  else rows.current.set(item.id, node);
                }}
                type="button"
                tabIndex={isCurrent ? 0 : -1}
                aria-current={isActive ? 'true' : undefined}
                onKeyDown={(event) => onRowKeyDown(event, index)}
                onClick={() => onActivate(item)}
                className={cn(
                  ROW_GRID,
                  'focus-visible:ring-ring hover:bg-muted/60 min-w-0 flex-1 focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
                )}
              >
                <RowContent
                  item={item}
                  word={word}
                  prefix={prefix}
                  compact={compact}
                />
              </button>
              {trailing}
            </li>
          );
        })}
      </ul>
    );
  }

  return (
    <div
      data-slot="test-result-list"
      data-status={status}
      // Rows lay out by the list's own width, not the window's.
      className={cn('@container/test-results', className)}
      aria-busy={running || undefined}
    >
      {failed && (
        <p className="text-foreground flex gap-2 px-3 py-2 text-sm">
          <CircleAlert
            aria-hidden="true"
            className="text-destructive mt-0.5 size-4 shrink-0"
          />
          <span>{failedMessage ?? t('listFailed')}</span>
        </p>
      )}
      {body}
    </div>
  );
});

/** A count that pops once when it changes — `CountBadge`'s recipe, on the
 * motion tokens; reduced motion keeps it still. */
function CountPart({ count, status }: { count: number; status: TestStatus }) {
  return (
    <span className="animate-in zoom-in-50 inline-flex items-center gap-1 duration-[var(--duration-medium)] ease-[var(--ease-out-quint)] motion-reduce:animate-none">
      <TestStatusIcon status={status} />
      {count}
    </span>
  );
}

export type TestCountStatus = 'idle' | 'running' | 'failed';

export interface TestCountButtonProps {
  counts: TestCounts;
  /**
   * `running` keeps the last counts and spins the glyph; `failed` says the
   * run did not finish. Defaults to `idle`.
   */
  status?: TestCountStatus;
  /** Whether the panel this button toggles is open (`aria-expanded`). */
  expanded?: boolean;
  /** The id of the panel this button toggles (`aria-controls`). */
  controls?: string;
  onClick?: () => void;
  /** `sm` (32px, toolbars) by default; `default` is the 36px control. */
  size?: 'sm' | 'default';
  className?: string;
}

/**
 * The toggle of a tests panel: `[flask] Tests [✓] 2 [×] 1`, the statuses
 * with none left out. Its accessible name says it in words ("Tests:
 * 2 passed, 1 failed"), since the glyphs alone mean nothing to a screen
 * reader. While tests run the flask turns into a spinner of the same size
 * and the last counts stay, so the toolbar around it never jumps; a failed
 * run shows an alert glyph in its place. A changed number pops once.
 */
export const TestCountButton = forwardRef<
  HTMLButtonElement,
  TestCountButtonProps
>(function TestCountButton(
  {
    counts,
    status = 'idle',
    expanded,
    controls,
    onClick,
    size = 'sm',
    className,
  },
  ref,
) {
  const { t } = useT('testResults');
  const locale = useListLocale();
  const summary = formatTestCounts(t, counts, locale);
  const passed = countOf(counts.passed);
  const failed = countOf(counts.failed);
  const error = countOf(counts.error);

  // Results of the run so far, of any kind; the rest wait or run.
  const settled =
    passed + failed + error + countOf(counts.notRun) + countOf(counts.stale);
  const total = countOf(counts.total);

  let name: string;
  if (status === 'failed') name = t('buttonLabelFailed');
  // With no result in yet, a starting run says so ("Tests: running 3
  // tests…") rather than a bare count of tests.
  else if (status === 'running' && settled === 0 && total > 0) {
    name = t('buttonLabelStarting', { count: total });
  } else if (status === 'running') {
    name = t('buttonLabelRunning', { summary });
  } else name = t('buttonLabel', { summary });

  let glyph: ReactNode;
  if (status === 'running') {
    glyph = (
      <LoaderCircle
        aria-hidden="true"
        className="text-muted-foreground size-4 shrink-0 motion-safe:animate-spin"
      />
    );
  } else if (status === 'failed') {
    glyph = (
      <CircleAlert
        aria-hidden="true"
        className="text-destructive size-4 shrink-0"
      />
    );
  } else {
    glyph = <FlaskConical aria-hidden="true" className="size-4 shrink-0" />;
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
      data-slot="test-count-button"
      data-status={status}
      className={cn(
        // `sm` is 32px tall: keep the box and widen the touch area to 44px
        // on phones, as the Problems button beside it does.
        "relative gap-2 tabular-nums max-sm:after:absolute max-sm:after:-inset-1.5 max-sm:after:content-['']",
        className,
      )}
    >
      {glyph}
      <span>{t('button')}</span>
      {passed > 0 && (
        <CountPart key={`passed-${passed}`} count={passed} status="passed" />
      )}
      {failed > 0 && (
        <CountPart key={`failed-${failed}`} count={failed} status="failed" />
      )}
      {error > 0 && (
        <CountPart key={`error-${error}`} count={error} status="error" />
      )}
    </Button>
  );
});

export interface TestRunAnnouncerProps {
  counts: TestCounts;
  status: TestCountStatus;
  /**
   * Identifies one run worth saying. The announcer says "Running 3
   * tests…" once when a new key starts running and the result once when
   * that key settles — so a host changes the key per run, never per
   * keystroke. The key the announcer mounts with is never spoken; a failed
   * run is left to the host's own message.
   */
  announceKey: string | number;
  /** Leads the result when it answers something ("Saved version 4"). */
  context?: string;
}

/**
 * Speaks a run of tests to screen readers: a visually hidden polite status
 * region. A sentence identical to the last one is spoken again, since the
 * region's content is replaced rather than left unchanged.
 */
export function TestRunAnnouncer({
  counts,
  status,
  announceKey,
  context,
}: TestRunAnnouncerProps) {
  const { t } = useT('testResults');
  const locale = useListLocale();
  const startedKey = useRef<string | number>(announceKey);
  const settledKey = useRef<string | number>(announceKey);
  const [spoken, setSpoken] = useState<{ text: string; serial: number }>({
    text: '',
    serial: 0,
  });

  const { passed, failed, error, notRun, stale, total } = counts;
  useEffect(() => {
    let text: string;
    if (status === 'running') {
      if (startedKey.current === announceKey) return;
      startedKey.current = announceKey;
      text = t('announce.running', { count: countOf(total) });
    } else if (status === 'idle') {
      if (settledKey.current === announceKey) return;
      settledKey.current = announceKey;
      startedKey.current = announceKey;
      const summary = formatTestCounts(
        t,
        { passed, failed, error, notRun, stale, total },
        locale,
      );
      text =
        context === undefined || context === ''
          ? summary
          : t('announce.done', { context, summary });
    } else {
      return;
    }
    setSpoken((previous) => ({ text, serial: previous.serial + 1 }));
  }, [
    announceKey,
    context,
    error,
    failed,
    locale,
    notRun,
    passed,
    stale,
    status,
    t,
    total,
  ]);

  return (
    <div
      role="status"
      aria-live="polite"
      aria-atomic="true"
      className="sr-only"
      data-slot="test-run-announcer"
    >
      {spoken.text === '' ? null : (
        <span key={spoken.serial}>{spoken.text}</span>
      )}
    </div>
  );
}

/** Past this many, the meter is one bar: its segments would be too thin
 * to tell apart. */
const MAX_SEGMENTS = 12;

export interface TestCoverageProps {
  /** How many of the paths a test went down. */
  covered: number;
  /** How many paths there are; with none, nothing is shown. */
  total: number;
  /** Replaces the default "Covers 2 of 3 paths". */
  label?: string;
  /** Makes it a button (the host opens its list of paths). */
  onActivate?: () => void;
  className?: string;
}

/**
 * How many of a document's paths its tests go down: "Covers 2 of 3 paths"
 * beside a meter — a segment per path up to twelve, else one bar. The
 * words are the content; the meter repeats them for the eye, so it is
 * hidden from assistive technology. With `onActivate` it is a button.
 */
export function TestCoverage({
  covered,
  total,
  label,
  onActivate,
  className,
}: TestCoverageProps) {
  const { t } = useT('testResults');
  const all = countOf(total);
  if (all === 0) return null;
  const done = Math.min(countOf(covered), all);
  const words = label ?? t('coverage', { covered: done, total: all });

  const meter =
    all <= MAX_SEGMENTS ? (
      <span aria-hidden="true" className="flex w-16 shrink-0 gap-0.5">
        {Array.from({ length: all }, (_, index) => (
          <span
            key={index}
            data-covered={index < done}
            className={cn(
              'h-1.5 min-w-0 flex-1 rounded-full',
              index < done ? 'bg-primary' : 'bg-muted-foreground/30',
            )}
          />
        ))}
      </span>
    ) : (
      <span
        aria-hidden="true"
        className="bg-muted-foreground/30 relative h-1.5 w-16 shrink-0 overflow-hidden rounded-full"
      >
        <span
          className="bg-primary absolute inset-y-0 left-0 rounded-full"
          style={{ width: `${(done / all) * 100}%` }}
        />
      </span>
    );

  const content = (
    <>
      {meter}
      <span>{words}</span>
    </>
  );

  if (onActivate === undefined) {
    return (
      <span
        data-slot="test-coverage"
        className={cn(
          'text-muted-foreground inline-flex items-center gap-2 text-xs',
          className,
        )}
      >
        {content}
      </span>
    );
  }
  return (
    <button
      type="button"
      data-slot="test-coverage"
      onClick={onActivate}
      className={cn(
        'text-muted-foreground hover:text-foreground focus-visible:ring-ring inline-flex min-h-6 items-center gap-2 rounded-md px-1 text-xs underline-offset-2 hover:underline focus-visible:ring-2 focus-visible:outline-none',
        className,
      )}
    >
      {content}
    </button>
  );
}
