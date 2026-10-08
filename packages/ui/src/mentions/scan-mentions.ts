/**
 * Where a markdown text mentions someone.
 *
 * Two forms count: a mention token (`mention-token.ts`), and a plain
 * `@handle` a person or a program typed, which the caller resolves against
 * whoever can be mentioned there. The text is parsed the way it is rendered
 * (the task plugin list, with blank lines put around HTML blocks first), so a
 * mention inside code, math, an image or a link's own text is no mention:
 * whoever saves a text and whoever shows it agree on where a mention is.
 *
 * A plain `@handle` needs a boundary before it, in the text as written: the
 * start of a line or paragraph, whitespace, or the opening marker of an
 * emphasis that starts there. So `ada@example.com`, `*user*@example.com` and
 * `` `x`@ada `` mention nobody, and neither does an escaped `\@ada`. Trailing
 * `.`, `_`, `/` and `-` end a sentence, not a handle: `@ada.` is `@ada`.
 *
 * Pure, no React: the platform's backend runs it on every text it saves.
 */

import type { Nodes, Parents, Root, RootContent } from 'mdast';
import remarkParse from 'remark-parse';
import { unified } from 'unified';

import { TASK_REMARK_PLUGINS } from '../markdown/remark-plugin-lists';
import {
  normalizeHtmlBlocksWithOffsets,
  toInputOffset,
} from '../markdown/streaming/normalize-html-blocks';
import {
  formatMentionToken,
  type MentionRef,
  parseMentionUrl,
} from './mention-token';

export type MentionOccurrence<Kind extends string = string> =
  | {
      type: 'token';
      ref: MentionRef<Kind>;
      /** The text inside the brackets, without the leading `@`. */
      label: string;
      start: number;
      end: number;
    }
  | {
      type: 'plain';
      /** The handle after `@`, lowercased, trailing punctuation dropped. */
      handle: string;
      start: number;
      end: number;
    };

export interface MentionScanOptions<Kind extends string> {
  kinds: readonly Kind[];
}

/** What a typed handle may hold. */
const PLAIN_MENTION_RE = /@([a-zA-Z0-9._/-]+)/g;
const TRAILING_PUNCTUATION_RE = /[._/-]+$/;

/** Nodes whose text is never a mention. A link's text is its own: a link
 * cannot hold another, and a mention token is itself a link. */
const OPAQUE = new Set([
  'code',
  'inlineCode',
  'math',
  'inlineMath',
  'html',
  'image',
  'imageReference',
  'definition',
  'linkReference',
]);

const BLOCK_TEXT = new Set(['paragraph', 'heading', 'tableCell']);

const parser = unified().use(remarkParse).use(TASK_REMARK_PLUGINS).freeze();

export interface ParsedMentionMarkdown {
  tree: Root;
  /** The text the tree was parsed from (the input, with blank lines put
   * around HTML blocks). */
  text: string;
  /** The input offset of an offset in `text`. */
  toInputOffset(offset: number): number;
}

/** Parse a task text exactly as the task renderer does. */
export function parseMentionMarkdown(markdown: string): ParsedMentionMarkdown {
  const { text, inserted } = normalizeHtmlBlocksWithOffsets(markdown);
  return {
    tree: parser.parse(text),
    text,
    toInputOffset: (offset) => toInputOffset(inserted, offset),
  };
}

function plainText(node: Nodes): string {
  if ('value' in node && typeof node.value === 'string') return node.value;
  if ('children' in node) return node.children.map(plainText).join('');
  return '';
}

/** Whether a text node that starts with `@` has a boundary before it. */
function startsAtBoundary(
  node: RootContent,
  ancestors: readonly Parents[],
  text: string,
): boolean {
  let current: RootContent = node;
  for (let index = ancestors.length - 1; index >= 0; index -= 1) {
    const parent = ancestors[index];
    if (parent === undefined || parent.children[0] !== current) break;
    if (BLOCK_TEXT.has(parent.type)) return true;
    if (
      parent.type !== 'emphasis' &&
      parent.type !== 'strong' &&
      parent.type !== 'delete'
    ) {
      break;
    }
    // The first thing inside `**…**` that itself starts at a boundary.
    current = parent;
  }
  const start = current.position?.start.offset;
  if (start === undefined) return false;
  return start === 0 || /\s/u.test(text[start - 1] ?? '');
}

/**
 * The mentions in a parsed tree, in order, with offsets into the text the
 * tree was parsed from. A renderer's remark plugin and {@link findMentions}
 * both read a text through this.
 */
export function collectMentions<Kind extends string>(
  tree: Root,
  text: string,
  options: MentionScanOptions<Kind>,
): MentionOccurrence<Kind>[] {
  const found: MentionOccurrence<Kind>[] = [];
  const visit = (node: Nodes, ancestors: Parents[]): void => {
    if (OPAQUE.has(node.type)) return;
    if (node.type === 'link') {
      const ref = parseMentionUrl(node.url, options.kinds);
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (ref !== null && start !== undefined && end !== undefined) {
        found.push({
          type: 'token',
          ref,
          label: plainText(node).replace(/^@/, ''),
          start,
          end,
        });
      }
      return;
    }
    if (node.type === 'text') {
      const start = node.position?.start.offset;
      const end = node.position?.end.offset;
      if (start === undefined || end === undefined) return;
      // The text as written, so an escape or an entity before `@` counts.
      const source = text.slice(start, end);
      for (const match of source.matchAll(PLAIN_MENTION_RE)) {
        const at = match.index;
        const raw = match[1] ?? '';
        const boundary =
          at === 0
            ? startsAtBoundary(node, ancestors, text)
            : /\s/u.test(source[at - 1] ?? '');
        if (!boundary) continue;
        const handle = raw.replace(TRAILING_PUNCTUATION_RE, '');
        if (handle === '') continue;
        found.push({
          type: 'plain',
          handle: handle.toLowerCase(),
          start: start + at,
          end: start + at + 1 + handle.length,
        });
      }
      return;
    }
    if ('children' in node) {
      const next = [...ancestors, node];
      for (const child of node.children) visit(child, next);
    }
  };
  visit(tree, []);
  return found.toSorted((a, b) => a.start - b.start);
}

/** The mentions in a markdown text, with offsets into that text. */
export function findMentions<Kind extends string>(
  markdown: string,
  options: MentionScanOptions<Kind>,
): MentionOccurrence<Kind>[] {
  if (!markdown.includes('@') && !markdown.includes('mention:')) return [];
  const parsed = parseMentionMarkdown(markdown);
  const found = collectMentions(parsed.tree, parsed.text, options);
  for (const occurrence of found) {
    occurrence.start = parsed.toInputOffset(occurrence.start);
    occurrence.end = parsed.toInputOffset(occurrence.end);
  }
  return found;
}

/**
 * Replace mentions in a text: `replace` answers the new text of an
 * occurrence, or null to leave it as written. Offsets are the text's, as
 * {@link findMentions} answers them.
 */
export function spliceMentions<Kind extends string>(
  markdown: string,
  occurrences: readonly MentionOccurrence<Kind>[],
  replace: (occurrence: MentionOccurrence<Kind>) => string | null,
): string {
  let result = markdown;
  for (const occurrence of occurrences.toSorted((a, b) => b.start - a.start)) {
    const next = replace(occurrence);
    if (next === null) continue;
    result =
      result.slice(0, occurrence.start) + next + result.slice(occurrence.end);
  }
  return result;
}

export interface MentionNameOptions<
  Kind extends string,
> extends MentionScanOptions<Kind> {
  /** The current name of whoever a token names, or null when they cannot be
   * found (the token's own label is shown then). */
  nameOf?: (ref: MentionRef<Kind>) => string | null | undefined;
}

/**
 * A text with every token read as `@` and the name of whoever it names, for
 * places that show text without rendering markdown: a search snippet, an
 * activity line, a notification excerpt.
 */
export function mentionPlainText<Kind extends string>(
  markdown: string,
  options: MentionNameOptions<Kind>,
): string {
  const occurrences = findMentions(markdown, options).filter(
    (occurrence) => occurrence.type === 'token',
  );
  return spliceMentions(markdown, occurrences, (occurrence) =>
    occurrence.type === 'token'
      ? `@${options.nameOf?.(occurrence.ref) ?? occurrence.label}`
      : null,
  );
}

/**
 * A text whose tokens carry the current name of whoever they name, for
 * readers that see the stored form (an agent reading its task): the id stays
 * what it acts on, and the name it reads is today's.
 */
export function relabelMentionTokens<Kind extends string>(
  markdown: string,
  options: MentionNameOptions<Kind>,
): string {
  const occurrences = findMentions(markdown, options);
  return spliceMentions(markdown, occurrences, (occurrence) => {
    if (occurrence.type !== 'token') return null;
    const name = options.nameOf?.(occurrence.ref);
    return name === null || name === undefined
      ? null
      : formatMentionToken({ ...occurrence.ref, label: name });
  });
}

/** A token opened at the end of a text and never closed: what a cut leaves
 * of `[@Ada Lovelace](mention:user/…)`. */
const PARTIAL_TOKEN_RE = /\[(?:@(?:[^\]\\\n]|\\.)*(?:\](?:\(([^)\s]*))?)?)?$/u;

/**
 * A text that was cut somewhere, without the half mention token the cut may
 * have left at its end.
 */
export function dropPartialMentionToken(cut: string): string {
  const partial = PARTIAL_TOKEN_RE.exec(cut);
  if (partial === null) return cut;
  const destination = partial[1];
  const mentionLike =
    destination === undefined ||
    'mention:'.startsWith(destination) ||
    destination.startsWith('mention:');
  return mentionLike ? cut.slice(0, partial.index).trimEnd() : cut;
}

/**
 * Cut a text to `max` characters without leaving half a mention token at the
 * end: a token the cut would split is dropped whole.
 */
export function cutMentionText(markdown: string, max: number): string {
  if (markdown.length <= max) return markdown;
  return dropPartialMentionToken(markdown.slice(0, max));
}
