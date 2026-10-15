'use client';

import { CollapsibleDetails } from '@tale/ui/collapsible-details';
import { ExternalLink } from '@tale/ui/external-link';
import { useT } from '@tale/ui/i18n/client';
import { useSwapFade } from '@tale/ui/use-swap-fade';
import {
  CircleAlert,
  CircleCheck,
  CornerDownLeft,
  Info,
  LoaderCircle,
} from 'lucide-react';
import {
  forwardRef,
  useCallback,
  useId,
  useImperativeHandle,
  useLayoutEffect,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';

import { cn } from '../../lib/cn';
import { IssueSeverityIcon, type IssueSeverity } from './issue-severity';

/** One problem, already in the reader's words. */
export interface IssueItem {
  /** Stable across checks, so focus and the current row survive a re-check. */
  id: string;
  severity: IssueSeverity;
  /** Short and specific: what is wrong. */
  title: ReactNode;
  /** Where it is, e.g. "Fetch issues › Input › to". */
  location?: ReactNode;
  /** What the problem means, the same for every problem of its kind. */
  explanation?: ReactNode;
  /** This problem's concrete case. */
  cause?: ReactNode;
  /** What to do about it. */
  fix?: ReactNode;
  /** A stable code, shown small and monospaced for search and support. */
  code?: string;
  /** Raw detail (an engine message), folded under "Technical details". */
  technical?: ReactNode;
  /** Where to read more ("Learn more"); opens in a new tab. */
  docsHref?: string;
  /**
   * Why "go to" cannot take the reader there. Present, the row stays
   * focusable and readable but activating it does nothing, and the reason
   * shows on the row itself — a tooltip would never reach a touch screen.
   */
  unavailableReason?: ReactNode;
}

export interface IssueListHandle {
  /** Focuses the row of `id`, else the list's current row. */
  focus(id?: string): void;
}

export type IssueListStatus = 'ready' | 'checking' | 'stale' | 'failed';

export interface IssueListProps {
  issues: readonly IssueItem[];
  /** Names the list; defaults to "Problems". */
  'aria-label'?: string;
  'aria-labelledby'?: string;
  /**
   * Called when a row is activated ("go to"). Absent, the list is static —
   * no buttons, no roving focus — for node panels, run pages and other
   * read-only views.
   */
  onActivate?: (issue: IssueItem) => void;
  /** The row the host is showing (marked `aria-current`). */
  activeId?: string | null;
  /** `compact` shows the title, location and fix only. */
  density?: 'comfortable' | 'compact';
  /**
   * `checking` and `stale` dim the rows (and `checking` marks the list
   * busy) while a newer result is on its way; `failed` says the last check
   * did not finish above whatever the list still shows, at full contrast.
   * The dim is meant for a moment — dimmed text is below AA contrast — so a
   * result that stays out of date says so with `failed`.
   */
  status?: IssueListStatus;
  /** Replaces the default "couldn't check" sentence. */
  failedMessage?: ReactNode;
  /** Replaces the default "No problems". */
  emptyMessage?: ReactNode;
  /**
   * Names the view the list shows (a filter). A new key fades the rows in,
   * so a swapped list reads as a change rather than a flicker.
   */
  viewKey?: string;
  className?: string;
}

/**
 * The row grid: icon · title and location · code and "go to". The list is a
 * size container, and the trailing column needs room: below 32rem (a phone,
 * a side panel) the code drops under the location instead, so a long title
 * keeps the width to wrap in. Every row is at least 36px tall.
 */
const ROW_GRID =
  'grid min-h-9 w-full grid-cols-[1rem_minmax(0,1fr)] gap-x-2 gap-y-0.5 px-3 py-2 text-left @lg/issue-list:grid-cols-[1rem_minmax(0,1fr)_auto]';

/** The grid row the code takes in a narrow list: the first one free under
 * the title, after the location and the "can't go there" reason. */
const NARROW_CODE_ROW = ['row-start-2', 'row-start-3', 'row-start-4'] as const;

/** Opacity changes on the motion tokens; reduced motion makes them instant. */
const FADE =
  'transition-opacity duration-[var(--duration-short)] ease-[var(--ease-out-quint)] motion-reduce:transition-none';

interface IssueDetailIds {
  explanation?: string;
  cause?: string;
}

export interface IssueDetailProps {
  issue: IssueItem;
  density?: 'comfortable' | 'compact';
  /** Extra controls after the detail (a host's own buttons). */
  actions?: ReactNode;
  /**
   * Prefix for the explanation's and cause's ids, so a row can point its
   * `aria-describedby` at them. Generated when omitted.
   */
  idBase?: string;
  /**
   * Whether "Technical details" and "Learn more" are in the tab order. A
   * roving list passes `false` for every row but the current one.
   */
  tabbable?: boolean;
  /** Indented to the title column by default (`pl-9`); override to align elsewhere. */
  className?: string;
}

function detailIds(base: string, issue: IssueItem): IssueDetailIds {
  return {
    explanation:
      issue.explanation === undefined ? undefined : `${base}-explanation`,
    cause: issue.cause === undefined ? undefined : `${base}-cause`,
  };
}

/**
 * A problem's explanation, cause and fix, then its technical details and a
 * link to read more. Renders nothing when the issue carries none of them.
 */
export function IssueDetail({
  issue,
  density = 'comfortable',
  actions,
  idBase,
  tabbable = true,
  className,
}: IssueDetailProps) {
  const { t } = useT('issues');
  const generated = useId();
  const ids = detailIds(idBase ?? generated, issue);
  const comfortable = density === 'comfortable';
  const tabIndex = tabbable ? undefined : -1;

  const hasBody =
    issue.fix !== undefined ||
    actions !== undefined ||
    (comfortable &&
      (issue.explanation !== undefined ||
        issue.cause !== undefined ||
        issue.technical !== undefined ||
        issue.docsHref !== undefined));
  if (!hasBody) return null;

  return (
    <div
      data-slot="issue-detail"
      className={cn('space-y-1 pr-3 pb-2 pl-9 text-sm', className)}
    >
      {comfortable && issue.explanation !== undefined && (
        <p id={ids.explanation} className="text-muted-foreground">
          {issue.explanation}
        </p>
      )}
      {comfortable && issue.cause !== undefined && (
        <p id={ids.cause} className="text-foreground">
          {issue.cause}
        </p>
      )}
      {issue.fix !== undefined && (
        <p className="text-foreground">
          <span className="font-medium">{t('fixLabel')}</span> {issue.fix}
        </p>
      )}
      {comfortable && issue.technical !== undefined && (
        <CollapsibleDetails
          variant="compact"
          summary={t('technicalDetails')}
          summaryTabIndex={tabIndex}
          // A 24px target, apart from "Learn more" below it.
          className="pt-0.5 [&>summary]:py-1"
        >
          <div className="text-muted-foreground mt-1 font-mono text-xs break-words whitespace-pre-wrap">
            {issue.technical}
          </div>
        </CollapsibleDetails>
      )}
      {comfortable && issue.docsHref !== undefined && (
        <p className="pt-1 text-xs">
          <ExternalLink
            href={issue.docsHref}
            tabIndex={tabIndex}
            className="text-foreground inline-flex min-h-6 items-center font-medium underline underline-offset-2"
          >
            {t('learnMore')}
          </ExternalLink>
        </p>
      )}
      {actions !== undefined && (
        <div className="flex flex-wrap items-center gap-2 pt-1">{actions}</div>
      )}
    </div>
  );
}

/**
 * A row's content on the row grid: the severity glyph, then the title over
 * the location (and, for a row "go to" cannot act on, the reason), then the
 * code over the "go to" hint on the trailing edge.
 */
function RowContent({
  issue,
  srPrefix,
  reasonId,
  goTo,
}: {
  issue: IssueItem;
  srPrefix: string;
  reasonId?: string;
  /** The "go to" hint's label; absent on a static or unavailable row. */
  goTo?: string;
}) {
  const hasLocation = issue.location !== undefined;
  const narrowCodeRow =
    NARROW_CODE_ROW[(hasLocation ? 1 : 0) + (reasonId === undefined ? 0 : 1)];
  return (
    <>
      <IssueSeverityIcon
        severity={issue.severity}
        className="col-start-1 row-start-1 mt-0.5"
      />
      <span className="text-foreground col-start-2 row-start-1 text-sm font-medium break-words">
        <span className="sr-only">{srPrefix}</span> {issue.title}
      </span>
      {hasLocation && (
        <span className="text-muted-foreground col-start-2 row-start-2 text-xs break-words">
          {issue.location}
        </span>
      )}
      {reasonId !== undefined && (
        // Read through the row's `aria-describedby`, not as part of its name.
        <span
          id={reasonId}
          aria-hidden="true"
          className={cn(
            'text-muted-foreground col-start-2 flex gap-1 text-xs break-words',
            hasLocation ? 'row-start-3' : 'row-start-2',
          )}
        >
          <Info className="mt-0.5 size-3 shrink-0" />
          <span className="min-w-0">{issue.unavailableReason}</span>
        </span>
      )}
      {(issue.code !== undefined || goTo !== undefined) && (
        // Narrow: the code on a line of its own under the title column, and
        // no "go to" hint — the whole row is the button, and nothing hovers
        // a phone. Wide: both on the trailing edge.
        <span
          aria-hidden="true"
          className={cn(
            'col-start-2 gap-0.5 @lg/issue-list:col-start-3 @lg/issue-list:row-span-2 @lg/issue-list:row-start-1 @lg/issue-list:flex @lg/issue-list:flex-col @lg/issue-list:items-end',
            narrowCodeRow,
            issue.code === undefined ? 'hidden' : 'flex',
          )}
        >
          {issue.code !== undefined && (
            <span className="text-muted-foreground font-mono text-xs break-words">
              {issue.code}
            </span>
          )}
          {goTo !== undefined && (
            <span
              className={cn(
                'text-muted-foreground hidden items-center gap-1 text-xs opacity-0 group-hover/issue:opacity-100 group-focus-visible/issue:opacity-100 @lg/issue-list:inline-flex',
                FADE,
              )}
            >
              <CornerDownLeft className="size-3.5" />
              {goTo}
            </span>
          )}
        </span>
      )}
    </>
  );
}

/**
 * A list of problems — validation results, refused saves, failed checks.
 * Errors and warnings read by icon shape and a visually hidden "Error:"
 * prefix, never by colour alone.
 *
 * With `onActivate` every row is a button that takes the reader to the
 * problem: the list is one tab stop, ↑/↓ and Home/End move between rows, and
 * Enter or Space activates. A row's "Technical details" and "Learn more"
 * join the tab order only while that row is the current one, so Tab goes
 * row → its details → out. Without `onActivate` the rows are plain text.
 *
 * The list is a size container (`@container/issue-list`) and fills the
 * width of its column; under 32rem a row's code moves under its title.
 */
export const IssueList = forwardRef<IssueListHandle, IssueListProps>(
  function IssueList(
    {
      issues,
      'aria-label': ariaLabel,
      'aria-labelledby': ariaLabelledBy,
      onActivate,
      activeId = null,
      density = 'comfortable',
      status = 'ready',
      failedMessage,
      emptyMessage,
      viewKey,
      className,
    },
    ref,
  ) {
    const { t } = useT('issues');
    const baseId = useId();
    const rows = useRef(new Map<string, HTMLButtonElement>());
    const swapRef = useSwapFade<HTMLDivElement>(viewKey);
    const [focusedId, setFocusedId] = useState<string | null>(null);

    const listed = (id: string | null): id is string =>
      id !== null && issues.some((issue) => issue.id === id);
    // The one tab stop: the row last focused while it is still listed, else
    // the row the host shows, else the first.
    const rovingId = listed(focusedId)
      ? focusedId
      : listed(activeId)
        ? activeId
        : (issues[0]?.id ?? null);

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
          next = Math.min(index + 1, issues.length - 1);
          break;
        case 'ArrowUp':
          next = Math.max(index - 1, 0);
          break;
        case 'Home':
          next = 0;
          break;
        case 'End':
          next = issues.length - 1;
          break;
        default:
          return;
      }
      event.preventDefault();
      const target = issues[next];
      if (target !== undefined) focusRow(target.id);
    };

    // A newer result is on its way: the rows step back until it lands.
    const dimmed = status === 'checking' || status === 'stale';
    const failed = status === 'failed';
    const listLabel =
      ariaLabelledBy === undefined ? (ariaLabel ?? t('listLabel')) : undefined;
    const dimClass = cn(FADE, dimmed && 'opacity-60');

    return (
      <div
        ref={swapRef}
        data-slot="issue-list"
        data-status={status}
        // Rows lay out by the list's own width, not the window's.
        className={cn('@container/issue-list', className)}
        aria-busy={status === 'checking' || undefined}
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
        {issues.length === 0 ? (
          failed ? null : status === 'checking' ? (
            // Nothing to keep on screen: a running check claims nothing,
            // as the count button beside the list does.
            <p className="text-muted-foreground flex gap-2 px-3 py-2 text-sm">
              <LoaderCircle
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0 motion-safe:animate-spin"
              />
              <span>{t('checking')}</span>
            </p>
          ) : (
            <p
              className={cn(
                'text-muted-foreground flex gap-2 px-3 py-2 text-sm',
                dimClass,
              )}
            >
              <CircleCheck
                aria-hidden="true"
                className="mt-0.5 size-4 shrink-0"
              />
              <span>{emptyMessage ?? t('none')}</span>
            </p>
          )
        ) : (
          <ul
            role="list"
            aria-label={listLabel}
            aria-labelledby={ariaLabelledBy}
            className={cn('divide-border divide-y', dimClass)}
          >
            {issues.map((issue, index) => {
              const rowBase = `${baseId}-${index}`;
              const srPrefix = t(`srPrefix.${issue.severity}`);

              if (onActivate === undefined) {
                return (
                  <li key={issue.id} data-slot="issue-row">
                    <div className={ROW_GRID}>
                      <RowContent issue={issue} srPrefix={srPrefix} />
                    </div>
                    <IssueDetail
                      issue={issue}
                      density={density}
                      idBase={rowBase}
                    />
                  </li>
                );
              }

              const ids = detailIds(rowBase, issue);
              const isCurrent = issue.id === rovingId;
              const isActive = issue.id === activeId;
              const unavailable = issue.unavailableReason !== undefined;
              const reasonId = unavailable ? `${rowBase}-reason` : undefined;
              const describedBy =
                [ids.explanation, ids.cause, reasonId]
                  .filter((id) => id !== undefined)
                  .join(' ') || undefined;
              return (
                <li key={issue.id} data-slot="issue-row">
                  <button
                    ref={(node) => {
                      if (node === null) rows.current.delete(issue.id);
                      else rows.current.set(issue.id, node);
                    }}
                    type="button"
                    tabIndex={isCurrent ? 0 : -1}
                    aria-current={isActive ? 'true' : undefined}
                    aria-disabled={unavailable ? 'true' : undefined}
                    aria-describedby={describedBy}
                    onFocus={() => setFocusedId(issue.id)}
                    onKeyDown={(event) => onRowKeyDown(event, index)}
                    onClick={() => {
                      if (!unavailable) onActivate(issue);
                    }}
                    className={cn(
                      ROW_GRID,
                      'group/issue focus-visible:ring-ring focus-visible:ring-2 focus-visible:outline-none focus-visible:ring-inset',
                      unavailable ? 'cursor-default' : 'hover:bg-muted/60',
                      isActive && 'bg-muted/60',
                    )}
                  >
                    <RowContent
                      issue={issue}
                      srPrefix={srPrefix}
                      reasonId={reasonId}
                      goTo={unavailable ? undefined : t('goTo')}
                    />
                  </button>
                  <IssueDetail
                    issue={issue}
                    density={density}
                    idBase={rowBase}
                    tabbable={isCurrent}
                  />
                </li>
              );
            })}
          </ul>
        )}
      </div>
    );
  },
);
