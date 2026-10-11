'use client';

import { Alert } from '@tale/ui/alert';
import { Button } from '@tale/ui/button';
import { DropdownMenu } from '@tale/ui/dropdown-menu';
import { EmptyState } from '@tale/ui/empty-state';
import { IconButton } from '@tale/ui/icon-button';
import {
  formatTestCounts,
  TestResultList,
  type TestResultItem,
  type TestResultListHandle,
} from '@tale/ui/test-results';
import { WorkbenchSheet } from '@tale/ui/workbench-dock';
import {
  Copy,
  EllipsisVertical,
  FlaskConical,
  Play,
  Plus,
  Trash2,
} from 'lucide-react';
import { useEffect, useMemo, useState, type RefObject } from 'react';
import { useTranslation } from 'react-i18next';

import { useT } from '@/lib/i18n/client';

import {
  testRowId,
  type AutomationTests,
  type TestRow,
} from '../../hooks/use-automation-tests';

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
  /** Says a deleted test is gone (the editor's live region). */
  onDeleted?: (name: string) => void;
  /** The list's handle: the panel's opener focuses its current row. */
  listRef: RefObject<TestResultListHandle | null>;
}

/** Run all and Add test, in the panel's header. */
export function TestsPanelActions({
  tests,
  canEdit,
  onAdd,
}: Pick<TestsPanelProps, 'tests' | 'canEdit' | 'onAdd'>) {
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
      <Button
        type="button"
        size="sm"
        variant="secondary"
        icon={Plus}
        onClick={onAdd}
      >
        {t('tests.add')}
      </Button>
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
  onDeleted,
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
            <Button type="button" size="sm" icon={Plus} onClick={onAdd}>
              {t('tests.add')}
            </Button>
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
      <p className="text-muted-foreground px-3 pt-2 text-xs">{tests.source}</p>
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
