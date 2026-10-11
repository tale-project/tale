'use client';

import type { IssueListHandle } from '@tale/ui/issue-list';
import { WorkbenchDock } from '@tale/ui/workbench-dock';
import type { Ref } from 'react';

import { useT } from '@/lib/i18n/client';

import type { AutomationEditorPanel } from '../lib/editor-search';
import {
  ProblemsCountsText,
  ProblemsFilterControl,
  ProblemsList,
  type ProblemsContentProps,
} from './automation-problems';
import {
  TestsCountsText,
  TestsPanelActions,
  TestsPanelContent,
  type TestsPanelProps,
} from './automation-tests/automation-tests-panel';

function isPanel(value: string): value is AutomationEditorPanel {
  return value === 'problems' || value === 'tests';
}

export interface AutomationDockProps {
  /** The region's id — the Problems and Tests buttons' `aria-controls`. */
  id: string;
  active: AutomationEditorPanel;
  onActiveChange: (panel: AutomationEditorPanel) => void;
  /** Hides the dock; the editor returns focus to the button that opened
   * the panel on show. */
  onClose: () => void;
  problems: ProblemsContentProps & { listRef: Ref<IssueListHandle> };
  tests: TestsPanelProps;
}

/**
 * The panel under the canvas, from `lg` up: Problems — what the check
 * found, with its filter — and Tests — the automation's tests and their
 * latest results, with Run all and Add test — as two tabs of one dock. Each
 * keeps its scroll, filter and current row while the other is shown.
 */
export function AutomationDock({
  id,
  active,
  onActiveChange,
  onClose,
  problems,
  tests,
}: AutomationDockProps) {
  const { t } = useT('automations');
  const {
    listRef: problemsListRef,
    onFilterChange,
    counts,
    ...list
  } = problems;
  return (
    <WorkbenchDock
      id={id}
      activeId={active}
      onActiveChange={(next) => {
        if (isPanel(next)) onActiveChange(next);
      }}
      panels={[
        {
          id: 'problems',
          label: t('problems.title'),
          badge: <ProblemsCountsText counts={counts} status={list.status} />,
          actions: (
            <ProblemsFilterControl
              value={list.filter}
              onChange={onFilterChange}
            />
          ),
          content: <ProblemsList ref={problemsListRef} {...list} />,
        },
        {
          id: 'tests',
          label: t('tests.title'),
          badge: <TestsCountsText tests={tests.tests} />,
          actions: (
            <TestsPanelActions
              tests={tests.tests}
              canEdit={tests.canEdit}
              onAdd={tests.onAdd}
              {...(tests.addFrom !== undefined && { addFrom: tests.addFrom })}
            />
          ),
          content: <TestsPanelContent {...tests} />,
        },
      ]}
      closeLabel={active === 'tests' ? t('tests.hide') : t('problems.hide')}
      onClose={onClose}
    />
  );
}
