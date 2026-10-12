import { NodeProp, type SyntaxNode, type Tree } from '@lezer/common';

/**
 * Visits every node of `tree` that touches `[from, to)`, entering the
 * overlays mounted on it — a template inside a JSON or YAML string is an
 * overlay, which a plain `tree.iterate` does not enter. `node` positions are
 * relative to its own tree; `offset` turns them into document positions.
 */
export function walkTree(
  tree: Tree,
  from: number,
  to: number,
  enter: (node: SyntaxNode, offset: number) => void,
  offset = 0,
): void {
  tree.iterate({
    from: from - offset,
    to: to - offset,
    enter(ref) {
      const mounted = ref.tree?.prop(NodeProp.mounted);
      if (mounted?.overlay) {
        walkTree(
          mounted.tree,
          from,
          to,
          enter,
          offset + ref.from + mounted.overlay[0].from,
        );
      }
      enter(ref.node, offset);
    },
  });
}
