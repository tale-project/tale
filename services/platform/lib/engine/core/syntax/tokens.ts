/**
 * The template tokenizer: where each `{{ <expression> }}` of a field string
 * begins and ends.
 *
 * A template ends at the `}}` that closes its EXPRESSION, not at the first
 * `}}` in the text, so an object literal, a string holding `}}` or a nested
 * arrow body survive: `{{ xs.map(x => ({ y: x })) }}` is one expression.
 *
 * Compatibility is by construction. The legacy rule — the first `}}` at least
 * one character after the `{{` — is tried first, and whenever the text it
 * encloses is a valid expression it is kept as is, so every template that
 * evaluated before evaluates identically. Only a span that did NOT parse is
 * extended to the closer the parser finds, and when that fails too the
 * legacy span stays (and reports its syntax error, as before).
 *
 * A `{{` with no `}}` anywhere after it is plain text, as it always was; it
 * is listed in `unterminated` so validation can say so.
 */

import { parseExpressionAt } from 'acorn';

import { parseExpressionIn, RUNTIME_ECMA_VERSION } from './parse';

export interface TemplateSegment {
  kind: 'text' | 'expr';
  /** UTF-16 offsets of the whole segment in the field string; an expr
   * segment spans `{{ … }}`. */
  start: number;
  end: number;
  /** expr only: the expression between the braces, whitespace-trimmed. */
  exprStart?: number;
  exprEnd?: number;
  /** expr only: the trimmed expression text (what the runtime evaluates). */
  source?: string;
  /** expr only: false when no valid expression fits the braces, so the
   * legacy first-`}}` rule decided the end. */
  parsed?: boolean;
}

export interface Tokenized {
  segments: TemplateSegment[];
  /** [start, end) of every `{{` that has no closing `}}` after it. */
  unterminated: Array<[number, number]>;
}

function trimmedSpan(
  value: string,
  start: number,
  end: number,
): [number, number] {
  const inner = value.slice(start, end);
  const lead = inner.length - inner.trimStart().length;
  const trail = inner.length - inner.trimEnd().length;
  return lead === inner.length ? [start, start] : [start + lead, end - trail];
}

function exprSegment(
  value: string,
  open: number,
  close: number,
  parsed: boolean,
): TemplateSegment {
  const [exprStart, exprEnd] = trimmedSpan(value, open + 2, close);
  return {
    kind: 'expr',
    start: open,
    end: close + 2,
    exprStart,
    exprEnd,
    source: value.slice(exprStart, exprEnd),
    parsed,
  };
}

function parsesIn(value: string, start: number, end: number): boolean {
  const [s, e] = trimmedSpan(value, start, end);
  return e > s && parseExpressionIn(value, s, e).ok;
}

/** The expr segment opening at `open`, whose legacy closer is `close`. */
function matchTemplate(
  value: string,
  open: number,
  close: number,
): TemplateSegment {
  if (parsesIn(value, open + 2, close)) {
    return exprSegment(value, open, close, true);
  }
  let end: number | undefined;
  try {
    end = parseExpressionAt(value, open + 2, {
      ecmaVersion: RUNTIME_ECMA_VERSION,
    }).end;
  } catch (e) {
    if (!(e instanceof SyntaxError)) throw e;
    // No expression starts here at all — the legacy span reports the error.
    end = undefined;
  }
  if (end !== undefined) {
    const later = value.indexOf('}}', end);
    if (later > close && parsesIn(value, open + 2, later)) {
      return exprSegment(value, open, later, true);
    }
  }
  return exprSegment(value, open, close, false);
}

export function tokenizeTemplate(value: string): Tokenized {
  const segments: TemplateSegment[] = [];
  const unterminated: Array<[number, number]> = [];
  let textStart = 0;
  let open = value.indexOf('{{');
  while (open !== -1) {
    const close = value.indexOf('}}', open + 3);
    if (close === -1) {
      // `{{}}` is an empty pair, not a missing closer; it stays text quietly.
      if (value.indexOf('}}', open + 2) === -1) {
        unterminated.push([open, open + 2]);
      }
      open = value.indexOf('{{', open + 2);
      continue;
    }
    const segment = matchTemplate(value, open, close);
    if (open > textStart) {
      segments.push({ kind: 'text', start: textStart, end: open });
    }
    segments.push(segment);
    textStart = segment.end;
    open = value.indexOf('{{', textStart);
  }
  if (textStart < value.length) {
    segments.push({ kind: 'text', start: textStart, end: value.length });
  }
  return { segments, unterminated };
}

/** The expression segments, in order. */
export function exprSegments(t: Tokenized): TemplateSegment[] {
  return t.segments.filter((s) => s.kind === 'expr');
}

/**
 * Exactly one expression and only whitespace around it — the field keeps
 * the expression's type (`"{{ input.n }}"` → a number).
 */
export function isSingleTemplate(value: string, t: Tokenized): boolean {
  let exprs = 0;
  for (const s of t.segments) {
    if (s.kind === 'expr') exprs++;
    else if (value.slice(s.start, s.end).trim() !== '') return false;
  }
  return exprs === 1;
}

/**
 * How a condition field (`when`, `repeatUntil`) is read: with no `{{` the
 * whole string is one bare expression; otherwise it is a template — a single
 * one keeps the expression's value, mixed text is a string.
 */
export function conditionKind(value: string): 'bare' | 'single' | 'mixed' {
  if (!value.includes('{{')) return 'bare';
  return isSingleTemplate(value, tokenizeTemplate(value)) ? 'single' : 'mixed';
}
