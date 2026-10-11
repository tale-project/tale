'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { DropdownMenu } from '@tale/ui/dropdown-menu';
import { EmptyState } from '@tale/ui/empty-state';
import { IconButton } from '@tale/ui/icon-button';
import {
  formatTestCounts,
  TestCoverage,
  TestResultList,
  type TestResultItem,
  type TestResultListHandle,
} from '@tale/ui/test-results';
import { WorkbenchSheet } from '@tale/ui/workbench-dock';
import {
  ChevronDown,
  Copy,
  EllipsisVertical,
  Eye,
  FlaskConical,
  Play,
  Plus,
  Route,
  Trash2,
  Zap,
} from 'lucide-react';
import { useEffect, useMemo, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { useT } from '@/lib/i18n/client';

import {
  testRowId,
  type AutomationTests,
  type TestRow,
} from '../../hooks/use-automation-tests';
import { testRunOf } from '../../lib/automation-tests/transient-run';

/** A test's chips: text, never a control (they sit inside the row). */
function Chips({ labels }: { labels: readonly string[] }) {
  if (labels.length === 0) return null;
  return labels.map((label) => (
    <span
      key={label}
      className="border-border text-muted-foreground rounded-md border px-1.5 py-0.5 text-xs leading-4"
    >
      {label}
    </span>
  ));
}

/** The counts in words, as the Tests button says them. */
export function TestsCountsText({ tests }: { tests: AutomationTests }) {
  const { t } = useT('testResults');
  const { i18n } = useTranslation();
  return formatTestCounts(
    t,
    tests.counts,
    i18n?.resolvedLanguage ?? i18n?.language ?? 'en',
  );
}

export interface TestsPanelProps {
  tests: AutomationTests;
  /** The reader may change the draft's tests and run them. */
  canEdit: boolean;
  /** The test open in the inspector. */
  activeIndex: number | null;
  /** Opens a test in the inspector. */
  onOpen: (index: number) => void;
  /** Adds a blank test and opens it. */
  onAdd: () => void;
  /** Other tests to start from: the trigger's input, an untested path. */
  addFrom?: AddTestSources;
  /** How many of the possible paths the tests go down; none while it
   * cannot be said (one path, too many to list, no test ran). */
  coverage?: { covered: number; total: number; onShowPaths?: () => void };
  /** Says a deleted test is gone (the editor's live region). */
  onDeleted?: (name: string) => void;
  /** Lays a test's latest run over the canvas. */
  onShowRun?: (index: number) => void;
  /** The list's handle: the panel's opener focuses its current row. */
  listRef: RefObject<TestResultListHandle | null>;
}

/** Where a new test can start from, beside a blank one. */
export interface AddTestSources {
  /** The input the bound trigger hands a run. */
  trigger?: () => void;
  /** The possible paths no test goes down yet, each a test for it. */
  paths?: ReadonlyArray<{ id: string; label: string; onSelect: () => void }>;
}

/** Add test: a blank test, or one from the trigger's input or for a path
 * no test goes down — a menu when there is more than a blank one. */
function AddTestControl({
  onAdd,
  addFrom,
  variant,
}: {
  onAdd: () => void;
  addFrom?: AddTestSources;
  variant: 'primary' | 'secondary';
}) {
  const { t } = useT('automations');
  const paths = addFrom?.paths;
  if (addFrom?.trigger === undefined && paths === undefined) {
    return (
      <Button
        type="button"
        size="sm"
        variant={variant}
        icon={Plus}
        onClick={onAdd}
      >
        {t('tests.add')}
      </Button>
    );
  }
  return (
    <DropdownMenu
      align="end"
      trigger={
        <Button type="button" size="sm" variant={variant} icon={Plus}>
          {t('tests.add')}
          <ChevronDown aria-hidden="true" className="size-4" />
        </Button>
      }
      items={() => [
        [
          {
            type: 'item',
            label: t('tests.addFrom.blank'),
            icon: Plus,
            onClick: onAdd,
          },
          ...(addFrom?.trigger === undefined
            ? []
            : [
                {
                  type: 'item' as const,
                  label: t('tests.addFrom.trigger'),
                  icon: Zap,
                  onClick: addFrom.trigger,
                },
              ]),
          ...(paths === undefined
            ? []
            : paths.length === 0
              ? [
                  {
                    type: 'item' as const,
                    label: t('tests.addFrom.allTested'),
                    icon: Route,
                    disabled: true,
                  },
                ]
              : [
                  {
                    type: 'sub' as const,
                    label: t('tests.addFrom.path'),
                    icon: Route,
                    items: [
                      paths.map((path) => ({
                        type: 'item' as const,
                        label: path.label,
                        onClick: path.onSelect,
                      })),
                    ],
                  },
                ]),
        ],
      ]}
    />
  );
}

/** Run all and Add test, in the panel's header. */
export function TestsPanelActions({
  tests,
  canEdit,
  onAdd,
  addFrom,
}: Pick<TestsPanelProps, 'tests' | 'canEdit' | 'onAdd' | 'addFrom'>) {
  const { t } = useT('automations');
  if (!canEdit) return null;
  return (
    <div className="flex items-center gap-1">
      {tests.tests.length > 0 && (
        <Button
          type="button"
          size="sm"
          icon={Play}
          isLoading={tests.status === 'running'}
          disabled={tests.runDisabledReason !== undefined}
          {...(tests.runDisabledReason !== undefined && {
            disabledReason: tests.runDisabledReason,
          })}
          onClick={tests.runAll}
        >
          {t('tests.runAll')}
        </Button>
      )}
      <AddTestControl
        onAdd={onAdd}
        {...(addFrom !== undefined && { addFrom })}
        variant="secondary"
      />
    </div>
  );
}

/**
 * The Tests panel's content: where the results come from, why the last run
 * did not finish, and one row per test in the document's order — its
 * status, name, first failure in words, duration and what it simulates.
 * A row opens its test; its menu runs, copies or deletes it. A deleted
 * test comes back with the draft's Discard.
 */
export function TestsPanelContent({
  tests,
  canEdit,
  activeIndex,
  onOpen,
  onAdd,
  addFrom,
  coverage,
  onDeleted,
  onShowRun,
  listRef,
}: TestsPanelProps) {
  const { t } = useT('automations');
  /** The place a deleted test had: focus goes to the row there now — the
   * next test — else the one before, never out of the list. */
  const [focusAfterDelete, setFocusAfterDelete] = useState<number | null>(null);
  const rowCount = tests.rows.length;
  useEffect(() => {
    if (focusAfterDelete === null) return undefined;
    const frame = requestAnimationFrame(() => {
      const target = Math.min(focusAfterDelete, rowCount - 1);
      if (target >= 0) listRef.current?.focus(testRowId(target));
      setFocusAfterDelete(null);
    });
    return () => cancelAnimationFrame(frame);
  }, [focusAfterDelete, rowCount, listRef]);
  const byId = useMemo(
    () => new Map(tests.rows.map((row) => [row.id, row])),
    [tests.rows],
  );
  const items = useMemo<TestResultItem[]>(
    () =>
      tests.rows.map((row) => ({
        id: row.id,
        name: row.name,
        status: row.status,
        ...(row.reason !== undefined && { reason: row.reason }),
        ...(row.meta !== undefined && { meta: row.meta }),
        ...(row.badges.length > 0 && {
          badges: <Chips labels={row.badges} />,
        }),
      })),
    [tests.rows],
  );
  const active =
    activeIndex === null ? null : (tests.rows[activeIndex]?.id ?? null);

  if (tests.tests.length === 0) {
    return (
      <EmptyState
        icon={FlaskConical}
        headingLevel={3}
        title={t('tests.empty.title')}
        description={t('tests.empty.body')}
        {...(canEdit && {
          action: (
            <AddTestControl
              onAdd={onAdd}
              {...(addFrom !== undefined && { addFrom })}
              variant="primary"
            />
          ),
        })}
      />
    );
  }

  const rowActions = (item: TestResultItem, tabIndex: 0 | -1) => {
    const row = byId.get(item.id);
    if (row === undefined || !canEdit) return null;
    return (
      <DropdownMenu
        align="end"
        trigger={
          <IconButton
            icon={EllipsisVertical}
            size="sm"
            variant="ghost"
            tabIndex={tabIndex}
            aria-label={t('tests.rowActions', { name: row.name })}
          />
        }
        items={() => [
          [
            {
              type: 'item',
              label: t('tests.run'),
              icon: Play,
              disabled: tests.runDisabledReason !== undefined,
              onClick: () => tests.runOne(row.index),
            },
            ...(onShowRun !== undefined && testRunOf(row.outcome) !== null
              ? [
                  {
                    type: 'item' as const,
                    label: t('tests.showOnCanvas'),
                    icon: Eye,
                    onClick: () => onShowRun(row.index),
                  },
                ]
              : []),
            {
              type: 'item',
              label: t('tests.duplicate'),
              icon: Copy,
              onClick: () => {
                const copied = tests.duplicate(row.index);
                if (copied !== null) onOpen(copied);
              },
            },
            {
              type: 'item',
              label: t('tests.delete'),
              icon: Trash2,
              destructive: true,
              onClick: () => remove(row),
            },
          ],
        ]}
      />
    );
  };

  const remove = (row: TestRow) => {
    tests.remove(row.index);
    onDeleted?.(row.name);
    setFocusAfterDelete(row.index);
  };

  return (
    <div className="flex flex-col">
      <div className="flex flex-wrap items-center justify-between gap-x-4 gap-y-1 px-3 pt-2">
        <p className="text-muted-foreground text-xs">{tests.source}</p>
        {coverage !== undefined && (
          <TestCoverage
            covered={coverage.covered}
            total={coverage.total}
            {...(coverage.onShowPaths !== undefined && {
              onActivate: coverage.onShowPaths,
            })}
          />
        )}
      </div>
      {tests.failure !== null && (
        <div className="px-3 pt-2">
          <Alert
            variant={
              tests.failure.retryAt === undefined ? 'destructive' : 'warning'
            }
            title={tests.failure.title}
            {...(tests.failure.description !== undefined && {
              description: tests.failure.description,
            })}
          />
          {tests.failure.retryAt === undefined && canEdit && (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              className="mt-2"
              onClick={tests.retry}
            >
              {t('tests.retry')}
            </Button>
          )}
        </div>
      )}
      <TestResultList
        ref={listRef}
        items={items}
        aria-label={t('tests.listLabel')}
        activeId={active}
        status={tests.status === 'running' ? 'running' : 'ready'}
        onActivate={(item) => {
          const row = byId.get(item.id);
          if (row !== undefined) onOpen(row.index);
        }}
        renderActions={(item, row) => rowActions(item, row.tabIndex)}
      />
    </div>
  );
}

export interface TestsSheetProps extends TestsPanelProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  /** The sheet is closing because the reader opened a test: focus moves
   * on to the test's own sheet, not back to the Tests button. */
  handingOn?: boolean;
}

/** The Tests panel below `lg`, where there is no room under the canvas: a
 * sheet with the same verbs and list. */
export function AutomationTestsSheet({
  open,
  onOpenChange,
  handingOn = false,
  ...panel
}: TestsSheetProps) {
  const { t } = useT('automations');
  return (
    <WorkbenchSheet
      open={open}
      onOpenChange={onOpenChange}
      title={t('tests.title')}
      description={<TestsCountsText tests={panel.tests} />}
      actions={
        <TestsPanelActions
          tests={panel.tests}
          canEdit={panel.canEdit}
          onAdd={panel.onAdd}
          {...(panel.addFrom !== undefined && { addFrom: panel.addFrom })}
        />
      }
      closeLabel={t('tests.hide')}
      preventCloseAutoFocus={handingOn}
      onOpenAutoFocus={(event) => {
        if (panel.tests.tests.length === 0) return;
        event.preventDefault();
        panel.listRef.current?.focus();
      }}
    >
      <TestsPanelContent {...panel} />
    </WorkbenchSheet>
  );
}
