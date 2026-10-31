/**
 * The content of a web page, for the chat `web_fetch` tool: the region the
 * page marks as its content, without the navigation, banners, controls and
 * hidden parts in it, read as text by `htmlToText` — and, for a page with
 * nothing to read, why.
 *
 * Read whole, a page opens on its site's chrome: a Microsoft Learn article
 * began "Skip to main content … This browser is no longer supported …
 * Table of contents" and ended on the site's footer, which costs the
 * model's context and buries the article. The region is the page's
 * `<main>` (or `role="main"`), else its one `<article>`, else its body; cut
 * from it is what assistive technology does not read as content either —
 * navigation, banners and other landmarks, hidden elements, dialogs,
 * buttons, option lists — and cookie notices.
 *
 * One pass over the markup, with a stack of open elements that ends them
 * where the HTML tree builder does: an end tag closes what it skips over and
 * a stray one is ignored; a list item, a table row or cell and a paragraph
 * end where the next begins. No DOM: jsdom cannot ride the node-action bundle
 * (`html-to-text.ts`), and htmlparser2 looks for each stray end tag through
 * all open elements, quadratic on a run of them. Every pattern here stops at
 * the next `<` or reads to the end of the input (`markup-scan.ts`), so a
 * page costs what its length does.
 *
 * Layer A: pure string work, no `node:*`, no DOM.
 */

import { decodeHtmlEntities, htmlToText } from './html-to-text';

/** Below this many characters of text, a region does not hold the page:
 * a `<main>` this short is a placeholder its scripts fill, or a page this
 * short is a shell. */
const NEAR_EMPTY_CHARS = 200;

/** A page shows one `<main>`: of more, the first few are compared, each a
 * pass over its text. */
const MAX_MAINS = 4;

/** The longest canonical URL a result carries. */
const MAX_CANONICAL_URL_CHARS = 2048;

export interface PageContent {
  /** The page's content as text, empty when it has none. */
  readonly text: string;
  /** Where the page says it lives (`<link rel="canonical">`), resolved
   * against its URL; null when it names no http(s) address. */
  readonly canonicalUrl: string | null;
  /** Whether the page's scripts make its content in the browser: where the
   * content belongs, the markup holds an app's empty mount point, or
   * nothing to read. */
  readonly needsBrowser: boolean;
}

/** Why a page that answered with success has nothing to read. */
export type UnreadablePage = 'blocked' | 'needs-browser' | 'empty';

/**
 * Why a page answered with `status` has nothing to read, or null when its
 * `text` is the page. A 202 with nothing to read is what a site that blocks
 * automated access answers in place of the page (AWS WAF's challenge comes
 * as one); otherwise a page whose scripts make its content needs a
 * browser, and one with no text at all is empty.
 */
export function unreadablePage(
  status: number,
  text: string,
  needsBrowser: boolean,
): UnreadablePage | null {
  if (!needsBrowser && text.trim() !== '') return null;
  if (status === 202) return 'blocked';
  return needsBrowser ? 'needs-browser' : 'empty';
}

/** Elements whose content is text, never markup, up to their end tag. */
const RAW_TEXT_ELEMENTS = [
  'script',
  'style',
  'textarea',
  'title',
  'xmp',
  'iframe',
  'noembed',
  'noframes',
  'noscript',
];

/** A comment, an element whose content is text (start tag to end tag), or
 * any other tag. A comment or a text element without its end runs to the
 * end of the input, as a browser reads it; a tag stops at the next `<`. */
const TOKEN = new RegExp(
  [
    '<!--[\\s\\S]*?(?:-->|$)',
    `<(${RAW_TEXT_ELEMENTS.join('|')})(?![\\w-])([^<>]*)>[\\s\\S]*?(?:<\\/\\1(?![\\w-])[^<>]*>|$)`,
    '<(\\/?)([a-zA-Z][^\\s/<>]*)((?:[\\s/][^<>]*)?)>',
  ].join('|'),
  'gi',
);

/** One attribute: its name, and its value in double, single or no quotes. */
const ATTRIBUTE =
  /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

/** The document's leading `<html>` tag, which tells `htmlToText` whether
 * the markup carries its layout (`RENDERED_LAYOUT_ATTRIBUTE`). Grouped as
 * that marker is, so a run of whitespace is read once. */
const DOCUMENT_ELEMENT = /^\s*(?:<!DOCTYPE[^<>]*>\s*)?<html\b[^<>]*>/i;

/** Elements that never have content or an end tag. */
const VOID_ELEMENTS = new Set([
  'area',
  'base',
  'basefont',
  'bgsound',
  'br',
  'col',
  'embed',
  'frame',
  'hr',
  'img',
  'input',
  'keygen',
  'link',
  'meta',
  'param',
  'source',
  'track',
  'wbr',
]);

/** The HTML parser's "special" elements: an end tag of any other element
 * that one of these sits above closes nothing. */
const SPECIAL_ELEMENTS = new Set([
  'address',
  'applet',
  'article',
  'aside',
  'blockquote',
  'button',
  'caption',
  'center',
  'colgroup',
  'dd',
  'details',
  'dir',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'frameset',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hgroup',
  'li',
  'listing',
  'main',
  'marquee',
  'menu',
  'nav',
  'object',
  'ol',
  'p',
  'plaintext',
  'pre',
  'search',
  'section',
  'select',
  'summary',
  'table',
  'tbody',
  'td',
  'template',
  'tfoot',
  'th',
  'thead',
  'tr',
  'ul',
]);

/** Elements an end tag of another element does not close past (the
 * parser's default scope). */
const SCOPE_ELEMENTS = new Set([
  'applet',
  'caption',
  'marquee',
  'object',
  'table',
  'td',
  'th',
  'template',
]);

/** End tags that close past everything but a table or a template. */
const TABLE_END_TAGS = new Set([
  'caption',
  'table',
  'tbody',
  'td',
  'tfoot',
  'th',
  'thead',
  'tr',
]);

/** Start tags that end an open paragraph: a `<p>` needs no end tag before
 * a block. */
const ENDS_PARAGRAPH = new Set([
  'address',
  'article',
  'aside',
  'blockquote',
  'center',
  'dd',
  'details',
  'dialog',
  'dir',
  'div',
  'dl',
  'dt',
  'fieldset',
  'figcaption',
  'figure',
  'footer',
  'form',
  'h1',
  'h2',
  'h3',
  'h4',
  'h5',
  'h6',
  'header',
  'hgroup',
  'hr',
  'li',
  'listing',
  'main',
  'menu',
  'nav',
  'ol',
  'p',
  'pre',
  'search',
  'section',
  'summary',
  'table',
  'ul',
]);

/** The special elements a list item's or a definition's start tag looks
 * back past for the open one it ends. */
const ITEM_SCOPE_PASSES = new Set(['address', 'div', 'dd', 'dt', 'li', 'p']);

/** Elements that are never content. */
const DROPPED_ELEMENTS = new Set([
  'dialog',
  'nav',
  'search',
  'select',
  'template',
]);

/** Roles that are never content: landmarks around it, dialogs, menus. */
const DROPPED_ROLES = new Set([
  'alertdialog',
  'banner',
  'complementary',
  'contentinfo',
  'dialog',
  'menu',
  'menubar',
  'navigation',
  'search',
  'toolbar',
]);

/** Hidden by an inline style. */
const HIDDEN_STYLE =
  /(?:^|;)\s*(?:display\s*:\s*none|visibility\s*:\s*hidden)\b/i;

/** An id or class that names cookies or consent, and one that names a
 * banner: both on one element make it a cookie notice. */
const CONSENT_NAME = /cookie|consent|gdpr/;
const NOTICE_NAME =
  /banner|bar(?![a-z])|notice|notification|dialog|popup|pop-up|modal|overlay|wall(?![a-z])|(?<!p)layer(?![a-z])|prompt|sdk|hinweis/;

/** Sectioning content and the roles it carries: a header or a footer in
 * it is its own, not the page's banner or footer. */
const SECTIONING_ELEMENTS = new Set([
  'article',
  'aside',
  'main',
  'nav',
  'section',
]);
const SECTIONING_ROLES = new Set([
  'article',
  'complementary',
  'main',
  'navigation',
  'region',
]);

const HEADING_NAME = /^h[1-6]$/;

/** The ids single-page apps mount themselves on. */
const APP_ROOT_IDS = new Set([
  '___gatsby',
  '__next',
  '__nuxt',
  'app',
  'app-root',
  'root',
]);

/** What an open element counts toward, for what opens inside it. */
type Depth =
  | 'sectioning' // a header or a footer in it is its own
  | 'articleOrSection' // an aside in it is part of it
  | 'heading' // a button in it is the heading's text
  | 'foreign' // svg or math: `/>` ends an element
  | 'dropped'
  | 'main'
  | 'article';

interface OpenElement {
  readonly name: string;
  /** Where its start tag begins. */
  readonly start: number;
  /** What it counts toward while it is open. */
  readonly raises: readonly Depth[];
  /** What it was recorded as when it ends. */
  readonly kind: 'drop' | 'main' | 'article' | 'mount' | null;
  /** How many runs of text came before its content. */
  readonly textBefore: number;
}

interface Range {
  readonly start: number;
  readonly end: number;
}

/** What one pass over a page found. */
interface PageMap {
  /** Outermost hidden or non-content elements, in document order. */
  readonly drops: Range[];
  /** Outermost `<main>` or `role="main"` elements outside drops. */
  readonly mains: Range[];
  /** Outermost articles outside drops. */
  readonly articles: Range[];
  /** Where the body's content begins: after `<body>`, or 0 without one. */
  readonly bodyStart: number;
  /** Where empty custom elements and app roots begin. */
  readonly mounts: number[];
  /** Whether the page has a script a browser runs. */
  readonly scripts: boolean;
  /** The `href` of the first `<link rel="canonical">`, as written. */
  readonly canonicalHref: string | null;
}

/** An element's attributes by lowercase name, the first of each name. */
function attributesOf(source: string): Map<string, string> {
  const attributes = new Map<string, string>();
  if (source.trim() === '') return attributes;
  for (const match of source.matchAll(ATTRIBUTE)) {
    const name = (match[1] ?? '').toLowerCase();
    if (attributes.has(name)) continue;
    attributes.set(name, match[2] ?? match[3] ?? match[4] ?? '');
  }
  return attributes;
}

/** The element's role: the first token of its `role`, lowercased. */
function roleOf(attributes: Map<string, string>): string {
  return (
    (attributes.get('role') ?? '').trim().toLowerCase().split(/\s+/)[0] ?? ''
  );
}

/** A `<script>` a browser runs: no type, a JavaScript type, or a module —
 * not data (`application/ld+json`, an import map). */
function runsScript(attributes: Map<string, string>): boolean {
  const type = (attributes.get('type') ?? '').trim().toLowerCase();
  return (
    type === '' ||
    type === 'module' ||
    /javascript|ecmascript|jscript|livescript/.test(type)
  );
}

/** Hidden by an attribute or an inline style. `hidden="until-found"` is
 * content a find in the page reveals. */
function isHidden(attributes: Map<string, string>): boolean {
  const hidden = attributes.get('hidden');
  if (hidden !== undefined && hidden.trim().toLowerCase() !== 'until-found') {
    return true;
  }
  if (attributes.get('aria-hidden')?.trim().toLowerCase() === 'true') {
    return true;
  }
  const style = attributes.get('style');
  return style !== undefined && HIDDEN_STYLE.test(style);
}

/** Text anywhere: a run of it between two tokens. */
const NON_SPACE = /\S/g;

/** Read the page's elements in one pass. */
function mapPage(html: string): PageMap {
  const drops: Range[] = [];
  const mains: Range[] = [];
  const articles: Range[] = [];
  const mounts: number[] = [];
  let bodyStart = -1;
  let scripts = false;
  let canonicalHref: string | null = null;
  const stack: OpenElement[] = [];
  // Where the open elements of each name sit on the stack, and the open
  // elements a tag does not look back past: what the parser looks for, in
  // constant time.
  const openByName = new Map<string, number[]>();
  const specials: number[] = [];
  const scopes: number[] = [];
  const itemScopes: number[] = [];
  const tables: number[] = [];
  const headings: number[] = [];
  const boundaries = [specials, scopes, itemScopes, tables, headings];
  const depth: Record<Depth, number> = {
    sectioning: 0,
    articleOrSection: 0,
    heading: 0,
    foreign: 0,
    dropped: 0,
    main: 0,
    article: 0,
  };
  // Panels a control shows: hidden until it is used, and content.
  const controlled = new Set<string>();
  let dropStart = 0;
  let textRuns = 0;
  let readTo = 0;

  /** Count a run of text between `readTo` and `before`. */
  const readText = (before: number): void => {
    NON_SPACE.lastIndex = readTo;
    const found = NON_SPACE.exec(html);
    if (found !== null && found.index < before) textRuns += 1;
  };

  const top = (positions: readonly number[] | undefined): number =>
    positions !== undefined && positions.length > 0
      ? (positions[positions.length - 1] ?? -1)
      : -1;

  /** The innermost open element of any of `names`. */
  const innermost = (...names: string[]): number =>
    Math.max(-1, ...names.map((name) => top(openByName.get(name))));

  const close = (element: OpenElement, end: number): void => {
    const index = stack.length;
    openByName.get(element.name)?.pop();
    for (const positions of boundaries) {
      if (top(positions) === index) positions.pop();
    }
    for (const raised of element.raises) depth[raised] -= 1;
    if (element.kind === 'drop') {
      if (depth.dropped === 0) drops.push({ start: dropStart, end });
    } else if (element.kind === 'main') {
      mains.push({ start: element.start, end });
    } else if (element.kind === 'article') {
      articles.push({ start: element.start, end });
    } else if (
      element.kind === 'mount' &&
      textRuns === element.textBefore &&
      depth.dropped === 0
    ) {
      mounts.push(element.start);
    }
  };

  /** Pop the stack down to `index`: that element ends at `end`, the ones
   * above it, which the token closed implicitly, where the token begins. */
  const popTo = (index: number, end: number, implicitEnd: number): void => {
    while (stack.length > index) {
      const element = stack.pop();
      if (element === undefined) break;
      close(element, stack.length === index ? end : implicitEnd);
    }
  };

  /** End what a start tag of `name` at `at` ends without an end tag, as the
   * parser does: the open list item, definition, button, table row, cell
   * or table section it follows, an open paragraph before a block, an open
   * heading before another. */
  const endImplied = (name: string, at: number): void => {
    let sibling = -1;
    let barrier = -1;
    if (name === 'li') {
      sibling = innermost('li');
      barrier = top(itemScopes);
    } else if (name === 'dd' || name === 'dt') {
      sibling = innermost('dd', 'dt');
      barrier = top(itemScopes);
    } else if (name === 'button') {
      sibling = innermost('button');
      barrier = top(scopes);
    } else if (name === 'tr') {
      sibling = innermost('tr');
      barrier = top(tables);
    } else if (name === 'td' || name === 'th') {
      sibling = innermost('td', 'th');
      barrier = top(tables);
    } else if (name === 'thead' || name === 'tbody' || name === 'tfoot') {
      sibling = innermost('thead', 'tbody', 'tfoot');
      barrier = top(tables);
    }
    if (sibling > barrier) popTo(sibling, at, at);
    if (ENDS_PARAGRAPH.has(name)) {
      const paragraph = innermost('p');
      if (paragraph > Math.max(top(scopes), innermost('button'))) {
        popTo(paragraph, at, at);
      }
    }
    if (HEADING_NAME.test(name) && top(headings) === stack.length - 1) {
      popTo(stack.length - 1, at, at);
    }
  };

  const open = (
    name: string,
    start: number,
    attributes: Map<string, string>,
  ): void => {
    const role = roleOf(attributes);
    const id = (attributes.get('id') ?? '').trim();
    for (const target of (attributes.get('aria-controls') ?? '').split(/\s+/)) {
      if (target !== '') controlled.add(target);
    }
    const isMain = name === 'main' || role === 'main';
    const isArticle = name === 'article' || role === 'article';
    const isHeading = HEADING_NAME.test(name);
    const dropped =
      DROPPED_ELEMENTS.has(name) ||
      DROPPED_ROLES.has(role) ||
      (name === 'button' && depth.heading === 0) ||
      ((name === 'header' || name === 'footer') && depth.sectioning === 0) ||
      (name === 'aside' && depth.articleOrSection === 0) ||
      (isHidden(attributes) &&
        role !== 'tabpanel' &&
        role !== 'region' &&
        !controlled.has(id)) ||
      (depth.main + depth.article === 0 && consentNotice(attributes));
    let kind: OpenElement['kind'] = null;
    if (dropped) {
      if (depth.dropped === 0) dropStart = start;
      kind = 'drop';
    } else if (isMain && depth.main + depth.dropped === 0) {
      kind = 'main';
    } else if (isArticle && depth.article + depth.dropped === 0) {
      kind = 'article';
    } else if (
      APP_ROOT_IDS.has(id.toLowerCase()) ||
      (name.includes('-') && depth.foreign === 0)
    ) {
      kind = 'mount';
    }
    const raises: Depth[] = [];
    if (SECTIONING_ELEMENTS.has(name) || SECTIONING_ROLES.has(role)) {
      raises.push('sectioning');
    }
    if (
      name === 'article' ||
      name === 'section' ||
      role === 'article' ||
      role === 'region'
    ) {
      raises.push('articleOrSection');
    }
    if (isHeading) raises.push('heading');
    if (name === 'svg' || name === 'math') raises.push('foreign');
    if (dropped) raises.push('dropped');
    if (isMain) raises.push('main');
    if (isArticle) raises.push('article');
    for (const raised of raises) depth[raised] += 1;
    const index = stack.length;
    stack.push({ name, start, raises, kind, textBefore: textRuns });
    const positions = openByName.get(name);
    if (positions === undefined) openByName.set(name, [index]);
    else positions.push(index);
    if (SPECIAL_ELEMENTS.has(name)) {
      specials.push(index);
      if (!ITEM_SCOPE_PASSES.has(name)) itemScopes.push(index);
    }
    if (SCOPE_ELEMENTS.has(name)) scopes.push(index);
    if (name === 'table' || name === 'template') tables.push(index);
    if (isHeading) headings.push(index);
  };

  /** Whether an end tag of `name` closes its open element at `target`. The
   * parser ignores one that would close past a special element (a table
   * cell, a button, a list) it is not. */
  const closes = (name: string, target: number): boolean => {
    if (name === 'template') return true;
    if (TABLE_END_TAGS.has(name)) return top(tables) <= target;
    if (!SPECIAL_ELEMENTS.has(name)) return top(specials) < target;
    if (top(scopes) > target) return false;
    if (name === 'p') return innermost('button') < target;
    if (name === 'li') return innermost('ul', 'ol') < target;
    return true;
  };

  for (const match of html.matchAll(TOKEN)) {
    const start = match.index;
    const after = start + match[0].length;
    readText(start);
    readTo = after;
    const rawName = match[1];
    if (rawName !== undefined) {
      // An element whose content is text: one token, start tag to end tag.
      const name = rawName.toLowerCase();
      if (name === 'script' && runsScript(attributesOf(match[2] ?? ''))) {
        scripts = true;
      }
      if (name === 'textarea' && depth.dropped === 0) {
        drops.push({ start, end: after });
      }
      continue;
    }
    const name = (match[4] ?? '').toLowerCase();
    if (name === '' || name === 'html' || name === 'head') continue;
    if (match[3] === '/') {
      // Any heading's end tag ends the open heading, whatever its level.
      const target = HEADING_NAME.test(name) ? top(headings) : innermost(name);
      if (target !== -1 && closes(name, target)) popTo(target, after, start);
      continue;
    }
    if (name === 'body') {
      if (bodyStart === -1) bodyStart = after;
      continue;
    }
    const source = match[5] ?? '';
    if (name === 'link' && canonicalHref === null) {
      const attributes = attributesOf(source);
      const rel = (attributes.get('rel') ?? '').toLowerCase().split(/\s+/);
      const href = attributes.get('href');
      if (rel.includes('canonical') && href !== undefined) canonicalHref = href;
    }
    endImplied(name, start);
    if (VOID_ELEMENTS.has(name)) continue;
    // `/>` ends an element only in SVG and MathML: a `<div/>` is open.
    const foreign = depth.foreign > 0 || name === 'svg' || name === 'math';
    if (foreign && source.trimEnd().endsWith('/')) continue;
    open(name, start, attributesOf(source));
  }
  readText(html.length);
  popTo(0, html.length, html.length);

  return {
    drops,
    mains,
    articles,
    bodyStart: bodyStart === -1 ? 0 : bodyStart,
    mounts,
    scripts,
    canonicalHref,
  };
}

/** An element whose id or classes name both cookies or consent and a
 * banner: a cookie notice, outside the page's main content. */
function consentNotice(attributes: Map<string, string>): boolean {
  const names =
    `${attributes.get('id') ?? ''} ${attributes.get('class') ?? ''}`.toLowerCase();
  return CONSENT_NAME.test(names) && NOTICE_NAME.test(names);
}

/** The canonical URL `href` names, resolved against the page's URL: an
 * http(s) address of a sane length, else null. */
function canonicalUrlOf(href: string | null, pageUrl: string): string | null {
  if (href === null) return null;
  let url: URL;
  try {
    url = new URL(decodeHtmlEntities(href).trim(), pageUrl);
  } catch {
    // Not an address: the page names no canonical URL.
    return null;
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') return null;
  return url.href.length <= MAX_CANONICAL_URL_CHARS ? url.href : null;
}

/**
 * Read a page's content: the text of its main region without what is not
 * content (see the module note), its canonical URL, and whether its
 * scripts make its content in the browser. `pageUrl` is where the page was
 * read, for a relative canonical link.
 */
export function readPageContent(html: string, pageUrl: string): PageContent {
  const map = mapPage(html);
  const documentElement = DOCUMENT_ELEMENT.exec(html)?.[0] ?? '';

  /** The text of `html` from `start` to `end`, without the drops in it
   * unless `whole`. */
  const textOf = (region: Range, whole = false): string => {
    let markup = documentElement;
    let at = region.start;
    if (!whole) {
      for (const drop of map.drops) {
        if (drop.end <= at) continue;
        if (drop.start >= region.end) break;
        markup += `${html.slice(at, Math.max(at, drop.start))} `;
        at = Math.min(drop.end, region.end);
      }
    }
    markup += html.slice(at, region.end);
    return htmlToText(markup);
  };

  // The page's main region: its longest `<main>`, else its one article,
  // else its body. A region too short to hold the page is passed over for
  // the next, which holds it; a body with everything in it cut (a site
  // hides the page behind an open dialog) is read whole.
  const body = { start: map.bodyStart, end: html.length };
  const regions: { range: Range; text: string }[] = [];
  let main: { range: Range; text: string } | null = null;
  for (const range of map.mains.slice(0, MAX_MAINS)) {
    const text = textOf(range);
    if (main === null || text.length > main.text.length) main = { range, text };
  }
  if (main !== null) regions.push(main);
  if (map.articles.length === 1 && map.articles[0] !== undefined) {
    const range = map.articles[0];
    regions.push({ range, text: textOf(range) });
  }
  const bodyText = textOf(body);
  regions.push({ range: body, text: bodyText });
  const first = regions[0] ?? { range: body, text: bodyText };

  const chosen =
    regions.find((region) => region.text.length >= NEAR_EMPTY_CHARS)?.text ??
    bodyText;
  const text = chosen !== '' ? chosen : htmlToText(html);

  const needsBrowser =
    map.scripts &&
    first.text.length < NEAR_EMPTY_CHARS &&
    (map.mounts.some((at) => at >= first.range.start && at < first.range.end) ||
      textOf(first.range, true) === '');

  return {
    text,
    canonicalUrl: canonicalUrlOf(map.canonicalHref, pageUrl),
    needsBrowser,
  };
}
