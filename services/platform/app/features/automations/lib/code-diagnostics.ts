/**
 * A field's problems as the code editor marks them: the check's issues for
 * one field, each at the characters it is about — the exact range the
 * engine reported inside a string, or, for a problem deeper inside a JSON
 * value (`/nodes/2/input/to`), the place that pointer names in the text the
 * reader edits — with the words the Problems list uses and, where the
 * engine suggested the name the author probably meant, a one-click fix.
 *
 * The ranges index into the text the check saw (`diagnosticsFor`); the
 * editor maps them through every edit made since.
 */

import type { CodeEditorDiagnostic } from '@tale/ui/code-editor';
import {
  locateJsonPointer,
  locateYamlPointer,
  type LocatedRange,
} from '@tale/ui/code-editor/locate';
import { IssueDetail } from '@tale/ui/issue-list';
import { createElement } from 'react';

import type { IssueTranslate } from './issue-text';
import { fieldIssueMessage, type AutomationIssueView } from './issues';

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** How a pointer below the field is found in its text. */
export type FieldTextKind = 'string' | 'json' | 'yaml';

export interface FieldDiagnosticsOptions {
  /** This field's problems. */
  views: readonly AutomationIssueView[];
  /** The field's own pointer (`/nodes/2/input`, `/output`). */
  fieldPointer: string;
  /** The field's text as the check saw it. */
  text: string;
  kind: FieldTextKind;
  t: IssueTranslate;
}

/** The did-you-mean of an issue, when the engine made one and it can be
 *  written where the misspelled name stands. */
interface Suggestion {
  /** The name as written, to find inside the issue's span. */
  wrong: string;
  /** The name to write instead. */
  right: string;
  /** Where in the span the name sits: after a scope name, or at its end. */
  after?: string;
  last: boolean;
}

function suggestionOf(view: AutomationIssueView): Suggestion | null {
  const params = view.issue.params ?? {};
  const right = params.suggestion;
  if (typeof right !== 'string' || right === '') return null;
  switch (view.issue.code) {
    case 'REF_UNKNOWN_NODE':
      return typeof params.ref === 'string'
        ? { wrong: params.ref, right, after: 'nodes', last: false }
        : null;
    case 'INPUT_KEY_UNKNOWN':
      return typeof params.key === 'string'
        ? { wrong: params.key, right, after: 'input', last: false }
        : null;
    case 'REF_UNKNOWN_FIELD':
      return typeof params.key === 'string'
        ? { wrong: params.key, right, last: true }
        : null;
    default:
      return null;
  }
}

/** The fix that writes the suggested name over the wrong one, inside the
 *  marked span; none when the name cannot be found there or written as is. */
function fixFor(
  view: AutomationIssueView,
  text: string,
  span: readonly [number, number],
  t: IssueTranslate,
): CodeEditorDiagnostic['fixes'] {
  const suggestion = suggestionOf(view);
  if (suggestion === null) return undefined;
  const slice = text.slice(span[0], span[1]);
  let at: number;
  if (suggestion.last) {
    at = slice.lastIndexOf(suggestion.wrong);
  } else {
    const scope =
      suggestion.after === undefined ? -1 : slice.indexOf(suggestion.after);
    at =
      scope === -1
        ? -1
        : slice.indexOf(
            suggestion.wrong,
            scope + (suggestion.after?.length ?? 0),
          );
  }
  if (at === -1) return undefined;
  // A name that is not an identifier needs brackets in a dotted path; one
  // already in quotes can take any name.
  const quoted = /["']/.test(slice[at - 1] ?? '');
  if (!quoted && !IDENTIFIER.test(suggestion.right)) return undefined;
  const from = span[0] + at;
  return [
    {
      label: t('editor.fixSuggestion', {
        ns: 'automations',
        name: suggestion.right,
      }),
      changes: [
        {
          range: [from, from + suggestion.wrong.length],
          insert: suggestion.right,
        },
      ],
    },
  ];
}

function locate(
  kind: FieldTextKind,
  text: string,
  pointer: string,
  options: Parameters<typeof locateJsonPointer>[2],
): LocatedRange | null {
  if (kind === 'json') return locateJsonPointer(text, pointer, options);
  if (kind === 'yaml') return locateYamlPointer(text, pointer, options);
  return null;
}

/** Where in the field's text one issue is; undefined for the whole field. */
function rangeOf(
  view: AutomationIssueView,
  options: FieldDiagnosticsOptions,
): readonly [number, number] | undefined {
  const at = view.issue.at;
  const pointer = at?.pointer ?? '';
  const { fieldPointer, text, kind } = options;
  if (pointer === fieldPointer) {
    // A JSON or YAML value as a whole is marked as the whole field.
    const range = at?.range;
    if (kind !== 'string' || range === undefined || at?.subject === 'key') {
      return undefined;
    }
    // A range past the text (it changed since) marks the whole field.
    return range[1] <= text.length ? range : undefined;
  }
  if (!pointer.startsWith(`${fieldPointer}/`) || kind === 'string') {
    return undefined;
  }
  const located = locate(kind, text, pointer.slice(fieldPointer.length), {
    ...(at?.range !== undefined && { range: at.range }),
    ...(at?.subject !== undefined && { subject: at.subject }),
  });
  return located === null ? undefined : [located.from, located.to];
}

/** One field's problems as editor marks. */
export function fieldDiagnostics(
  options: FieldDiagnosticsOptions,
): CodeEditorDiagnostic[] {
  return options.views.map((view) => {
    const range = rangeOf(view, options);
    const fixes =
      range === undefined
        ? undefined
        : fixFor(view, options.text, range, options.t);
    return {
      id: view.issue.id,
      severity: view.issue.level,
      message: fieldIssueMessage(view, options.t),
      code: view.issue.code,
      detail: createElement(IssueDetail, {
        issue: view.item,
        density: 'compact',
        className: 'pl-0',
      }),
      ...(range !== undefined && { range }),
      ...(fixes !== undefined && { fixes }),
    };
  });
}
