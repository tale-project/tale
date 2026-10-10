'use client';

import { Button } from '@tale/ui/button';
import {
  CodeEditor,
  type CodeEditorDiagnostic,
  type CodeEditorDiagnosticsStatus,
} from '@tale/ui/code-editor';
import { useCopyButton } from '@tale/ui/use-copy';
import { Check, Copy, Download } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';

import { useT } from '@/lib/i18n/client';

import { fieldDiagnostics } from '../lib/code-diagnostics';
import type { RawDocument } from '../lib/draft-document';
import type { AutomationIssueView } from '../lib/issues';
import { engineTemplateScan } from '../lib/template-scanner';
import {
  SOURCE_ISSUE_ANCHOR,
  sourceFileName,
  yamlSource,
} from '../lib/yaml-source';

/** Saves the text as a YAML file under `name`. */
function downloadYaml(text: string, name: string): void {
  const blob = new Blob([text], { type: 'application/yaml;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  document.body.appendChild(link);
  link.click();
  document.body.removeChild(link);
  URL.revokeObjectURL(url);
}

export interface AutomationSourceViewProps {
  /** The document on screen: the draft, or the version shown. */
  document: RawDocument;
  /** The document the check answered for: its problems' places are in it. */
  settled: RawDocument | null;
  /** Every problem the check found, each marked at the place it names. */
  issues: readonly AutomationIssueView[];
  diagnosticsStatus: CodeEditorDiagnosticsStatus;
  automationSlug: string;
  /** The version on screen, for the downloaded file's name. */
  version: number | undefined;
  /** The text holds edits not saved yet. */
  isDraft: boolean;
  /** The view switch, top left as on the canvas. */
  viewSwitch: ReactNode;
  /** Verbs after Copy and Download (the coding-agent entry). */
  actions?: ReactNode;
  /** The automation's verbs, under the text on a phone as on the canvas. */
  toolbar?: ReactNode;
  /** Says how to change the document: the reader may edit it. */
  showEditHint: boolean;
}

/**
 * The Source view: the whole document as YAML, read-only — highlighted,
 * with line numbers, folding and search, and every problem the check found
 * marked at the place it names, so a problem without a field of its own
 * (the tests, the name) has a place to be read. It is copied or downloaded
 * from here; it is changed through the fields or a coding agent.
 */
export function AutomationSourceView({
  document,
  settled,
  issues,
  diagnosticsStatus,
  automationSlug,
  version,
  isDraft,
  viewSwitch,
  actions,
  toolbar,
  showEditHint,
}: AutomationSourceViewProps) {
  const { t } = useT('automations');
  const { t: tCommon } = useT('common');
  const text = useMemo(() => yamlSource(document), [document]);
  const marks = useMemo<{
    diagnostics: CodeEditorDiagnostic[];
    diagnosticsFor: string;
  }>(() => {
    const checked = settled === null ? text : yamlSource(settled);
    return {
      diagnosticsFor: checked,
      // A read-only text takes no one-click fix.
      diagnostics: fieldDiagnostics({
        views: issues,
        fieldPointer: '',
        text: checked,
        kind: 'yaml',
        t,
      }).map(({ fixes: _fixes, ...mark }) => mark),
    };
  }, [settled, text, issues, t]);
  const { copied, onClick: copy } = useCopyButton(text);

  return (
    <div className="flex h-full min-h-0 flex-col" data-slot="source-view">
      <div className="flex flex-wrap items-center justify-between gap-2 p-3">
        {viewSwitch}
        <div className="flex flex-wrap items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={copied ? Check : Copy}
            collapseLabel
            onClick={copy}
          >
            {t('source.copy')}
          </Button>
          <Button
            type="button"
            variant="secondary"
            size="sm"
            icon={Download}
            collapseLabel
            onClick={() => {
              downloadYaml(
                text,
                sourceFileName(automationSlug, version, isDraft),
              );
            }}
          >
            {t('source.download')}
          </Button>
          {actions}
        </div>
      </div>
      {showEditHint && (
        <p className="text-muted-foreground px-3 pb-2 text-xs">
          {t('source.readOnlyHint')}
        </p>
      )}
      <div className="flex min-h-0 flex-1 flex-col px-3 pb-3">
        <CodeEditor
          value={text}
          language="yaml"
          templates
          templateScanner={engineTemplateScan}
          readOnly
          lineNumbers
          fold
          search
          size="md"
          fillHeight
          aria-label={t('source.ariaLabel')}
          diagnostics={marks.diagnostics}
          diagnosticsFor={marks.diagnosticsFor}
          diagnosticsStatus={diagnosticsStatus}
          issueAnchor={SOURCE_ISSUE_ANCHOR}
        />
      </div>
      {toolbar !== undefined && (
        <div className="flex justify-center px-3 pb-3">{toolbar}</div>
      )}
      <span className="sr-only" role="status" aria-live="polite">
        {copied ? tCommon('actions.copied') : ''}
      </span>
    </div>
  );
}
