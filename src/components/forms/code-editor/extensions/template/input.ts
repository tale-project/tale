import { startCompletion } from '@codemirror/autocomplete';
import { syntaxTree } from '@codemirror/language';
import {
  EditorSelection,
  Prec,
  type EditorState,
  type Extension,
} from '@codemirror/state';
import { EditorView, keymap } from '@codemirror/view';
import type { SyntaxNode } from '@lezer/common';

import type { CodeLanguage } from '../../../../../lib/code-roles';

/**
 * Typing a template: `{` after `{` becomes `{{ | }}` with the caret inside
 * and completion open; `}` in front of the closing `}}` steps over it;
 * Backspace in an empty `{{ | }}` removes the pair. Each is one undo step.
 */

/** Node names that hold text a template may sit in, per language. */
const STRINGS: Partial<Record<CodeLanguage, ReadonlySet<string>>> = {
  json: new Set(['String']),
  yaml: new Set(['Literal', 'QuotedLiteral', 'BlockLiteralContent']),
};

const TEMPLATE_NODES = new Set(['Template', 'TemplateUnterminated']);

/** Whether a template may start at `pos`: text, not code, not a key. */
function canOpenAt(
  state: EditorState,
  pos: number,
  language: CodeLanguage,
): boolean {
  const strings = STRINGS[language];
  let inString = strings === undefined;
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
    node !== null;
    node = node.parent
  ) {
    // Inside a template's JavaScript (whose tree hangs below `Template`).
    if (
      node.name === 'TemplateBody' ||
      node.name === 'SingleExpression' ||
      node.name === 'Script'
    ) {
      return false;
    }
    if (node.name === 'Key' || node.name === 'PropertyName') return false;
    if (TEMPLATE_NODES.has(node.name)) inString = true;
    if (strings?.has(node.name)) inString = true;
  }
  return inString;
}

function inTemplate(state: EditorState, pos: number): boolean {
  for (
    let node: SyntaxNode | null = syntaxTree(state).resolveInner(pos, -1);
    node !== null;
    node = node.parent
  ) {
    if (node.name === 'Template' || node.name === 'TemplateBody') return true;
  }
  return false;
}

function openTemplate(view: EditorView, at: number): boolean {
  const { state } = view;
  const doc = state.doc;
  const closed = doc.sliceString(at, at + 1) === '}';
  const replaceTo = closed ? at + 1 : at;
  view.dispatch(
    state.update({
      changes: { from: at - 1, to: replaceTo, insert: '{{  }}' },
      selection: EditorSelection.cursor(at - 1 + 3),
      scrollIntoView: true,
      userEvent: 'input.type',
    }),
  );
  startCompletion(view);
  return true;
}

export function templateInput(language: CodeLanguage): Extension {
  return [
    Prec.highest(
      EditorView.inputHandler.of((view, from, to, text) => {
        if (view.state.readOnly || from !== to) return false;
        const doc = view.state.doc;
        if (text === '{') {
          if (doc.sliceString(from - 1, from) !== '{') return false;
          if (doc.sliceString(from - 2, from - 1) === '{') return false;
          if (!canOpenAt(view.state, from - 1, language)) return false;
          return openTemplate(view, from);
        }
        if (text === '}' && inTemplate(view.state, from)) {
          // In front of ` }}`, land between the braces; in front of the
          // last `}`, step over it.
          const skip =
            doc.sliceString(from, from + 3) === ' }}'
              ? 2
              : doc.sliceString(from, from + 1) === '}'
                ? 1
                : 0;
          if (skip === 0) return false;
          view.dispatch({
            selection: EditorSelection.cursor(from + skip),
            scrollIntoView: true,
            userEvent: 'select',
          });
          return true;
        }
        return false;
      }),
    ),
    Prec.high(
      keymap.of([
        {
          key: 'Backspace',
          run: (view) => {
            const range = view.state.selection.main;
            if (!range.empty || view.state.readOnly) return false;
            const pos = range.head;
            const doc = view.state.doc;
            const pair =
              doc.sliceString(pos - 3, pos + 3) === '{{  }}'
                ? 3
                : doc.sliceString(pos - 2, pos + 2) === '{{}}'
                  ? 2
                  : 0;
            if (pair === 0) return false;
            view.dispatch({
              changes: { from: pos - pair, to: pos + pair },
              userEvent: 'delete.backward',
            });
            return true;
          },
        },
      ]),
    ),
  ];
}
