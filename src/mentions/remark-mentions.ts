/**
 * A remark plugin that turns mentions into `tale-mention` elements, for a
 * renderer to show as chips.
 *
 * Where a mention is comes from the same scan a saving server runs
 * (`collectMentions` in `scan-mentions.ts`) over the same parse, so a chip
 * shows exactly where a mention can have notified someone: never in code,
 * math, an image or a link's text. Parse with the plugin list the text was
 * scanned with (`TASK_REMARK_PLUGINS`), after `normalizeHtmlBlocks`.
 *
 * A token becomes an element with its kind, id and label; a typed `@handle`
 * (when `plain` is on) becomes one with its handle, for the renderer to look
 * up. The element's own text is `@` and the label or handle, so a renderer
 * that maps no component still shows a readable mention.
 *
 * Pure, no React.
 */

import type { Emphasis, Nodes, Parents, PhrasingContent, Root } from 'mdast';
import { decodeString } from 'micromark-util-decode-string';

import { collectMentions, type MentionOccurrence } from './scan-mentions';

/** The element a mention becomes. */
export const MENTION_ELEMENT = 'tale-mention';

export interface RemarkMentionsOptions<Kind extends string> {
  kinds: readonly Kind[];
  /** Whether a typed `@handle` becomes an element too. Text mirrored from
   * elsewhere (an issue tracker's `@people`) turns this off. */
  plain?: boolean;
}

/** The properties of a mention element, as a component receives them. */
export interface MentionElementProps {
  'data-mention-kind'?: string;
  'data-mention-id'?: string;
  'data-mention-label'?: string;
  'data-mention-handle'?: string;
}

function mentionNode(
  text: string,
  properties: Record<string, string>,
): PhrasingContent {
  // An emphasis renamed: mdast has no node of its own for this, and the
  // renamed element keeps the text it would show without a component.
  const node: Emphasis = {
    type: 'emphasis',
    children: [{ type: 'text', value: text }],
    data: { hName: MENTION_ELEMENT, hProperties: properties },
  };
  return node;
}

type Plain = Extract<MentionOccurrence, { type: 'plain' }>;

const ASCII_PUNCTUATION_RE = /^[!-/:-@[-`{-~]$/u;
const CHARACTER_REFERENCE_RE =
  /&(?:#\d{1,7}|#[xX][\da-fA-F]{1,6}|[A-Za-z][A-Za-z\d]{0,31});/uy;

/**
 * Where each offset of a text node's source stands in the node's value,
 * which has its escapes and character references read and the whitespace
 * around a line break dropped. Null when the two cannot be walked in step.
 */
function valueOffsets(source: string, value: string): number[] | null {
  const offsets: number[] = [];
  let at = 0;
  let index = 0;
  while (index < source.length) {
    const character = source[index];
    const escaped = source[index + 1] ?? '';
    if (
      character === '\\' &&
      ASCII_PUNCTUATION_RE.test(escaped) &&
      value[at] === escaped
    ) {
      offsets.push(at, at);
      index += 2;
      at += 1;
      continue;
    }
    if (character === '&') {
      CHARACTER_REFERENCE_RE.lastIndex = index;
      const reference = CHARACTER_REFERENCE_RE.exec(source)?.[0];
      const decoded = reference === undefined ? '' : decodeString(reference);
      if (
        reference !== undefined &&
        decoded !== reference &&
        value.startsWith(decoded, at)
      ) {
        for (let step = 0; step < reference.length; step += 1) {
          offsets.push(at);
        }
        index += reference.length;
        at += decoded.length;
        continue;
      }
    }
    if (character === value[at]) {
      offsets.push(at);
      index += 1;
      at += 1;
      continue;
    }
    if (character === ' ' || character === '\t') {
      offsets.push(at);
      index += 1;
      continue;
    }
    return null;
  }
  offsets.push(at);
  return at === value.length ? offsets : null;
}

/** The pieces a text node splits into around the typed mentions in it. */
function splitText(
  value: string,
  source: string,
  sourceStart: number,
  mentions: readonly Plain[],
): PhrasingContent[] | null {
  // The node's value is the source unless an escape, an entity or a line
  // break in it was read: then each mention is placed by where it stands in
  // the source, never by a search for its words, which an escaped `\@ada`
  // before it would answer too.
  const offsets = value === source ? null : valueOffsets(source, value);
  if (value !== source && offsets === null) return null;
  const pieces: PhrasingContent[] = [];
  let cursor = 0;
  for (const mention of mentions) {
    const from = mention.start - sourceStart;
    const to = mention.end - sourceStart;
    const written = source.slice(from, to);
    const at = offsets === null ? from : (offsets[from] ?? -1);
    const end = offsets === null ? to : (offsets[to] ?? -1);
    if (at < cursor || value.slice(at, end) !== written) continue;
    if (at > cursor)
      pieces.push({ type: 'text', value: value.slice(cursor, at) });
    pieces.push(mentionNode(written, { dataMentionHandle: mention.handle }));
    cursor = end;
  }
  if (pieces.length === 0) return null;
  if (cursor < value.length) {
    pieces.push({ type: 'text', value: value.slice(cursor) });
  }
  return pieces;
}

export function remarkMentions<Kind extends string>(
  options: RemarkMentionsOptions<Kind>,
) {
  const plain = options.plain !== false;
  return (tree: Root, file: { value?: unknown }): void => {
    // Renderers hand the text over as a string; offsets mean nothing for
    // bytes.
    const text = file.value;
    if (typeof text !== 'string' || !text.includes('@')) return;
    const found = collectMentions(tree, text, { kinds: options.kinds });
    if (found.length === 0) return;
    const tokens = new Map<number, MentionOccurrence<Kind>>();
    const typed: Plain[] = [];
    for (const occurrence of found) {
      if (occurrence.type === 'token') tokens.set(occurrence.start, occurrence);
      else if (plain) typed.push(occurrence);
    }

    const visit = (parent: Parents): void => {
      const children: Nodes[] = parent.children;
      for (let index = 0; index < children.length; index += 1) {
        const child = children[index];
        if (child === undefined) continue;
        const start = child.position?.start.offset;
        const end = child.position?.end.offset;
        if (child.type === 'link' && start !== undefined) {
          const token = tokens.get(start);
          if (token?.type === 'token') {
            children[index] = mentionNode(`@${token.label}`, {
              dataMentionKind: token.ref.kind,
              dataMentionId: token.ref.id,
              dataMentionLabel: token.label,
            });
          }
          continue;
        }
        if (child.type === 'text') {
          if (start === undefined || end === undefined) continue;
          const inside = typed.filter(
            (mention) => mention.start >= start && mention.end <= end,
          );
          if (inside.length === 0) continue;
          const pieces = splitText(
            child.value,
            text.slice(start, end),
            start,
            inside,
          );
          if (pieces === null) continue;
          children.splice(index, 1, ...pieces);
          index += pieces.length - 1;
          continue;
        }
        if ('children' in child) visit(child);
      }
    };
    visit(tree);
  };
}
