/**
 * Link checking for documentation sites. A page's links are read with the
 * renderer's own parser — remark with GFM and math, the same plugins
 * `<Markdown>` runs — so every form the site renders as a link is seen:
 * inline and reference links, autolinks, images, and the `href` / `src`
 * attributes of raw component tags (`<Card href>`, `<Video src>`). Code is
 * never read as a link, because the parser knows where code is.
 *
 * Each link is then judged against what the site serving it answers for the
 * address, resolved the way a browser resolves it (relative to the page's
 * own URL): a page — whose `#fragment` must be one of the ids its headings
 * render —, a file, a redirect (a moved page: link its new address), or
 * nothing at all. The site describes its answers (`LinkSite`); the rules
 * live here, once, for every docs site and for the repository-wide scan of
 * links into them.
 */

import type { Html, Nodes } from 'mdast';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';
import remarkParse from 'remark-parse';
import { unified } from 'unified';
import { visit } from 'unist-util-visit';

import {
  EXPLICIT_ID_PATTERN,
  slugifyHeadingText,
} from '../../markdown/heading-id';
import { rankNearMisses, type NearMissIndex } from './near-miss';

export interface PageLink {
  /** The address as written. */
  url: string;
  /** 1-based position in the source file, frontmatter included. */
  line: number;
  column: number;
  /** A Markdown link or image, a reference definition, or a tag attribute. */
  kind: 'link' | 'image' | 'definition' | 'attribute';
  /** The attribute a raw tag carries it in (`href`), for `attribute` links. */
  attribute?: string;
}

const PARSER = unified().use(remarkParse).use(remarkGfm).use(remarkMath);

/** Frontmatter blanked out character by character, so positions still match. */
function blankFrontmatter(source: string): string {
  const match = /^---\r?\n[\s\S]*?\r?\n---[ \t]*(?:\r?\n|$)/.exec(source);
  if (!match) return source;
  return match[0].replace(/[^\r\n]/g, ' ') + source.slice(match[0].length);
}

function parse(source: string) {
  const text = blankFrontmatter(source);
  return { text, tree: PARSER.parse(text) };
}

const URL_ATTRIBUTES: ReadonlySet<string> = new Set([
  'href',
  'src',
  'poster',
  'srcset',
]);
const ID_ATTRIBUTES: ReadonlySet<string> = new Set(['id', 'name']);
const TAG =
  /<([A-Za-z][\w:.-]*)((?:\s+[^\s"'<>/=]+(?:\s*=\s*(?:"[^"]*"|'[^']*'|[^\s"'=<>`]+))?)*)\s*\/?>/g;
const ATTRIBUTE =
  /([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g;

interface TagAttribute {
  name: string;
  value: string;
  /** Offset of the attribute inside the html node's value. */
  offset: number;
}

/** Every attribute of every tag in raw HTML, comments skipped. */
function tagAttributes(raw: string): TagAttribute[] {
  const html = raw.replace(/<!--[\s\S]*?-->/g, (comment) =>
    comment.replace(/[^\n]/g, ' '),
  );
  const found: TagAttribute[] = [];
  for (const tag of html.matchAll(TAG)) {
    const attributes = tag[2] ?? '';
    const base = (tag.index ?? 0) + 1 + (tag[1]?.length ?? 0);
    for (const attribute of attributes.matchAll(ATTRIBUTE)) {
      const name = attribute[1]?.toLowerCase();
      const value = attribute[2] ?? attribute[3] ?? attribute[4];
      if (!name || value === undefined) continue;
      found.push({ name, value, offset: base + (attribute.index ?? 0) });
    }
  }
  return found;
}

/**
 * A raw HTML node as the author wrote it. The parser strips a paragraph's
 * continuation indent from the node's value, so positions come from the
 * source slice the node spans.
 */
function rawHtml(node: Html, text: string): string {
  const start = node.position?.start.offset;
  const end = node.position?.end.offset;
  return start === undefined || end === undefined
    ? node.value
    : text.slice(start, end);
}

/** Line and column of `offset` inside `raw`, the text `node` spans. */
function positionIn(
  node: Html,
  raw: string,
  offset: number,
): { line: number; column: number } {
  const start = node.position?.start ?? { line: 0, column: 0 };
  const lines = raw.slice(0, offset).split('\n');
  if (lines.length === 1) {
    return { line: start.line, column: start.column + offset };
  }
  return {
    line: start.line + lines.length - 1,
    column: (lines.at(-1)?.length ?? 0) + 1,
  };
}

function collectLinks(text: string, tree: Nodes): PageLink[] {
  const links: PageLink[] = [];
  visit(tree, (node: Nodes) => {
    if (
      node.type === 'link' ||
      node.type === 'image' ||
      node.type === 'definition'
    ) {
      const start = node.position?.start;
      links.push({
        url: node.url,
        line: start?.line ?? 0,
        column: start?.column ?? 0,
        kind: node.type,
      });
      return;
    }
    if (node.type !== 'html') return;
    const raw = rawHtml(node, text);
    for (const attribute of tagAttributes(raw)) {
      if (!URL_ATTRIBUTES.has(attribute.name)) continue;
      const urls =
        attribute.name === 'srcset'
          ? attribute.value
              .split(',')
              .map((candidate) => candidate.trim().split(/\s+/)[0] ?? '')
          : [attribute.value];
      for (const url of urls) {
        if (!url) continue;
        links.push({
          url,
          ...positionIn(node, raw, attribute.offset),
          kind: 'attribute',
          attribute: attribute.name,
        });
      }
    }
  });
  return links;
}

/** Every link a Markdown page renders, in source order. */
export function extractPageLinks(source: string): PageLink[] {
  const { text, tree } = parse(source);
  return collectLinks(text, tree);
}

/** The text a heading renders, as `AnchoredHeading` reads it (images add none). */
function headingText(node: Nodes): string {
  if (node.type === 'image' || node.type === 'imageReference') return '';
  if ('value' in node && typeof node.value === 'string') return node.value;
  if ('children' in node) return node.children.map(headingText).join('');
  return '';
}

function collectAnchors(text: string, tree: Nodes): Set<string> {
  const anchors = new Set<string>();
  visit(tree, (node: Nodes) => {
    if (node.type === 'heading') {
      if (node.depth > 4) return;
      const label = headingText(node);
      const explicit = EXPLICIT_ID_PATTERN.exec(label);
      anchors.add(
        explicit?.[1] ??
          slugifyHeadingText(label.replace(EXPLICIT_ID_PATTERN, '').trim()),
      );
      return;
    }
    if (node.type !== 'html') return;
    for (const attribute of tagAttributes(rawHtml(node, text))) {
      if (ID_ATTRIBUTES.has(attribute.name) && attribute.value) {
        anchors.add(attribute.value);
      }
    }
  });
  return anchors;
}

/**
 * Every id a Markdown page renders a fragment can land on: each heading's
 * (h1–h4, a trailing `{#id}` or its slug, as `AnchoredHeading` renders it)
 * and every `id` / `name` a raw tag carries.
 */
export function extractPageAnchors(source: string): Set<string> {
  const { text, tree } = parse(source);
  return collectAnchors(text, tree);
}

/** A page's links and anchors from one parse. */
export function readPage(source: string): {
  links: PageLink[];
  anchors: Set<string>;
} {
  const { text, tree } = parse(source);
  return {
    links: collectLinks(text, tree),
    anchors: collectAnchors(text, tree),
  };
}

/** What a site answers for an address. */
export type AddressAnswer =
  /** A page; `anchors` when its fragments can be checked, `locale` its language. */
  | { kind: 'page'; anchors?: () => ReadonlySet<string>; locale?: string }
  /** A file: an image, a video, a Markdown export, `llms.txt`. */
  | { kind: 'file' }
  /** A moved page or a section folder, answered with a redirect to `to`. */
  | { kind: 'redirect'; to: string }
  | { kind: 'missing' };

export interface LinkSite {
  /** Every origin the site is served at (`https://docs.tale.dev`). */
  origins: readonly string[];
  /** The answer for a decoded pathname (no query, no fragment). */
  answer: (pathname: string) => AddressAnswer;
  /** Pages scored for a "did you mean" on a missing address, if any. */
  nearMiss?: {
    index: NearMissIndex;
    /** The locale-less route a pathname guesses at (`/de/foo` → `foo`). */
    routeOf: (pathname: string) => string;
    /** The address of a route in the locale of `pathname`. */
    pathFor: (route: string, pathname: string) => string;
  };
}

/** A content page of a site: its file and the URL it is served at. */
export interface SitePage {
  /** Repository-relative path of the Markdown file. */
  file: string;
  /** Absolute URL the page is served at. */
  url: string;
  /** The page's language, when its links must keep the reader in it. */
  locale?: string;
}

/**
 * A documentation site as the repository-wide link lint loads it
 * (`tools/lint-links`): its answers, its content pages, and the tree they
 * live in (whose files are judged as pages, not scanned for addresses).
 */
export interface LinkSiteModule {
  site: LinkSite;
  pages: () => SitePage[];
  /** Repository-relative prefix of the content tree (`docs/`). */
  contentRoot: string;
}

export interface LinkProblem {
  rule:
    | 'link-empty'
    | 'link-script'
    | 'link-target-missing'
    | 'link-via-redirect'
    | 'fragment-missing'
    | 'link-locale-switch';
  detail: string;
}

export interface JudgeContext {
  /** Absolute URL of the page the link sits on; relative links resolve against it. */
  pageUrl: string;
  /** Language of the page the link sits on, when a link must keep it. */
  pageLocale?: string;
  /** Ids the linking page renders, for a same-page `#fragment`. */
  pageAnchors?: ReadonlySet<string>;
  /** Every site whose addresses are judged; any other origin is external. */
  sites: readonly LinkSite[];
}

const IGNORED_SCHEMES = /^(?:mailto|tel|sms|data):/i;

function decodedPath(url: URL): string {
  try {
    return decodeURIComponent(url.pathname);
  } catch {
    return url.pathname;
  }
}

/** Lowest near-miss score still worth naming as "did you mean". */
const SUGGESTION_SCORE = 0.5;

function suggestionFor(site: LinkSite, pathname: string): string {
  // A missing image or file has no page to suggest.
  if (
    !site.nearMiss ||
    /\.[a-z0-9]{1,8}$/i.test(pathname.replace(/\.md$/, ''))
  ) {
    return '';
  }
  const [best] = rankNearMisses(
    site.nearMiss.routeOf(pathname),
    site.nearMiss.index,
  );
  if (!best || best.score < SUGGESTION_SCORE) return '';
  return ` — did you mean ${site.nearMiss.pathFor(best.route, pathname)}?`;
}

/**
 * The problem with one link, or null when it lands: on a page (and, for a
 * `#fragment`, on an id that page renders), on a file, or off the judged
 * sites entirely.
 */
export function judgeLink(
  url: string,
  context: JudgeContext,
): LinkProblem | null {
  const written = url.trim();
  if (written === '') {
    return { rule: 'link-empty', detail: 'the link has no address' };
  }
  if (IGNORED_SCHEMES.test(written)) return null;
  if (/^javascript:/i.test(written)) {
    return {
      rule: 'link-script',
      detail: `"${written}" runs script instead of linking`,
    };
  }
  let target: URL;
  try {
    target = new URL(written, context.pageUrl);
  } catch {
    return {
      rule: 'link-target-missing',
      detail: `"${written}" is not a valid address`,
    };
  }
  const fragment = target.hash ? decodeURIComponent(target.hash.slice(1)) : '';
  const samePage =
    written.startsWith('#') ||
    (target.origin === new URL(context.pageUrl).origin &&
      target.pathname === new URL(context.pageUrl).pathname);
  if (samePage && written.startsWith('#')) {
    if (!fragment || !context.pageAnchors) return null;
    return context.pageAnchors.has(fragment)
      ? null
      : {
          rule: 'fragment-missing',
          detail: `"#${fragment}" is no heading or id on this page`,
        };
  }

  const site = context.sites.find((candidate) =>
    candidate.origins.includes(target.origin),
  );
  if (!site) return null;
  const pathname = decodedPath(target);
  const answer = site.answer(pathname);
  if (answer.kind === 'file') return null;
  if (answer.kind === 'missing') {
    return {
      rule: 'link-target-missing',
      detail: `${target.origin === new URL(context.pageUrl).origin ? pathname : `${target.origin}${pathname}`} is a 404${suggestionFor(site, pathname)}`,
    };
  }
  if (answer.kind === 'redirect') {
    return {
      rule: 'link-via-redirect',
      detail: `${pathname} redirects to ${answer.to} — link the page itself`,
    };
  }
  if (
    context.pageLocale &&
    answer.locale &&
    answer.locale !== context.pageLocale &&
    site.origins.includes(new URL(context.pageUrl).origin)
  ) {
    return {
      rule: 'link-locale-switch',
      detail: `${pathname} is the ${answer.locale} page; a ${context.pageLocale} page keeps the reader in its own language`,
    };
  }
  if (fragment && answer.anchors && !answer.anchors().has(fragment)) {
    return {
      rule: 'fragment-missing',
      detail: `${pathname} renders no heading or id "#${fragment}"`,
    };
  }
  return null;
}
