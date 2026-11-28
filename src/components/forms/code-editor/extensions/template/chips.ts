import { syntaxTree } from '@codemirror/language';
import type { EditorState, Extension } from '@codemirror/state';
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from '@codemirror/view';

import { walkTree } from '../tree-walk';

/**
 * Every `{{ … }}` template in `[from, to)`, as document ranges in order —
 * top-level ones, the ones in a Markdown paragraph, and the ones overlaid on
 * a JSON or YAML string.
 */
function templateRanges(
  state: EditorState,
  from = 0,
  to = state.doc.length,
): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  walkTree(syntaxTree(state), from, to, (node, offset) => {
    if (node.name === 'Template') {
      ranges.push([offset + node.from, offset + node.to]);
    }
  });
  return ranges.sort((a, b) => a[0] - b[0]);
}

const chip = Decoration.mark({ class: 'cm-template' });

function build(view: EditorView): DecorationSet {
  const marks = [];
  let last = -1;
  for (const { from, to } of view.visibleRanges) {
    for (const [start, end] of templateRanges(view.state, from, to)) {
      if (start < last || end <= start) continue;
      marks.push(chip.range(start, end));
      last = end;
    }
  }
  return Decoration.set(marks, true);
}

/**
 * Draws each template as one tinted chip, so an expression reads as a unit
 * inside prose or a string.
 */
export const templateChips: Extension = ViewPlugin.fromClass(
  class {
    decorations: DecorationSet;

    constructor(view: EditorView) {
      this.decorations = build(view);
    }

    update(update: ViewUpdate) {
      if (
        update.docChanged ||
        update.viewportChanged ||
        syntaxTree(update.startState) !== syntaxTree(update.state)
      ) {
        this.decorations = build(update.view);
      }
    }
  },
  { decorations: (plugin) => plugin.decorations },
);
