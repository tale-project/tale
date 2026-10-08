/**
 * Parsing for every piece of JavaScript an automation document holds:
 * template expressions, condition fields and transform bodies.
 *
 * acorn parses in place, so every position this layer reports is a UTF-16
 * offset into the FIELD STRING the code came from — a template expression at
 * `{{ … }}` keeps the offsets it has inside the prompt, and an editor can
 * select the range without any re-basing.
 *
 * The parse mirrors how the CodeRunner compiles the same text: an
 * expression runs as `return (<expr>);` on one line and a transform body runs
 * inside `function(){\n<code>\n}`, so a trailing line comment that would
 * swallow the closing parenthesis is a syntax error here as it is there.
 *
 * Pure and browser-safe: no `eval`, no `Function` — acorn only builds
 * regular expressions, which a strict Content-Security-Policy allows.
 */

import { parse, parseExpressionAt, tokenizer, type Options } from 'acorn';
import type { Node } from 'estree';

export type ParseResult =
  | {
      ok: true;
      ast: Node;
      /** [start, end) of the parsed code in the field string. */
      start: number;
      end: number;
    }
  | {
      ok: false;
      /** The parser's sentence, without its `(line:col)` suffix. */
      message: string;
      limited?: true;
      /** Where the parser gave up, inside the field string. */
      range: [number, number];
    };

/**
 * The language the parser accepts: the one the CodeRunner's Node runs
 * (Node 22, services/platform/Dockerfile), never acorn's newest. A newer
 * syntax acorn knows — regular-expression modifiers `(?i:…)`, duplicate
 * named groups, `using` — would otherwise pass validation and fail the run
 * at that node. Raise it with the runtime.
 */
export const RUNTIME_ECMA_VERSION = 2024;

const OPTIONS: Options = {
  ecmaVersion: RUNTIME_ECMA_VERSION,
  sourceType: 'script',
  // `range` is the ESTree spelling of acorn's own start/end offsets — it
  // lets the rest of the analysis stay on the standard node types.
  ranges: true,
};

/** Hard ceilings before acorn or a recursive analysis sees user code. */
export const MAX_SOURCE_SIZE = 8_192;
export const MAX_PARSE_DEPTH = 64;
export const MAX_PARSE_TOKENS = 512;
export const PARSE_LIMIT_MESSAGE =
  'code exceeds the analysis size or depth limit';

function limit(start: number, end: number): ParseResult {
  return {
    ok: false,
    message: PARSE_LIMIT_MESSAGE,
    range: clampRange(start, start + 1, start, end),
    limited: true,
  };
}

function budget(text: string, start: number, end: number): ParseResult | null {
  if (end - start > MAX_SOURCE_SIZE) return limit(start, end);
  let depth = 0;
  let count = 0;
  try {
    for (const token of tokenizer(text.slice(start, end), OPTIONS)) {
      const label = token.type.label;
      if (++count > MAX_PARSE_TOKENS) return limit(start + token.start, end);
      if (['(', '[', '{', '${'].includes(label)) {
        if (++depth > MAX_PARSE_DEPTH) return limit(start + token.start, end);
      } else if ([')', ']', '}'].includes(label))
        depth = Math.max(0, depth - 1);
    }
  } catch (e) {
    if (e instanceof RangeError) return limit(start, end);
    if (!(e instanceof SyntaxError)) throw e;
    // The parser supplies the normal syntax diagnostic.
  }
  return null;
}

/** Bound AST depth too: a flat token stream can form a deep binary tree.
 * Rebase offsets iteratively so parsing never copies a field's prefix. */
function prepareAst(root: unknown, offset: number): boolean {
  const pending: Array<{ value: unknown; depth: number }> = [
    { value: root, depth: 0 },
  ];
  const seen = new Set<object>();
  while (pending.length > 0) {
    const entry = pending.pop();
    if (entry === undefined) break;
    const { value, depth } = entry;
    if (value === null || typeof value !== 'object' || seen.has(value))
      continue;
    seen.add(value);
    const isNode = typeof Reflect.get(value, 'type') === 'string';
    const nextDepth = depth + Number(isNode);
    if (nextDepth > MAX_PARSE_DEPTH) return false;
    if (isNode) {
      for (const key of ['start', 'end']) {
        const position: unknown = Reflect.get(value, key);
        if (typeof position === 'number')
          Reflect.set(value, key, position + offset);
      }
      const range: unknown = Reflect.get(value, 'range');
      if (Array.isArray(range)) {
        range[0] += offset;
        range[1] += offset;
      }
    }
    for (const [key, child] of Object.entries(value)) {
      if (key !== 'range' && key !== 'loc')
        pending.push({ value: child, depth: nextDepth });
    }
  }
  return true;
}

/** Locate a lexical template closer within the expression budget. The caller
 * validates the complete span; returning an AST end would lose trailing
 * comments and make their braces look like template delimiters again. */
export function expressionEnd(text: string, start: number): number | undefined {
  const end = Math.min(text.length, start + MAX_SOURCE_SIZE + 2);
  try {
    // Locate the template closer lexically before budgeting: braces inside
    // strings, comments and nested expressions are not template delimiters.
    // Stop before plain text after the closer enters the token/depth budget.
    let depth = 0;
    let count = 0;
    for (const token of tokenizer(text.slice(start, end), OPTIONS)) {
      const label = token.type.label;
      if (
        label === '}' &&
        depth === 0 &&
        text.slice(start + token.start, start + token.start + 2) === '}}'
      ) {
        return start + token.start;
      }
      if (++count > MAX_PARSE_TOKENS) return undefined;
      if (['(', '[', '{', '${'].includes(label)) {
        if (++depth > MAX_PARSE_DEPTH) return undefined;
      } else if ([')', ']', '}'].includes(label))
        depth = Math.max(0, depth - 1);
    }
    // The size limit applies to trimmed code, not surrounding whitespace.
    // Only whitespace may extend past the bounded tokenization window.
    // The final full-span parse still enforces the trimmed source budget.
    let close = end;
    while (close < text.length && /\s/.test(text[close])) close++;
    return depth === 0 && text.slice(close, close + 2) === '}}'
      ? close
      : undefined;
  } catch (e) {
    if (!(e instanceof SyntaxError) && !(e instanceof RangeError)) throw e;
    return undefined;
  }
}

/** acorn's nodes ARE ESTree nodes; its typings are a parallel declaration. */
function asEstree(node: unknown): Node {
  // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- acorn emits ESTree-conformant nodes (with `ranges`), only its declaration file differs
  return node as Node;
}

/**
 * The range of an acorn SyntaxError inside [lo, hi], never empty unless the
 * span itself is: the offending token, or the last character when the parser
 * ran out of input.
 */
function failure(e: unknown, lo: number, hi: number, offset = 0): ParseResult {
  if (e instanceof RangeError) return limit(lo, hi);
  if (!(e instanceof SyntaxError)) throw e;
  // acorn sets `pos` (where the bad token starts) and `raisedAt` (where the
  // parser stood) on the SyntaxError it throws.
  const rawPos: unknown = Reflect.get(e, 'pos');
  const rawRaisedAt: unknown = Reflect.get(e, 'raisedAt');
  const pos = typeof rawPos === 'number' ? rawPos + offset : lo;
  const raisedAt =
    typeof rawRaisedAt === 'number' ? rawRaisedAt + offset : pos + 1;
  return {
    ok: false,
    message: e.message.replace(/\s*\(\d+:\d+\)$/, ''),
    range: clampRange(pos, Math.max(pos + 1, raisedAt), lo, hi),
  };
}

function clampRange(
  start: number,
  end: number,
  lo: number,
  hi: number,
): [number, number] {
  let s = Math.min(Math.max(start, lo), hi);
  const e = Math.min(Math.max(end, s), hi);
  if (s === e && s > lo) s = e - 1;
  return [s, e];
}

/**
 * Skip whitespace and comments in `text` from `from`, up to `end`. Returns
 * the first significant offset (=== `end` when nothing but trivia is left),
 * and whether the trivia ended inside a line comment — which the runner's
 * single-line wrapper would turn into a syntax error.
 */
function skipTrivia(
  text: string,
  from: number,
  end: number,
): { at: number; openLineComment: boolean } {
  let i = from;
  while (i < end) {
    const c = text[i];
    if (/\s/.test(c)) {
      i++;
    } else if (c === '/' && text[i + 1] === '*') {
      const relative = text.slice(i + 2, end).indexOf('*/');
      const close = relative === -1 ? -1 : i + 2 + relative;
      if (close === -1 || close + 2 > end)
        return { at: i, openLineComment: false };
      i = close + 2;
    } else if (c === '/' && text[i + 1] === '/') {
      let j = i + 2;
      while (j < end && !/[\n\r\u2028\u2029]/.test(text[j])) j++;
      if (j >= end) return { at: end, openLineComment: true };
      i = j;
    } else {
      return { at: i, openLineComment: false };
    }
  }
  return { at: i, openLineComment: false };
}

/**
 * Parse ONE expression occupying exactly `text[start..end)` — trailing
 * whitespace and block comments allowed, anything else is an error at the
 * first extra token.
 */
export function parseExpressionIn(
  text: string,
  start: number,
  end: number,
): ParseResult {
  const limited = budget(text, start, end);
  if (limited !== null) return limited;
  const scoped = text;
  let ast;
  try {
    ast = parseExpressionAt(text.slice(start, end), 0, OPTIONS);
    if (!prepareAst(ast, start)) return limit(start, end);
  } catch (e) {
    return failure(e, start, end, start);
  }
  // acorn hands back the expression INSIDE wrapping parentheses — `(a)` is
  // the node `a` — so the closers of the parens that open before the node
  // are still to be read after it.
  let opens = 0;
  for (let i = start; i < ast.start;) {
    const lead = skipTrivia(scoped, i, ast.start);
    if (lead.at >= ast.start || scoped[lead.at] !== '(') break;
    opens++;
    i = lead.at + 1;
  }
  let after = ast.end;
  for (let k = 0; k < opens; k++) {
    const close = skipTrivia(scoped, after, end);
    if (scoped[close.at] !== ')') break;
    after = close.at + 1;
  }
  const tail = skipTrivia(scoped, after, end);
  if (tail.openLineComment) {
    return {
      ok: false,
      message: 'a line comment runs to the end of the expression',
      range: clampRange(after, end, start, end),
    };
  }
  if (tail.at < end) {
    return {
      ok: false,
      message: 'Unexpected token',
      range: clampRange(tail.at, tail.at + 1, start, end),
    };
  }
  return { ok: true, ast: asEstree(ast), start, end };
}

/** Parse a transform body the way the runner compiles it: a synchronous
 * function body, so `return` is allowed at its top level. */
export function parseBody(code: string): ParseResult {
  const limited = budget(code, 0, code.length);
  if (limited !== null) return limited;
  try {
    const ast = parse(code, { ...OPTIONS, allowReturnOutsideFunction: true });
    if (!prepareAst(ast, 0)) return limit(0, code.length);
    return { ok: true, ast: asEstree(ast), start: 0, end: code.length };
  } catch (e) {
    return failure(e, 0, code.length);
  }
}
