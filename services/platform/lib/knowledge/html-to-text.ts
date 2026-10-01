/**
 * Lean HTML → readable text, for the chat `web_fetch` tool, the website
 * crawler and HTML message bodies.
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
 * Without the page's CSS every tag separates words: nothing here can tell a
 * bold syllable from two table-like spans. The crawler's render lane knows
 * the layout and writes it into the markup it hands over
 * (`renderedLayoutHtml`, marked with {@link RENDERED_LAYOUT_ATTRIBUTE}); in
 * such markup inline formatting tags are zero-width, as the browser laid
 * them out, so a page that splits its words into one `<span>` per letter (a
 * text effect) reads as words and `<b>Im</b>portant` as one.
 *
 * Every pattern runs through `markup-scan.ts`, so markup with tags that are
 * never closed costs what its length does.
 *
 * Layer A: pure string work, no `node:*`, no DOM.
 */

import { replaceUpToLast, upToLast } from './markup-scan';

/** The attribute the crawler's render lane sets on `<html>` when it has
 * written the page's CSS layout into the markup: block boxes on their own
 * lines, inline-level boxes and hidden elements apart. */
export const RENDERED_LAYOUT_ATTRIBUTE = 'data-tale-layout';

/** The mark on the document element, behind whitespace and a doctype at
 * most. The whitespace after the doctype belongs to the doctype's group:
 * allowed on both sides of an optional group, a run of whitespace that no
 * `<html` follows was split between the two in every possible way, which is
 * quadratic on input any page, mail body or message may open with. */
const RENDERED_LAYOUT_MARKER = new RegExp(
  `^\\s*(?:<!DOCTYPE[^<>]*>\\s*)?<html\\b[^<>]*\\s${RENDERED_LAYOUT_ATTRIBUTE}=`,
  'i',
);

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

/** Phrasing tags a browser lays out without any space of their own: they
 * disappear without a trace. Every other tag not in {@link BLOCK_TAGS}
 * (images, form controls, custom elements) still separates words. */
const INLINE_TAGS = new Set([
  'a',
  'abbr',
  'b',
  'bdi',
  'bdo',
  'big',
  'cite',
  'code',
  'data',
  'del',
  'dfn',
  'em',
  'font',
  'i',
  'ins',
  'kbd',
  'label',
  'mark',
  'nobr',
  'q',
  'rp',
  'rt',
  'ruby',
  's',
  'samp',
  'small',
  'span',
  'strike',
  'strong',
  'sub',
  'sup',
  'time',
  'tt',
  'u',
  'var',
  'wbr',
]);

/** What a stripped tag leaves behind: a line break for a block, a word
 * boundary for anything else — except, in markup that carries its layout
 * (`laidOut`), nothing for inline formatting. */
function tagSeparator(tag: string, laidOut: boolean): string {
  const name = tag.toLowerCase();
  if (BLOCK_TAGS.has(name)) return '\n';
  return laidOut && INLINE_TAGS.has(name) ? '' : ' ';
}

/** Any element tag, opening or closing. */
const ELEMENT_TAG = /<\/?([a-zA-Z][a-zA-Z0-9-]*)\b[^>]*>/g;
/** A link with a quoted target. The tag's attributes stop at the next `<`:
 * looking for `href` across a run of unclosed tags is what made this
 * pattern cubic. */
const LINK =
  /<a\b[^<>]*href\s*=\s*("([^"<>]*)"|'([^'<>]*)')[^<>]*>([\s\S]*?)<\/a>/gi;

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
  const match = /<title[^<>]*>([\s\S]*?)<\/title>/i.exec(
    upToLast(html, /<\/title>/gi),
  );
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
  const laidOut = RENDERED_LAYOUT_MARKER.test(html);
  const separator = (_tag: string, name: string): string =>
    tagSeparator(name, laidOut);
  let work = html;
  // Comments and whole-content noise first, so nothing inside them leaks.
  work = replaceUpToLast(work, '-->', /<!--[\s\S]*?-->/g, ' ');
  // Declarations, processing instructions and CDATA sections are not
  // elements: the generic tag strip below needs a letter after `<`, so
  // `<!DOCTYPE html>` survived it and led every indexed passage of a page.
  work = replaceUpToLast(work, '>', /<!DOCTYPE[^>]*>/gi, ' ');
  work = replaceUpToLast(work, '?>', /<\?[\s\S]*?\?>/g, ' ');
  work = replaceUpToLast(work, ']]>', /<!\[CDATA\[[\s\S]*?\]\]>/g, ' ');
  work = work.replace(/<!\[[^\]<>]*\]>/g, ' ');
  for (const tag of DROP_CONTENT_TAGS) {
    work = replaceUpToLast(
      work,
      new RegExp(`<\\/${tag}>`, 'gi'),
      new RegExp(`<${tag}\\b[\\s\\S]*?<\\/${tag}>`, 'gi'),
      ' ',
    );
  }

  // Structural markers BEFORE the generic tag strip.
  work = work.replace(/<br\s*\/?>/gi, '\n');
  work = replaceUpToLast(
    work,
    '>',
    /<h([1-6])\b[^>]*>/gi,
    (_whole, level: string) => `\n\n${'#'.repeat(Number(level))} `,
  );
  work = replaceUpToLast(work, '>', /<li\b[^>]*>/gi, '\n- ');
  work = replaceUpToLast(work, '>', /<(td|th)\b[^>]*>/gi, ' | ');
  // Links: keep the target next to the text for absolute http(s) URLs.
  work = replaceUpToLast(
    work,
    /<\/a>/gi,
    LINK,
    (
      _whole,
      _quoted,
      hrefA: string | undefined,
      hrefB: string | undefined,
      inner: string,
    ) => {
      const href = (hrefA ?? hrefB ?? '').trim();
      const stripped = replaceUpToLast(inner, '>', ELEMENT_TAG, separator);
      const text = replaceUpToLast(stripped, '>', /<[^>]+>/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
      if (text.length === 0) return ' ';
      return keepableHref(href) ? `[${text}](${href})` : ` ${text} `;
    },
  );
  // Block boundaries become newlines; the rest of the markup disappears.
  work = replaceUpToLast(work, '>', ELEMENT_TAG, separator);

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
