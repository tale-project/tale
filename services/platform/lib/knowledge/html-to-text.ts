/**
 * Lean HTML → readable text, for the chat `web_fetch` tool.
 *
 * Deliberately NOT the jsdom-based converter in
 * `packages/ui/src/seo/transform/html-to-markdown.ts`: that one builds a real
 * DOM, and jsdom cannot ride the Convex node-action bundle (it is not in
 * `convex.json` `externalPackages`, drags optional native deps, and would
 * dwarf the bundle). This is a tag-level pass instead — scripts, styles, and
 * markup stripped; block structure kept as line breaks; headings, list
 * markers, and absolute links kept in a markdown-ish spelling — which is what
 * a model needs from a page it is READING, not rendering.
 *
 * Layer A: pure string work, no `node:*`, no DOM.
 */

/** Tags whose whole content is noise for a reader. */
const DROP_CONTENT_TAGS = [
  'script',
  'style',
  'noscript',
  'template',
  'svg',
  'head',
  'iframe',
];

/** Tags that end a line when they open or close. */
const BLOCK_TAGS = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'div',
  'dl',
  'dd',
  'dt',
  'fieldset',
  'figure',
  'figcaption',
  'footer',
  'form',
  'header',
  'hr',
  'li',
  'main',
  'nav',
  'ol',
  'p',
  'pre',
  'section',
  'table',
  'tr',
  'ul',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
]);

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  mdash: '—',
  ndash: '–',
  hellip: '…',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  copy: '©',
  reg: '®',
  trade: '™',
};

/** Decode the entities that actually occur in prose. Unknown ones pass
 * through verbatim — mangling is worse than leaving `&foo;` visible. */
export function decodeHtmlEntities(text: string): string {
  return text.replace(
    /&(#x?[0-9a-fA-F]+|[a-zA-Z][a-zA-Z0-9]*);/g,
    (whole, body: string) => {
      if (body.startsWith('#x') || body.startsWith('#X')) {
        const code = Number.parseInt(body.slice(2), 16);
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      }
      if (body.startsWith('#')) {
        const code = Number.parseInt(body.slice(1), 10);
        return Number.isFinite(code) ? String.fromCodePoint(code) : whole;
      }
      return NAMED_ENTITIES[body.toLowerCase()] ?? whole;
    },
  );
}

/** The page's `<title>`, when it has one. */
export function htmlTitle(html: string): string | null {
  const match = /<title[^>]*>([\s\S]*?)<\/title>/i.exec(html);
  if (!match) return null;
  const title = decodeHtmlEntities(match[1] ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return title.length > 0 ? title : null;
}

/** An absolute http(s) href worth keeping in the text. */
function keepableHref(href: string): boolean {
  return href.startsWith('http://') || href.startsWith('https://');
}

/**
 * Extract readable text from an HTML document. Markdown-ish: headings keep a
 * `#` prefix, list items a `-` marker, and absolute links their target.
 */
export function htmlToText(html: string): string {
  let work = html;
  // Comments and whole-content noise first, so nothing inside them leaks.
  work = work.replace(/<!--[\s\S]*?-->/g, ' ');
  for (const tag of DROP_CONTENT_TAGS) {
    work = work.replace(
      new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'gi'),
      ' ',
    );
  }

  // Structural markers BEFORE the generic tag strip.
  work = work.replace(/<br\s*\/?>/gi, '\n');
  work = work.replace(
    /<h([1-6])\b[^>]*>/gi,
    (_whole, level: string) => `\n\n${'#'.repeat(Number(level))} `,
  );
  work = work.replace(/<li\b[^>]*>/gi, '\n- ');
  work = work.replace(/<(td|th)\b[^>]*>/gi, ' | ');
  // Links: keep the target next to the text for absolute http(s) URLs.
  work = work.replace(
    /<a\b[^>]*href\s*=\s*("([^"]*)"|'([^']*)')[^>]*>([\s\S]*?)<\/a>/gi,
    (
      _whole,
      _quoted,
      hrefA: string | undefined,
      hrefB: string | undefined,
      inner: string,
    ) => {
      const href = (hrefA ?? hrefB ?? '').trim();
      const text = inner
        .replace(/<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text.length === 0) return ' ';
      return keepableHref(href) ? `[${text}](${href})` : ` ${text} `;
    },
  );
  // Block boundaries become newlines; the rest of the markup disappears.
  work = work.replace(
    /<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g,
    (whole, tag: string) => (BLOCK_TAGS.has(tag.toLowerCase()) ? '\n' : ' '),
  );

  work = decodeHtmlEntities(work);
  // Whitespace discipline: spaces collapse within a line, blank runs to one
  // empty line, edges trimmed.
  work = work
    .split('\n')
    .map((line) => line.replace(/[ \t ]+/g, ' ').trim())
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return work;
}
