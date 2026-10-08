'use client';

import { Card } from '@tale/ui/card';
import { cn } from '@tale/ui/cn';
import { IconButton } from '@tale/ui/icon-button';
import {
  IssueList,
  type IssueItem,
  type IssueListHandle,
  type IssueListStatus,
} from '@tale/ui/issue-list';
import { formatIssueCounts, type IssueCounts } from '@tale/ui/issue-summary';
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogTitle,
} from '@tale/ui/responsive-dialog';
import { SegmentedControl } from '@tale/ui/segmented-control';
import { X } from 'lucide-react';
import { forwardRef, useId, type KeyboardEvent, type RefObject } from 'react';

import { useT } from '@/lib/i18n/client';

/** Which problems the list shows. */
export type ProblemsFilter = 'all' | 'errors' | 'warnings';

function isProblemsFilter(value: string): value is ProblemsFilter {
  return value === 'all' || value === 'errors' || value === 'warnings';
}

function filterItems(
  items: readonly IssueItem[],
  filter: ProblemsFilter,
): readonly IssueItem[] {
  if (filter === 'errors') return items.filter((i) => i.severity === 'error');
  if (filter === 'warnings') {
    return items.filter((i) => i.severity === 'warning');
  }
  return items;
}

interface ProblemsContentProps {
  /** Every problem, errors first, in document order. */
  items: readonly IssueItem[];
  counts: IssueCounts;
  status: IssueListStatus;
  /** The problem the reader last went to. */
  activeId: string | null;
  onActivate: (item: IssueItem) => void;
  /**
   * Which problems the list shows. The editor owns it, so opening the panel
   * and a refused save or deploy can show every problem again.
   */
  filter: ProblemsFilter;
  onFilterChange: (next: ProblemsFilter) => void;
}

/** The counts in words — or, while a check runs with none to keep,
 * "Checking…", as the Problems button says. */
function CountsText({
  counts,
  status,
}: {
  counts: IssueCounts;
  status: IssueListStatus;
}) {
  const { t } = useT('issues');
  return status === 'checking' && counts.errors + counts.warnings === 0
    ? t('checking')
    : formatIssueCounts(t, counts);
}

/** The All / Errors / Warnings switch, sized to its labels in every language. */
function ProblemsFilterControl({
  value,
  onChange,
}: {
  value: ProblemsFilter;
  onChange: (next: ProblemsFilter) => void;
}) {
  const { t } = useT('automations');
  return (
    <SegmentedControl
      aria-label={t('problems.filter.label')}
      value={value}
      onValueChange={(next) => {
        if (isProblemsFilter(next)) onChange(next);
      }}
      options={[
        { value: 'all', label: t('problems.filter.all') },
        { value: 'errors', label: t('problems.filter.errors') },
        { value: 'warnings', label: t('problems.filter.warnings') },
      ]}
    />
  );
}

const ProblemsList = forwardRef<
  IssueListHandle,
  Omit<ProblemsContentProps, 'counts' | 'onFilterChange'> & {
    /** The heading that names the list, when the surface has one. */
    labelledBy?: string;
  }
>(function ProblemsList(
  { items, status, activeId, onActivate, filter, labelledBy },
  ref,
) {
  const { t } = useT('automations');
  return (
    <IssueList
      ref={ref}
      issues={filterItems(items, filter)}
      {...(labelledBy === undefined
        ? { 'aria-label': t('problems.title') }
        : { 'aria-labelledby': labelledBy })}
      onActivate={onActivate}
      activeId={activeId}
      status={status}
      viewKey={filter}
      failedMessage={t('problems.checkFailed')}
      {...(filter !== 'all' && {
        emptyMessage: t('problems.emptyFiltered', { filter }),
      })}
    />
  );
});

export interface AutomationProblemsDockProps extends ProblemsContentProps {
  /** The region's id — the Problems button's `aria-controls`. */
  id: string;
  /** Hides the dock; the editor returns focus to the Problems button. */
  onClose: () => void;
}

/**
 * The Problems panel under the canvas, from `lg` up: it spans the canvas
 * column only, so the inspector beside it keeps its height. A header with
 * the counts, the filter and Close over a list that scrolls on its own;
 * Escape anywhere inside closes it. It rises into place once, without
 * movement under reduced motion.
 */
export const AutomationProblemsDock = forwardRef<
  IssueListHandle,
  AutomationProblemsDockProps
>(function AutomationProblemsDock(
  {
    id,
    items,
    counts,
    status,
    activeId,
    onActivate,
    filter,
    onFilterChange,
    onClose,
  },
  ref,
) {
  const { t } = useT('automations');
  const titleId = useId();
  const onKeyDown = (event: KeyboardEvent<HTMLElement>) => {
    if (event.key !== 'Escape') return;
    // The inspector closes on Escape too; this one is the dock's.
    event.preventDefault();
    onClose();
  };
  return (
    <section
      id={id}
      aria-labelledby={titleId}
      onKeyDown={onKeyDown}
      className={cn(
        'border-border bg-background flex min-h-24 shrink flex-col border-t',
        'animate-in fade-in slide-in-from-bottom-2 duration-[var(--duration-standard)] ease-[var(--ease-out-quint)] motion-reduce:animate-none',
      )}
    >
      <div className="flex min-h-9 shrink-0 flex-wrap items-center gap-x-2 gap-y-1 px-3 py-1">
        <h2 id={titleId} className="text-foreground text-sm font-medium">
          {t('problems.title')}
        </h2>
        <span className="text-muted-foreground text-xs tabular-nums">
          <CountsText counts={counts} status={status} />
        </span>
        <ProblemsFilterControl value={filter} onChange={onFilterChange} />
        <span className="flex-1" aria-hidden="true" />
        <IconButton
          icon={X}
          size="sm"
          variant="ghost"
          aria-label={t('problems.hide')}
          onClick={onClose}
        />
      </div>
      <div className="border-border max-h-56 min-h-0 overflow-y-auto border-t">
        <ProblemsList
          ref={ref}
          items={items}
          status={status}
          activeId={activeId}
          onActivate={onActivate}
          filter={filter}
          labelledBy={titleId}
        />
      </div>
    </section>
  );
});

export interface AutomationProblemsSheetProps extends ProblemsContentProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The list's handle, so opening the sheet starts on a problem. */
  listRef: RefObject<IssueListHandle | null>;
  /**
   * The sheet is closing because the reader chose a problem: focus moves on
   * to the field, not back to the Problems button.
   */
  handingOn: boolean;
}

/**
 * The Problems panel below `lg`, where there is no room under the canvas: a
 * sheet with the same filter and list. Choosing a problem closes it and opens
 * the node's own sheet, where focus lands on the field.
 */
export function AutomationProblemsSheet({
  open,
  onOpenChange,
  items,
  counts,
  status,
  activeId,
  onActivate,
  filter,
  onFilterChange,
  listRef,
  handingOn,
}: AutomationProblemsSheetProps) {
  const { t } = useT('automations');
  return (
    <ResponsiveDialog open={open} onOpenChange={onOpenChange}>
      <ResponsiveDialogContent
        closeLabel={t('problems.hide')}
        className="flex max-h-[85dvh] flex-col"
        preventCloseAutoFocus={handingOn}
        onOpenAutoFocus={(event) => {
          // Start on a problem, not on the filter: going to one is what
          // the sheet is for. With no row on show, the dialog's own focus
          // stays, so focus never remains behind the sheet.
          if (filterItems(items, filter).length === 0) return;
          event.preventDefault();
          listRef.current?.focus();
        }}
      >
        {/* One column with its own spacing, so the phone's drawer and the
            tablet's dialog (which spaces its children itself) lay the sheet
            out alike; only the list scrolls. */}
        <div className="flex min-h-0 flex-1 flex-col gap-3">
          <div className="flex flex-col gap-1 pr-8">
            <ResponsiveDialogTitle className="text-base font-semibold">
              {t('problems.title')}
            </ResponsiveDialogTitle>
            <ResponsiveDialogDescription className="text-muted-foreground text-sm tabular-nums">
              <CountsText counts={counts} status={status} />
            </ResponsiveDialogDescription>
          </div>
          <ProblemsFilterControl value={filter} onChange={onFilterChange} />
          <Card padding="none" className="min-h-0 overflow-y-auto">
            <ProblemsList
              ref={listRef}
              items={items}
              status={status}
              activeId={activeId}
              onActivate={onActivate}
              filter={filter}
            />
          </Card>
        </div>
      </ResponsiveDialogContent>
    </ResponsiveDialog>
  );
}
