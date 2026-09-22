import type { Root } from 'mdast';
import { visit } from 'unist-util-visit';

/** Authored Frame tags occupy their own Markdown HTML nodes, separated from
 * content by blank lines. Rename their opening/closing token before rehype-raw:
 * HTML's obsolete, void `frame` element is otherwise discarded in a body.
 * Only the node's leading tag name changes; attributes, literal code examples
 * and the Markdown children keep their original bytes. */
export function remarkFrame() {
  return (tree: Root) => {
    visit(tree, 'html', (node) => {
      node.value = node.value.replace(
        /^(\s*<\/?)frame(?=[\s/>])/i,
        '$1tale-frame',
      );
    });
  };
}
