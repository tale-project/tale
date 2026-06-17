'use node';

/**
 * Faithful TypeScript port of crawl4ai's `PruningContentFilter` → markdown
 * pipeline, used by the (now-removed) Python crawler service via
 * `DefaultMarkdownGenerator(content_filter=PruningContentFilter(threshold=0.4))`.
 *
 * The Python crawler delegated this density-based main-content extraction to
 * crawl4ai's Rust/Python internals. crawl4ai has no npm package, so this
 * reproduces the same algorithm in TS over a jsdom DOM + turndown:
 *
 *   1. Pre-remove structural / non-content nodes:
 *      nav, footer, header, aside, script, style, form, iframe, noscript,
 *      select, option + HTML comments.
 *   2. Score every block element with the composite metric:
 *        score = 0.4*text_density + 0.2*(1 - link_density) + 0.2*tag_weight
 *              + 0.1*class_id_bonus + 0.1*log(text_len + 1)/log_norm
 *      (link density is a *penalty*, so the contribution is `1 - link_density`).
 *   3. Negative class/id regex drops navigational chrome that survived tag
 *      pre-removal: /nav|footer|header|sidebar|ads|comment|promo|advert|
 *      social|share/i (−0.5 per match into the class_id term).
 *   4. Tag weights:
 *        div .5, p 1, article 1.5, section 1, span .3, li .5, ul .5, ol .5,
 *        h1 1.2, h2 1.1, h3 1.0, h4 .9, h5 .8, h6 .7
 *   5. Prune blocks scoring below the 0.4 threshold; reassemble the surviving
 *      HTML and convert to markdown via turndown (links ignored, matching the
 *      Python `options={"ignore_links": True}`).
 *
 * NOTE (fidelity): crawl4ai's exact internal weights are not publicly pinned to
 * a single revision; these constants match the prompt's stated contract for
 * this port. The threshold (0.4), the pre-removal set, the negative regex, and
 * the tag-weight map are reproduced exactly. Treat the precise blend as
 * behaviourally-equivalent rather than bit-identical to crawl4ai.
 */

import { JSDOM } from 'jsdom';
import TurndownService from 'turndown';

const THRESHOLD = 0.4;

const PRE_REMOVE_TAGS = [
  'nav',
  'footer',
  'header',
  'aside',
  'script',
  'style',
  'form',
  'iframe',
  'noscript',
  'select',
  'option',
];

const NEGATIVE_CLASS_ID_RE =
  /nav|footer|header|sidebar|ads|comment|promo|advert|social|share/i;

const TAG_WEIGHTS: Record<string, number> = {
  div: 0.5,
  p: 1.0,
  article: 1.5,
  section: 1.0,
  span: 0.3,
  li: 0.5,
  ul: 0.5,
  ol: 0.5,
  h1: 1.2,
  h2: 1.1,
  h3: 1.0,
  h4: 0.9,
  h5: 0.8,
  h6: 0.7,
};

/** Block-level tags eligible for scoring/pruning. */
const SCOREABLE_TAGS = new Set(Object.keys(TAG_WEIGHTS));

/** Normalizer for the log(len+1) term so it lands in roughly [0, 1]. */
const LOG_LEN_NORM = Math.log(5000 + 1);

interface DomNode {
  tagName: string;
  textContent: string | null;
  getAttribute(name: string): string | null;
  querySelectorAll(selector: string): ArrayLike<DomNode>;
  remove(): void;
  outerHTML: string;
}

function textLength(node: DomNode): number {
  return (node.textContent ?? '').trim().length;
}

/** Fraction of text inside <a> descendants. Higher = more navigational. */
function linkDensity(node: DomNode): number {
  const total = textLength(node);
  if (total === 0) {
    return 0;
  }
  let linkChars = 0;
  const anchors = node.querySelectorAll('a');
  for (let i = 0; i < anchors.length; i += 1) {
    linkChars += (anchors[i].textContent ?? '').trim().length;
  }
  return Math.min(1, linkChars / total);
}

/**
 * Text density: ratio of non-whitespace text to total markup length. A
 * content-rich block has a high text:tag ratio; chrome (lots of nested tags,
 * little text) scores low.
 */
function textDensity(node: DomNode): number {
  const html = node.outerHTML;
  if (!html || html.length === 0) {
    return 0;
  }
  const text = (node.textContent ?? '').trim().length;
  return Math.min(1, text / html.length);
}

/** class/id signal: −0.5 per negative-regex match, clamped to [−1, 0]. */
function classIdBonus(node: DomNode): number {
  const cls = node.getAttribute('class') ?? '';
  const id = node.getAttribute('id') ?? '';
  let bonus = 0;
  if (NEGATIVE_CLASS_ID_RE.test(cls)) {
    bonus -= 0.5;
  }
  if (NEGATIVE_CLASS_ID_RE.test(id)) {
    bonus -= 0.5;
  }
  return Math.max(-1, bonus);
}

/** Composite PruningContentFilter score for one block element. */
export function scoreNode(node: DomNode): number {
  const tag = node.tagName.toLowerCase();
  const tagWeight = TAG_WEIGHTS[tag] ?? 0;
  const td = textDensity(node);
  const ld = linkDensity(node);
  const cid = classIdBonus(node);
  const lenTerm = Math.min(1, Math.log(textLength(node) + 1) / LOG_LEN_NORM);

  return (
    0.4 * td + 0.2 * (1 - ld) + 0.2 * tagWeight + 0.1 * cid + 0.1 * lenTerm
  );
}

/**
 * Run the PruningContentFilter over an HTML string and return the pruned
 * main-content HTML. Pre-removes structural tags + comments, then drops every
 * scoreable block scoring below the 0.4 threshold (deepest-first so a pruned
 * parent doesn't strand already-evaluated children).
 */
export function pruneHtml(html: string): string {
  const dom = new JSDOM(html);
  const { document } = dom.window;

  // 1. Pre-remove structural / non-content tags.
  for (const tag of PRE_REMOVE_TAGS) {
    for (const el of Array.from(document.querySelectorAll(tag))) {
      el.remove();
    }
  }

  // 1b. Remove HTML comments.
  const walker = document.createTreeWalker(
    document.documentElement,
    dom.window.NodeFilter.SHOW_COMMENT,
  );
  const comments: Node[] = [];
  let current = walker.nextNode();
  while (current) {
    comments.push(current);
    current = walker.nextNode();
  }
  for (const c of comments) {
    c.parentNode?.removeChild(c);
  }

  // 2/3. Score + prune scoreable blocks, deepest-first.
  const candidates = Array.from(document.querySelectorAll('*')).filter((el) =>
    SCOREABLE_TAGS.has(el.tagName.toLowerCase()),
  );
  // Deepest-first: sort by DOM depth descending.
  candidates.sort((a, b) => depth(b) - depth(a));
  for (const el of candidates) {
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- jsdom Element satisfies the structural DomNode contract used by scoreNode
    if (scoreNode(el as unknown as DomNode) < THRESHOLD) {
      el.remove();
    }
  }

  const body = document.body;
  return body ? body.innerHTML : document.documentElement.innerHTML;
}

function depth(el: Element): number {
  let d = 0;
  let p: Element | null = el.parentElement;
  while (p) {
    d += 1;
    p = p.parentElement;
  }
  return d;
}

let turndown: TurndownService | null = null;

function getTurndown(): TurndownService {
  if (turndown === null) {
    turndown = new TurndownService({
      headingStyle: 'atx',
      codeBlockStyle: 'fenced',
    });
    // Match Python `options={"ignore_links": True}`: render link text only.
    turndown.addRule('ignoreLinks', {
      filter: 'a',
      replacement: (content) => content,
    });
  }
  return turndown;
}

/**
 * Full pipeline: prune the HTML to its main content, then convert to markdown.
 * Mirrors `result.markdown.fit_markdown` from the Python crawler.
 */
export function htmlToFitMarkdown(html: string): string {
  const pruned = pruneHtml(html);
  return getTurndown().turndown(pruned).trim();
}

/** Convert HTML to markdown without pruning (mirrors `raw_markdown`). */
export function htmlToRawMarkdown(html: string): string {
  return getTurndown().turndown(html).trim();
}
