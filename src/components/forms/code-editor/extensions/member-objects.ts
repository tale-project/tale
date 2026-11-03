import { syntaxTree } from '@codemirror/language';
import { RangeSetBuilder, type Extension } from '@codemirror/state';
import {
  Decoration,
  ViewPlugin,
  type DecorationSet,
  type EditorView,
  type ViewUpdate,
} from '@codemirror/view';
import type { SyntaxNode, Tree } from '@lezer/common';

import { walkTree } from './tree-walk';

/**
 * The object of every dot access — the `nodes`, `score` and `output` of
 * `nodes.score.output.total`, the `input` of `input?.items` — in document
 * order. The read-only grammars (TextMate) colour these as constants
 * (`variable.other.object`) and the last property as text; a style tag
 * cannot tell a dot access from `counts[label]`, so the editor marks them
 * here, from the tree.
 */
export function memberObjectRanges(
  tree: Tree,
  from = 0,
  to = tree.length,
): Array<[number, number]> {
  const ranges: Array<[number, number]> = [];
  walkTree(tree, from, to, (node, offset) => {
    if (node.name !== 'MemberExpression') return;
    const name = objectName(node);
    if (name !== null) ranges.push([offset + name.from, offset + name.to]);
  });
  return ranges.sort((a, b) => a[0] - b[0]);
}

function objectName(node: SyntaxNode): SyntaxNode | null {
  const object = node.firstChild;
  const access = object?.nextSibling;
  if (object === null || object === undefined) return null;
  if (access?.name !== '.' && access?.name !== '?.') return null;
  if (object.name === 'VariableName') return object;
  if (object.name === 'MemberExpression') {
    const last = object.lastChild;
    if (last?.name === 'PropertyName') return last;
  }
  return null;
}

const objectMark = Decoration.mark({ class: 'cm-tale-object' });

function build(view: EditorView): DecorationSet {
  const builder = new RangeSetBuilder<Decoration>();
  const tree = syntaxTree(view.state);
  let last = -1;
  for (const { from, to } of view.visibleRanges) {
    for (const [start, end] of memberObjectRanges(tree, from, to)) {
      if (start < last) continue;
      builder.add(start, end, objectMark);
      last = end;
    }
  }
  return builder.finish();
}

/** Colours the object of each dot access as a constant. */
export const memberObjects: Extension = ViewPlugin.fromClass(
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
