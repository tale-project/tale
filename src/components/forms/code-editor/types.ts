import type { ReactNode } from 'react';

import type { CodeLanguage } from '../../../lib/code-roles';
import type { CodeEditorProviders } from './providers';
import type { TemplateScan } from './template-scan';

/** A problem with the text, at a range or for the whole field. */
export interface CodeEditorDiagnostic {
  /** Stable across checks (a check's issue id). */
  id: string;
  severity: 'error' | 'warning' | 'info';
  /** One translated sentence: the tooltip line, the summary, the announcement. */
  message: string;
  /**
   * UTF-16 `[from, to)` into `diagnosticsFor` (default: `value`). Absent:
   * the whole field is meant — no underline, a gutter mark on line 1, listed
   * in the summary. An empty range widens to one character.
   */
  range?: readonly [number, number];
  /** Stable machine code, small and monospaced in the tooltip. */
  code?: string;
  /** Rich tooltip body, e.g. `<IssueDetail issue={item} density="compact" />`. */
  detail?: ReactNode;
  /** One-click repairs. Offsets into `diagnosticsFor`, mapped like `range`. */
  fixes?: ReadonlyArray<{
    label: string;
    changes: ReadonlyArray<{
      range: readonly [number, number];
      insert: string;
    }>;
  }>;
}

export type CodeEditorDiagnosticsStatus =
  | 'ready'
  | 'checking'
  | 'stale'
  | 'failed';

export interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  language: CodeLanguage;
  /** `{{ js }}` inside json, yaml, markdown or text; implied by `template`. */
  templates?: boolean;
  /** Replaces the built-in template scanner (a host's runtime rule). Pure. */
  templateScanner?: (text: string) => TemplateScan;

  /** Focusable and selectable but not editable; code-block chrome. */
  readOnly?: boolean;
  disabled?: boolean;
  /** Why it is disabled: keeps it focusable and shows this as a tooltip. */
  disabledReason?: ReactNode;
  placeholder?: string;

  /** One line: Enter never inserts a newline and Tab moves focus. */
  singleLine?: boolean;
  /** Default 1 (singleLine) or 3. */
  minRows?: number;
  /** Default 4 (singleLine, soft-wrapped) or 14; ignored with `fillHeight`. */
  maxRows?: number;
  /** Fill the flex parent and scroll inside. */
  fillHeight?: boolean;
  /** Soft-wrap long lines. Default: on for markdown, template, text and singleLine. */
  wrap?: boolean;
  /** `prose` sets the text in the reading font (prompts); templates stay mono. */
  font?: 'mono' | 'prose';
  /** `sm` 12 px (inspector) or `md` 14 px; 16 px below md, so iOS never zooms. */
  size?: 'sm' | 'md';
  lineNumbers?: boolean;
  /** Fold markers in the gutter. Default: `lineNumbers`. */
  fold?: boolean;
  /** Find and replace on Mod-F. Default off: Mod-F stays the browser's. */
  search?: boolean;
  /** An "Expand editor" button that opens the same field in a large dialog. */
  expandable?: boolean | { title: string };

  /** Set on the focusable text area, for `<label for>` and focus requests. */
  id?: string;
  'aria-label'?: string;
  'aria-labelledby'?: string;
  'aria-describedby'?: string;
  'aria-invalid'?: boolean;
  required?: boolean;

  diagnostics?: readonly CodeEditorDiagnostic[];
  /** The text `diagnostics` ranges index into; edits since are mapped. */
  diagnosticsFor?: string;
  diagnosticsStatus?: CodeEditorDiagnosticsStatus;
  /** An sr-only summary of the problems; false where a Field lists them. */
  describeDiagnostics?: boolean;
  /** Local syntax marks (JSON/YAML, unclosed `{{`, JavaScript). Default on. */
  syntaxDiagnostics?: boolean;

  providers?: CodeEditorProviders;
  /** Mod-Enter, and Enter when `singleLine`. */
  onSubmit?: (value: string) => void;
  /** The host button's label, for the shortcut hint ("Run"). */
  submitLabel?: string;
  onFocus?: () => void;
  onBlur?: () => void;

  /** Registers with the nearest IssueFocusProvider (inert without one). */
  issueAnchor?: string | null;
  issueReveal?: () => void;
  initialSelection?: readonly [number, number];
  /** Classes for the frame. */
  className?: string;
}

export interface CodeEditorHandle {
  /** Focuses (and selects `range`); waits for the editor to load. */
  focus(range?: readonly [number, number]): void;
  getSelection(): readonly [number, number] | null;
  openCompletion(): void;
  nextDiagnostic(direction?: 1 | -1): void;
  /** The CodeMirror view, for host tests; untyped on purpose. */
  readonly view: unknown;
}
