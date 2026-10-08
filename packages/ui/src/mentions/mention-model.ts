/**
 * A text with mentions as a field shows it: the words someone reads and
 * edits, and the ranges of it that are mentions.
 *
 * A stored text names whom it mentions with a token
 * (`[@Ada Lovelace](mention:user/…)`, `mention-token.ts`). A field shows the
 * same text with each token read as `@` and the person's current name, and
 * remembers where those names stand and whom they name. Editing works on the
 * visible text; the field hands back the stored form
 * ({@link serializeMentionDoc}), so whoever holds the value keeps a plain
 * string.
 *
 * Pure, no React.
 */

import {
  formatMentionToken,
  type MentionRef,
  normalizeMentionLabel,
} from './mention-token';
import { findMentions } from './scan-mentions';

export interface MentionRange<
  Kind extends string = string,
> extends MentionRef<Kind> {
  /** Where `@` stands in the visible text. */
  start: number;
  /** Just past the name. */
  end: number;
  /** The name shown after `@`. */
  name: string;
}

export interface MentionDoc<Kind extends string = string> {
  /** What the field shows. */
  text: string;
  /** The mentions in it, in order, never overlapping. */
  ranges: readonly MentionRange<Kind>[];
}

/** Someone a typed `@handle` names. */
export interface MentionTarget<
  Kind extends string = string,
> extends MentionRef<Kind> {
  name: string;
}

export interface MentionDocOptions<Kind extends string> {
  kinds: readonly Kind[];
  /** The current name of whoever a token names; the token's own label is
   * shown when this answers nothing. */
  nameOf?: (ref: MentionRef<Kind>) => string | null | undefined;
  /** Whom a typed `@handle` names, for text written before mentions were
   * stored as tokens. Unresolved, or without this, a handle stays text. */
  resolvePlain?: (handle: string) => MentionTarget<Kind> | null | undefined;
}

/** A name as a field shows it after `@`: on one line, never empty. */
export function mentionDisplayName(name: string, id: string): string {
  return normalizeMentionLabel(name) || id;
}

/** Read a stored text into what a field shows. */
export function parseMentionDoc<Kind extends string>(
  value: string,
  options: MentionDocOptions<Kind>,
): MentionDoc<Kind> {
  const ranges: MentionRange<Kind>[] = [];
  let text = '';
  let cursor = 0;
  for (const occurrence of findMentions(value, { kinds: options.kinds })) {
    let target: MentionTarget<Kind> | null | undefined;
    if (occurrence.type === 'token') {
      target = {
        ...occurrence.ref,
        name: options.nameOf?.(occurrence.ref) ?? occurrence.label,
      };
    } else {
      target = options.resolvePlain?.(occurrence.handle);
    }
    if (target === null || target === undefined) continue;
    text += value.slice(cursor, occurrence.start);
    const name = mentionDisplayName(target.name, target.id);
    ranges.push({
      kind: target.kind,
      id: target.id,
      name,
      start: text.length,
      end: text.length + 1 + name.length,
    });
    text += `@${name}`;
    cursor = occurrence.end;
  }
  text += value.slice(cursor);
  return { text, ranges };
}

/** The stored form of what a field shows: each mention as its token. */
export function serializeMentionDoc(doc: MentionDoc): string {
  return serializeWithOffsets(doc).value;
}

function serializeWithOffsets(doc: MentionDoc): {
  value: string;
  starts: number[];
} {
  let value = '';
  let cursor = 0;
  const starts: number[] = [];
  for (const range of doc.ranges) {
    value += doc.text.slice(cursor, range.start);
    starts.push(value.length);
    value += formatMentionToken({
      kind: range.kind,
      id: range.id,
      label: range.name,
    });
    cursor = range.end;
  }
  value += doc.text.slice(cursor);
  return { value, starts };
}

/**
 * The doc without the mentions that would not be mentions once stored: one
 * that ended up inside code or math, or after a `!` or a `\`, which turn a
 * token into an image or plain brackets. Their names stay, as text.
 */
export function settleMentionDoc<Kind extends string>(
  doc: MentionDoc<Kind>,
  kinds: readonly Kind[],
): MentionDoc<Kind> {
  if (doc.ranges.length === 0) return doc;
  const { value, starts } = serializeWithOffsets(doc);
  const tokens = new Set(
    findMentions(value, { kinds })
      .filter((occurrence) => occurrence.type === 'token')
      .map((occurrence) => occurrence.start),
  );
  const ranges = doc.ranges.filter((_, index) =>
    tokens.has(starts[index] ?? -1),
  );
  return ranges.length === doc.ranges.length ? doc : { ...doc, ranges };
}

export interface MentionTextChange<Kind extends string> {
  doc: MentionDoc<Kind>;
  /** Mentions the change cut into: their remaining characters are text. */
  cut: MentionRange<Kind>[];
  /** Where the change starts, in both texts. */
  from: number;
  /** Where it ends in the text before. */
  previousEnd: number;
  /** Where it ends in the text after. */
  nextEnd: number;
}

/**
 * The doc after the field's text changed to `next`. Mentions before the
 * change stay, mentions after it move along, and a mention the change
 * touches inside turns into text: typing inside a name makes it a word.
 * Typing right at a name's start or end leaves it whole.
 *
 * `caret` is where the caret stands after the change; the change is taken
 * to end there when the text allows, which tells "aa" + "a" from "a" + "aa".
 */
export function applyTextChange<Kind extends string>(
  doc: MentionDoc<Kind>,
  next: string,
  caret?: number,
): MentionTextChange<Kind> {
  const previous = doc.text;
  if (previous === next) {
    return {
      doc,
      cut: [],
      from: next.length,
      previousEnd: next.length,
      nextEnd: next.length,
    };
  }
  const shorter = Math.min(previous.length, next.length);
  let suffix = -1;
  if (caret !== undefined && caret >= 0 && caret <= next.length) {
    const after = next.length - caret;
    if (after <= shorter && previous.endsWith(next.slice(caret))) {
      suffix = after;
    }
  }
  let prefix = 0;
  const prefixLimit = shorter - Math.max(suffix, 0);
  while (prefix < prefixLimit && previous[prefix] === next[prefix]) {
    prefix += 1;
  }
  if (suffix < 0) {
    suffix = 0;
    while (
      suffix < shorter - prefix &&
      previous[previous.length - 1 - suffix] === next[next.length - 1 - suffix]
    ) {
      suffix += 1;
    }
  }
  const previousEnd = previous.length - suffix;
  const nextEnd = next.length - suffix;
  const delta = next.length - previous.length;
  const ranges: MentionRange<Kind>[] = [];
  const cut: MentionRange<Kind>[] = [];
  for (const range of doc.ranges) {
    if (range.end <= prefix) ranges.push(range);
    else if (range.start >= previousEnd) {
      ranges.push(moveMentionRange(range, delta));
    } else cut.push(range);
  }
  return {
    doc: { text: next, ranges },
    cut,
    from: prefix,
    previousEnd,
    nextEnd,
  };
}

/** Mentions placed in a doc's text, e.g. the ones a paste or a pick put
 * there. A range whose text is not `@` and its name is left out. */
export function addMentionRanges<Kind extends string>(
  doc: MentionDoc<Kind>,
  added: readonly MentionRange<Kind>[],
): MentionDoc<Kind> {
  const fitting = added.filter(
    (range) =>
      doc.text.slice(range.start, range.end) === `@${range.name}` &&
      doc.ranges.every(
        (existing) =>
          existing.end <= range.start || existing.start >= range.end,
      ),
  );
  if (fitting.length === 0) return doc;
  return {
    text: doc.text,
    ranges: [...doc.ranges, ...fitting].toSorted((a, b) => a.start - b.start),
  };
}

/** A span grown to whole mentions, so an edit never takes half a name. */
export function widenToMentions(
  doc: MentionDoc,
  start: number,
  end: number,
): { start: number; end: number } {
  let from = start;
  let to = end;
  for (const range of doc.ranges) {
    if (range.start < to && range.end > from) {
      from = Math.min(from, range.start);
      to = Math.max(to, range.end);
    }
  }
  return { start: from, end: to };
}

/** The mention a Backspace at `caret` would bite into: one that ends there
 * or holds the caret. */
export function mentionBefore<Kind extends string>(
  doc: MentionDoc<Kind>,
  caret: number,
): MentionRange<Kind> | null {
  return (
    doc.ranges.find((range) => range.start < caret && caret <= range.end) ??
    null
  );
}

/** The mention a forward Delete at `caret` would bite into. */
export function mentionAfter<Kind extends string>(
  doc: MentionDoc<Kind>,
  caret: number,
): MentionRange<Kind> | null {
  return (
    doc.ranges.find((range) => range.start <= caret && caret < range.end) ??
    null
  );
}

/** The mention whose name holds `position` strictly inside it. */
export function mentionAround<Kind extends string>(
  doc: MentionDoc<Kind>,
  position: number,
): MentionRange<Kind> | null {
  return (
    doc.ranges.find(
      (range) => range.start < position && position < range.end,
    ) ?? null
  );
}

/** A mention moved along its text by `offset` characters. */
export function moveMentionRange<Kind extends string>(
  range: MentionRange<Kind>,
  offset: number,
): MentionRange<Kind> {
  return {
    kind: range.kind,
    id: range.id,
    name: range.name,
    start: range.start + offset,
    end: range.end + offset,
  };
}

/** Part of a doc: the mentions wholly inside it, moved to its start. */
export function sliceMentionDoc<Kind extends string>(
  doc: MentionDoc<Kind>,
  start: number,
  end: number,
): MentionDoc<Kind> {
  return {
    text: doc.text.slice(start, end),
    ranges: doc.ranges
      .filter((range) => range.start >= start && range.end <= end)
      .map((range) => moveMentionRange(range, -start)),
  };
}

/** How many past states {@link MentionHistory} keeps. */
const HISTORY_MAX = 100;

/**
 * The mentions of recent texts, so an undo that brings a text back brings
 * its mentions back too: the field's native undo restores the words only.
 */
export class MentionHistory<Kind extends string> {
  #states: MentionDoc<Kind>[] = [];

  record(doc: MentionDoc<Kind>): void {
    const last = this.#states.at(-1);
    if (last?.text === doc.text && last.ranges === doc.ranges) return;
    this.#states.push(doc);
    if (this.#states.length > HISTORY_MAX) this.#states.shift();
  }

  /** The newest recorded doc with this exact text. */
  recall(text: string): MentionDoc<Kind> | null {
    for (let index = this.#states.length - 1; index >= 0; index -= 1) {
      const state = this.#states[index];
      if (state?.text === text) return state;
    }
    return null;
  }

  clear(): void {
    this.#states = [];
  }
}
