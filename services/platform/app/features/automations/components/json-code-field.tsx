'use client';

import {
  CodeEditor,
  type CodeEditorDiagnostic,
  type CodeEditorDiagnosticsStatus,
} from '@tale/ui/code-editor';
import type { CodeEditorProviders } from '@tale/ui/code-editor/providers';
import type { TemplateScan } from '@tale/ui/code-editor/template-scan';
import { Field } from '@tale/ui/field';
import type { FieldIssue } from '@tale/ui/field-issue-messages';
import { useEffect, useId, useRef, useState } from 'react';

import { useT } from '@/lib/i18n/client';
import { stableStringify } from '@/lib/shared/utils/stable-stringify';

/** The text a JSON field shows for a value: two-space JSON, nothing for
 *  an absent one. The check's ranges index into the same text. */
export function jsonFieldText(value: unknown): string {
  if (value === undefined) return '';
  try {
    return JSON.stringify(value, null, 2) ?? '';
  } catch (error) {
    console.warn('[automations] a field value is not serialisable', error);
    return '';
  }
}

/** What a JSON field accepts: an object, a list, or any JSON value. */
export type JsonExpect = 'object' | 'array' | 'any';

function kindMatches(value: unknown, expect: JsonExpect): boolean {
  if (expect === 'any') return true;
  if (expect === 'array') return Array.isArray(value);
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export interface JsonCodeFieldProps {
  label: string;
  description?: string;
  /** The value as the document holds it. */
  value: unknown;
  expect: JsonExpect;
  /** `{{ js }}` inside the JSON's strings. */
  templates?: boolean;
  templateScanner?: (text: string) => TemplateScan;
  /** A value that parses and has the expected kind; `undefined` for a
   *  cleared field. */
  onCommit: (next: unknown) => void;
  /** Where "go to" a problem in this field (or inside it) lands. */
  anchor: string | null;
  /** Opens what hides the field (its tab, its disclosure) before a "go to". */
  issueReveal?: () => void;
  /** The problems the check found here, one line each under the editor. */
  issues?: readonly FieldIssue[];
  diagnostics?: readonly CodeEditorDiagnostic[];
  diagnosticsFor?: string;
  diagnosticsStatus?: CodeEditorDiagnosticsStatus;
  providers?: CodeEditorProviders;
  readOnly: boolean;
  required?: boolean;
  minRows?: number;
  maxRows?: number;
  expandable?: boolean;
}

/**
 * A JSON value edited as text in the code editor: the node changes only
 * when the text parses to a value of the kind the field takes, and the text
 * is the author's own — the node's value coming back from an edit never
 * rewrites it, so the caret stays where it was. A value that changes for
 * another reason (another node, a reloaded version, a new version an agent
 * saved) replaces the text.
 */
export function JsonCodeField({
  label,
  description,
  value,
  expect,
  templates = false,
  templateScanner,
  onCommit,
  anchor,
  issueReveal,
  issues,
  diagnostics,
  diagnosticsFor,
  diagnosticsStatus,
  providers,
  readOnly,
  required,
  minRows = 3,
  maxRows = 14,
  expandable = true,
}: JsonCodeFieldProps) {
  const { t } = useT('automations');
  const id = useId();
  const [text, setText] = useState(() => jsonFieldText(value));
  const [error, setError] = useState<string | null>(null);
  /** The value this field last committed or showed, by content. */
  const committed = useRef(stableStringify(value));

  useEffect(() => {
    const next = stableStringify(value);
    if (next === committed.current) return;
    committed.current = next;
    setText(jsonFieldText(value));
    setError(null);
  }, [value]);

  const change = (next: string): void => {
    setText(next);
    if (next.trim() === '') {
      setError(null);
      committed.current = stableStringify(undefined);
      onCommit(undefined);
      return;
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(next);
    } catch {
      // The editor marks where the text stops being JSON; the line under
      // it says the node was not changed.
      setError(t('editor.invalidJson'));
      return;
    }
    if (!kindMatches(parsed, expect)) {
      setError(
        expect === 'array'
          ? t('editor.jsonMustBeList')
          : t('editor.jsonMustBeObject'),
      );
      return;
    }
    setError(null);
    committed.current = stableStringify(parsed);
    onCommit(parsed);
  };

  return (
    <Field
      label={label}
      htmlFor={id}
      {...(description !== undefined && { description })}
      {...(error !== null && { error })}
      {...(issues !== undefined && issues.length > 0 && { issues })}
      {...(required !== undefined && { required })}
    >
      <CodeEditor
        id={id}
        value={text}
        onChange={change}
        language="json"
        templates={templates}
        {...(templateScanner !== undefined && { templateScanner })}
        readOnly={readOnly}
        minRows={minRows}
        maxRows={maxRows}
        expandable={expandable && !readOnly ? { title: label } : false}
        issueAnchor={anchor}
        {...(issueReveal !== undefined && { issueReveal })}
        {...(diagnostics !== undefined && { diagnostics })}
        {...(diagnosticsFor !== undefined && { diagnosticsFor })}
        {...(diagnosticsStatus !== undefined && { diagnosticsStatus })}
        {...(providers !== undefined && { providers })}
        describeDiagnostics={false}
      />
    </Field>
  );
}
