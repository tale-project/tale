'use client';

import {
  IssueList,
  type IssueItem,
  type IssueListHandle,
  type IssueListStatus,
} from '@tale/ui/issue-list';
import { formatIssueCounts, type IssueCounts } from '@tale/ui/issue-summary';
import { SegmentedControl } from '@tale/ui/segmented-control';
import { WorkbenchDock, WorkbenchSheet } from '@tale/ui/workbench-dock';
import { forwardRef, type RefObject } from 'react';

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
  Omit<ProblemsContentProps, 'counts' | 'onFilterChange'>
>(function ProblemsList({ items, status, activeId, onActivate, filter }, ref) {
  const { t } = useT('automations');
  return (
    <IssueList
      ref={ref}
      issues={filterItems(items, filter)}
      aria-label={t('problems.title')}
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
 * The Problems panel under the canvas, from `lg` up: the workbench dock
 * with one panel — the counts, the filter and Close over the list.
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
  return (
    <WorkbenchDock
      id={id}
      activeId="problems"
      panels={[
        {
          id: 'problems',
          label: t('problems.title'),
          badge: <CountsText counts={counts} status={status} />,
          actions: (
            <ProblemsFilterControl value={filter} onChange={onFilterChange} />
          ),
          content: (
            <ProblemsList
              ref={ref}
              items={items}
              status={status}
              activeId={activeId}
              onActivate={onActivate}
              filter={filter}
            />
          ),
        },
      ]}
      closeLabel={t('problems.hide')}
      onClose={onClose}
    />
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
    <WorkbenchSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('problems.title')}
      description={<CountsText counts={counts} status={status} />}
      actions={
        <ProblemsFilterControl value={filter} onChange={onFilterChange} />
      }
      closeLabel={t('problems.hide')}
      preventCloseAutoFocus={handingOn}
      onOpenAutoFocus={(event) => {
        // Start on a problem, not on the filter: going to one is what the
        // sheet is for. With no row on show, the dialog's own focus stays,
        // so focus never remains behind the sheet.
        if (filterItems(items, filter).length === 0) return;
        event.preventDefault();
        listRef.current?.focus();
      }}
    >
      <ProblemsList
        ref={listRef}
        items={items}
        status={status}
        activeId={activeId}
        onActivate={onActivate}
        filter={filter}
      />
    </WorkbenchSheet>
  );
}
