/**
 * rehype-preserve-code-meta — Copy a fenced code block's metastring onto
 * the `<code>` element as a `data-meta` HTML attribute so it survives
 * rehype-raw's serialize/reparse cycle.
 *
 * remark stores the part of `` ``` ```lang title `` ` after the language
 * on the hast node's `data.meta`. `data` is a parser-internal field that
 * is dropped when rehype-raw stringifies the tree, so by the time
 * react-markdown reaches the component map the label is gone. Lifting it
 * to a proper attribute via `properties.dataMeta` keeps it intact through
 * the round-trip and lets consumers (e.g. `<CodeGroup>` tab labels) read
 * it back from `child.props['data-meta']`.
 *
 * Must run before `rehype-raw` in the plugin chain — once raw HTML has
 * been reparsed, `data.meta` is already gone.
 */

import type { Root } from 'hast';
import { visit } from 'unist-util-visit';

export function rehypePreserveCodeMeta() {
  return (tree: Root) => {
    visit(tree, 'element', (node) => {
      if (node.tagName !== 'code') return;
      const data = node.data as { meta?: unknown } | undefined;
      const meta = data?.meta;
      if (typeof meta !== 'string' || meta.length === 0) return;
      node.properties = node.properties ?? {};
      node.properties.dataMeta = meta;
    });
  };
}
