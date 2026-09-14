/**
 * `<Demo name="…" />` is the authoring form (see `content/README.md`), but
 * the markdown pipeline hands raw HTML to an HTML5 parser, and HTML5 has no
 * self-closing custom elements: the `/` is ignored, `<demo>` stays open, and
 * everything after it on the page becomes its children — which the `Demo`
 * component drops. The first example on a page would silently swallow the
 * rest of the article.
 *
 * So the tag is expanded to an explicit pair before rendering — the closing
 * tag on its own line, because CommonMark only treats an open tag followed by
 * nothing else as an HTML *block*; `<Demo …></Demo>` on one line is inline
 * HTML, gets wrapped in a `<p>`, and the example's `<div>`s then sit inside a
 * paragraph (invalid HTML, a hydration warning in dev). Fenced code is left
 * alone: a page that *shows* the authoring syntax must keep it.
 */
const SELF_CLOSING_DEMO = /<Demo(\s[^<>]*?)?\s*\/>/g;
const FENCE = /^\s*(```|~~~)/;

export function expandDemoTags(markdown: string): string {
  let inFence = false;
  return markdown
    .split('\n')
    .map((line) => {
      if (FENCE.test(line)) {
        inFence = !inFence;
        return line;
      }
      if (inFence) return line;
      return line.replace(SELF_CLOSING_DEMO, '<Demo$1>\n</Demo>');
    })
    .join('\n');
}
