'use client';

import { Badge } from '@tale/ui/badge';
import { cn } from '@tale/ui/cn';
import type { CodeEditorProviders } from '@tale/ui/code-editor/providers';
import type { FlowRow } from '@tale/ui/flow/types';
import { IconButton } from '@tale/ui/icon-button';
import { SectionHeader } from '@tale/ui/section-header';
import { X } from 'lucide-react';
import { useMemo, type ReactNode } from 'react';

import { useT } from '@/lib/i18n/client';

import { fieldDiagnostics } from '../lib/code-diagnostics';
import type { RawDocument } from '../lib/draft-document';
import { fieldIssueMessage, type AutomationIssueView } from '../lib/issues';
import { engineTemplateScan } from '../lib/template-scanner';
import {
  JsonCodeField,
  jsonFieldText,
  type JsonExpect,
} from './json-code-field';
import type { InspectorContext } from './node-inspector';

/**
 * The parts Start's and End's inspectors share: their header, their rows
 * of words (triggers, the ways a run ends) and the document field each
 * edits — the run input's schema, the output.
 */

/** The inspector's title, what it is about, and Close. */
export function DocumentInspectorHeader({
  headingId,
  title,
  description,
  onDeselect,
}: {
  headingId: string;
  title: string;
  description: string;
  onDeselect?: () => void;
}) {
  const { t: tCommon } = useT('common');
  return (
    <SectionHeader
      as="h3"
      size="sm"
      title={
        <span
          id={headingId}
          tabIndex={-1}
          className="focus-visible:ring-ring block truncate rounded-sm outline-none focus-visible:ring-2"
        >
          {title}
        </span>
      }
      description={description}
      {...(onDeselect !== undefined && {
        action: (
          <IconButton
            icon={X}
            size="sm"
            aria-label={tCommon('aria.close')}
            onClick={onDeselect}
          />
        ),
      })}
    />
  );
}

/** Rows of words with an icon each, as Start and End show them on the
 *  canvas: a trigger with its next run and state, a way a run ends. */
export function InspectorRows({
  rows,
  labelledBy,
  children,
}: {
  rows: readonly FlowRow[];
  labelledBy: string;
  /** Content under a row, by its id (End lists the halting nodes under
   *  Failed). */
  children?: (row: FlowRow) => ReactNode;
}) {
  return (
    <ul aria-labelledby={labelledBy} className="flex flex-col gap-2">
      {rows.map((row) => {
        const Icon = row.icon;
        return (
          <li key={row.id} className="flex min-w-0 flex-col gap-1.5">
            <div className="flex min-w-0 items-start gap-2 text-xs">
              {Icon !== undefined && (
                <span
                  aria-hidden="true"
                  className="text-muted-foreground mt-0.5 shrink-0"
                >
                  <Icon className="size-3.5" />
                </span>
              )}
              <div className="min-w-0 flex-1">
                <span
                  className={cn(
                    'text-foreground break-words',
                    row.code === true && 'font-mono',
                  )}
                >
                  {row.label}
                </span>
                {row.detail !== undefined && (
                  <span className="text-muted-foreground">
                    {' · '}
                    {row.detail}
                  </span>
                )}
                {row.note !== undefined && (
                  <p className="text-muted-foreground">{row.note}</p>
                )}
              </div>
              {row.badge !== undefined && (
                <Badge
                  variant={row.badge.tone === 'warning' ? 'yellow' : 'outline'}
                  className="shrink-0"
                >
                  {row.badge.label}
                </Badge>
              )}
            </div>
            {children?.(row)}
          </li>
        );
      })}
    </ul>
  );
}

/** A top-level field of the document Start or End edits. */
export type DocumentField = 'inputs' | 'output';

/**
 * The run input's schema or the output, edited as JSON in the code editor,
 * with the check's problems under it and at their characters in it.
 */
export function DocumentJsonField({
  field,
  label,
  description,
  expect,
  value,
  issues,
  context,
  readOnly,
  onCommit,
  reveal,
  providers,
}: {
  field: DocumentField;
  label: string;
  description: string;
  expect: JsonExpect;
  value: unknown;
  /** The problems "go to" brings here: their pointers are under the field. */
  issues: readonly AutomationIssueView[];
  context: InspectorContext;
  readOnly: boolean;
  onCommit: (next: unknown) => void;
  /** Opens the tab the field sits in before a "go to". */
  reveal: () => void;
  /** Completion and types inside the field's templates; none for a field
   *  without templates. */
  providers?: CodeEditorProviders;
}) {
  const { t } = useT('automations');
  const pointer = `/${field}`;
  const lines = useMemo(
    () =>
      issues.map((view) => ({
        id: view.issue.id,
        severity: view.issue.level,
        message: fieldIssueMessage(view, t),
      })),
    [issues, t],
  );
  const marks = useMemo(() => {
    const text = jsonFieldText(settledValue(context.settled, field, value));
    return {
      diagnosticsFor: text,
      diagnostics:
        issues.length === 0
          ? []
          : fieldDiagnostics({
              views: issues,
              fieldPointer: pointer,
              text,
              kind: 'json',
              t,
            }),
    };
  }, [context.settled, field, value, issues, pointer, t]);
  return (
    <JsonCodeField
      label={label}
      description={description}
      value={value}
      expect={expect}
      templates={providers !== undefined}
      {...(providers !== undefined && {
        templateScanner: engineTemplateScan,
        providers,
      })}
      onCommit={onCommit}
      anchor={pointer}
      issueReveal={reveal}
      issues={lines}
      diagnostics={marks.diagnostics}
      diagnosticsFor={marks.diagnosticsFor}
      diagnosticsStatus={context.diagnosticsStatus}
      readOnly={readOnly}
    />
  );
}

/** The field's value in the document the check answered for: its ranges
 *  index into that text. */
function settledValue(
  settled: RawDocument | null,
  field: DocumentField,
  shown: unknown,
): unknown {
  return settled === null ? shown : settled[field];
}
