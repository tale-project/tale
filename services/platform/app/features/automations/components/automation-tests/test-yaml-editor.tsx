'use client';

import {
  CodeEditor,
  type CodeEditorDiagnosticsStatus,
} from '@tale/ui/code-editor';
import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { parseYaml, stringifyYaml } from '@/lib/shared/config/yaml';
import { stableStringify } from '@/lib/shared/utils/stable-stringify';

import { fieldDiagnostics } from '../../lib/code-diagnostics';
import type { AutomationIssueView } from '../../lib/issues';

/** A test as the editor shows it: the document's own YAML rendering, every
 * key in its order, multi-line text as literal blocks, no line folded. */
export function testYaml(test: unknown): string {
  return stringifyYaml(test ?? {}, { lineWidth: 0, literalBlocks: true });
}

/** The anchor "go to" a problem inside a test lands on. */
export function testIssueAnchor(index: number): string {
  return `/tests/${index}`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface TestYamlEditorProps {
  index: number;
  /** The test as the draft holds it. */
  test: unknown;
  /** The same test as the check last saw it: its problems' places are in
   * its text. */
  settled: unknown;
  issues: readonly AutomationIssueView[];
  diagnosticsStatus: CodeEditorDiagnosticsStatus;
  readOnly: boolean;
  /** A text that parses to a test: the draft takes it as written. */
  onCommit: (test: Record<string, unknown>) => void;
}

/**
 * One test as YAML, edited as text: the draft changes only when the text
 * parses to a mapping, and the text is the author's own — the draft's test
 * coming back from an edit never rewrites it, so the caret stays where it
 * was. A test that changes for another reason (Discard, another version)
 * replaces the text. Problems the check found in the test are marked at
 * the place their pointers name.
 */
export function TestYamlEditor({
  index,
  test,
  settled,
  issues,
  diagnosticsStatus,
  readOnly,
  onCommit,
}: TestYamlEditorProps) {
  const { t } = useT('automations');
  const hintId = useId();
  const [text, setText] = useState(() => testYaml(test));
  /** The test this editor last committed or showed, by content. */
  const committed = useRef(stableStringify(test ?? null));

  useEffect(() => {
    const next = stableStringify(test ?? null);
    if (next === committed.current) return;
    committed.current = next;
    setText(testYaml(test));
  }, [test]);

  const settledText = useMemo(() => testYaml(settled), [settled]);
  const diagnostics = useMemo(
    () =>
      fieldDiagnostics({
        views: issues,
        fieldPointer: testIssueAnchor(index),
        text: settledText,
        kind: 'yaml',
        t,
      }),
    [issues, index, settledText, t],
  );

  return (
    <div className="flex flex-col gap-2">
      <CodeEditor
        value={text}
        language="yaml"
        size="sm"
        lineNumbers
        minRows={8}
        maxRows={24}
        expandable={{ title: t('tests.inspector.yaml') }}
        readOnly={readOnly}
        aria-label={t('tests.inspector.yaml')}
        {...(!readOnly && { 'aria-describedby': hintId })}
        diagnostics={diagnostics}
        diagnosticsFor={settledText}
        diagnosticsStatus={diagnosticsStatus}
        issueAnchor={testIssueAnchor(index)}
        onChange={(next) => {
          setText(next);
          const parsed = parseYaml(next);
          if (!parsed.ok || !isRecord(parsed.data)) return;
          committed.current = stableStringify(parsed.data);
          onCommit(parsed.data);
        }}
      />
      {!readOnly && (
        <p id={hintId} className="text-muted-foreground text-xs">
          {t('tests.inspector.yamlHint')}
        </p>
      )}
    </div>
  );
}
