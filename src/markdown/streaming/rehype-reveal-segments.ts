/**
 * rehype-reveal-segments — Wrap prose text in clause-sized `<span
 * class="stream-seg">` chunks for the streaming reveal fade.
 *
 * The streaming half of `IncrementalMarkdown` re-renders as the reveal
 * position advances. React preserves the DOM of unchanged children, so a
 * span that already existed keeps its node, while a NEWLY appeared clause
 * mounts a fresh span — and a CSS mount animation (`.stream-reveal
 * .stream-seg`, see globals.css) fades exactly that new chunk from 0% to
 * 100% opacity. Splitting happens at exactly the `findClauseEnd` positions
 * the stream buffer paces by (see clause-boundaries.ts), so every reveal
 * step lands on a span boundary and always gets its own fade.
 *
 * Code (`pre`/`code`) is left untouched: components extract its raw text
 * (Shiki highlighting, JSON viewers, copy buttons), and wrapping it in
 * spans would corrupt that extraction. Line-level code fades are handled by
 * the chat's code renderer instead; block-level mounts (li, tr, pre, …)
 * fade via element-mount CSS rules without needing any markup here.
 *
 * Runs AFTER rehype-sanitize, so the injected spans (and their class) are
 * not subject to the sanitize schema.
 */

import type { Element, ElementContent, Root, Text } from 'hast';
import { visit } from 'unist-util-visit';

import { splitClauseChunks } from './clause-boundaries';

const SEGMENT_CLASS = 'stream-seg';

/** Tags whose text must stay a single raw text node. */
const SKIP_TAGS = new Set(['pre', 'code', 'script', 'style']);

function wrapTextNodes(children: ElementContent[]): ElementContent[] {
  const out: ElementContent[] = [];
  for (const child of children) {
    if (child.type !== 'text' || child.value.trim() === '') {
      out.push(child);
      continue;
    }
    for (const chunk of splitClauseChunks(child.value)) {
      const span: Element = {
        type: 'element',
        tagName: 'span',
        properties: { className: [SEGMENT_CLASS] },
        children: [{ type: 'text', value: chunk } satisfies Text],
      };
      out.push(span);
    }
  }
  return out;
}

function isSegmentSpan(node: Element): boolean {
  const className = node.properties?.className;
  return (
    node.tagName === 'span' &&
    Array.isArray(className) &&
    className.includes(SEGMENT_CLASS)
  );
}

export function rehypeRevealSegments() {
  return (tree: Root) => {
    visit(tree, 'element', (node: Element) => {
      if (SKIP_TAGS.has(node.tagName)) return 'skip';
      // Never descend into a span this plugin created — its text child would
      // otherwise be wrapped again, recursing forever.
      if (isSegmentSpan(node)) return 'skip';
      if (
        node.children.some((c) => c.type === 'text' && c.value.trim() !== '')
      ) {
        node.children = wrapTextNodes(node.children);
      }
      return undefined;
    });
  };
}
