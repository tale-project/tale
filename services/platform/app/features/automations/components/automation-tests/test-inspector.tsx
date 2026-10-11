'use client';

import { Button } from '@tale/ui/button';
import type { CodeEditorDiagnosticsStatus } from '@tale/ui/code-editor';
import { Tabs } from '@tale/ui/tabs';
import { TestStatusIcon, useTestStatusLabel } from '@tale/ui/test-results';
import { Play } from 'lucide-react';
import { useId } from 'react';

import { useT } from '@/lib/i18n/client';

import type { AutomationTests } from '../../hooks/use-automation-tests';
import type { TestTextContext } from '../../lib/automation-tests/test-text';
import type { AutomationIssueView } from '../../lib/issues';
import { DocumentInspectorHeader } from '../document-inspector-parts';
import { InspectorFrame } from '../node-inspector';
import { TestResultView } from './test-result-view';
import { TestYamlEditor } from './test-yaml-editor';

/** The inspector's two tabs: the test as written, and its latest result. */
export type TestInspectorTab = 'setup' | 'result';

function isTestInspectorTab(value: string): value is TestInspectorTab {
  return value === 'setup' || value === 'result';
}

export interface TestFieldsProps {
  headingId: string;
  tests: AutomationTests;
  index: number;
  /** The same test as the check last saw it. */
  settledTest: unknown;
  issues: readonly AutomationIssueView[];
  diagnosticsStatus: CodeEditorDiagnosticsStatus;
  readOnly: boolean;
  tab: TestInspectorTab;
  onTabChange: (tab: TestInspectorTab) => void;
  text: Pick<TestTextContext, 'nodeLabel' | 'effectLabel'>;
  onSelectNode: (nodeId: string) => void;
  onDeselect?: () => void;
}

/**
 * One test, without a frame (the phone's sheet has its own): its name and
 * place, its status with Run, and two tabs — Setup, the test as YAML, and
 * Result, what its latest run found. The result tab waits until there is a
 * result to show.
 */
export function TestFields({
  headingId,
  tests,
  index,
  settledTest,
  issues,
  diagnosticsStatus,
  readOnly,
  tab,
  onTabChange,
  text,
  onSelectNode,
  onDeselect,
}: TestFieldsProps) {
  const { t } = useT('automations');
  const statusLabel = useTestStatusLabel();
  const row = tests.rows[index];
  if (row === undefined) return null;
  const hasResult = row.outcome.kind !== 'none';
  const shownTab: TestInspectorTab =
    tab === 'result' && !hasResult ? 'setup' : tab;
  const test = tests.tests[index];
  return (
    <div className="flex flex-col gap-3">
      <DocumentInspectorHeader
        headingId={headingId}
        title={row.name}
        description={t('tests.inspector.position', {
          number: index + 1,
          total: tests.tests.length,
        })}
        {...(onDeselect !== undefined && { onDeselect })}
      />
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-foreground inline-flex items-center gap-1.5 text-sm">
          <TestStatusIcon status={row.status} />
          {statusLabel(row.status)}
        </span>
        {row.meta !== undefined && (
          <span className="text-muted-foreground text-xs tabular-nums">
            {row.meta}
          </span>
        )}
        <span className="flex-1" aria-hidden="true" />
        {!readOnly && (
          <Button
            type="button"
            size="sm"
            icon={Play}
            isLoading={row.status === 'running'}
            disabled={tests.runDisabledReason !== undefined}
            {...(tests.runDisabledReason !== undefined && {
              disabledReason: tests.runDisabledReason,
            })}
            aria-label={t('tests.runOne', { name: row.name })}
            onClick={() => tests.runOne(index)}
          >
            {t('tests.run')}
          </Button>
        )}
      </div>
      <Tabs
        variant="underline"
        keepMounted
        value={shownTab}
        onValueChange={(next) => {
          if (isTestInspectorTab(next)) onTabChange(next);
        }}
        listClassName="gap-3"
        items={[
          {
            value: 'setup',
            label: t('tests.inspector.setup'),
            content: (
              <div className="flex flex-col gap-3 pt-3">
                <TestYamlEditor
                  index={index}
                  test={test}
                  settled={settledTest}
                  issues={issues}
                  diagnosticsStatus={diagnosticsStatus}
                  readOnly={readOnly}
                  onCommit={(next) => tests.replace(index, next)}
                />
              </div>
            ),
          },
          {
            value: 'result',
            label: t('tests.inspector.result'),
            disabled: !hasResult,
            content: (
              <div className="flex flex-col gap-3 pt-3">
                <TestResultView
                  row={row}
                  test={test}
                  text={text}
                  onSelectNode={onSelectNode}
                />
              </div>
            ),
          },
        ]}
      />
      {!hasResult && (
        <p className="text-muted-foreground text-xs">
          {t('tests.inspector.noResult')}
        </p>
      )}
    </div>
  );
}

/**
 * The test inspector beside the canvas: the test the Tests panel opened,
 * where a node's inspector sits. Escape or Close hands the width back to
 * the canvas; a new test moves focus into the frame.
 */
export function TestInspector({
  id,
  onDeselect,
  ...rest
}: Omit<TestFieldsProps, 'headingId'> & { id: string }) {
  const headingId = useId();
  return (
    <InspectorFrame
      id={id}
      labelledBy={headingId}
      focusKey={`test-${rest.index}`}
      variant="panel"
      {...(onDeselect !== undefined && { onDeselect })}
    >
      <TestFields
        headingId={headingId}
        {...(onDeselect !== undefined && { onDeselect })}
        {...rest}
      />
    </InspectorFrame>
  );
}
