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

import { parse, parseExpressionAt, type Options } from 'acorn';
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
      /** Where the parser gave up, inside the field string. */
      range: [number, number];
    };

const OPTIONS: Options = {
  ecmaVersion: 'latest',
  sourceType: 'script',
  // `range` is the ESTree spelling of acorn's own start/end offsets — it
  // lets the rest of the analysis stay on the standard node types.
  ranges: true,
};

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
function failure(e: unknown, lo: number, hi: number): ParseResult {
  if (!(e instanceof SyntaxError)) throw e;
  // acorn sets `pos` (where the bad token starts) and `raisedAt` (where the
  // parser stood) on the SyntaxError it throws.
  const rawPos: unknown = Reflect.get(e, 'pos');
  const rawRaisedAt: unknown = Reflect.get(e, 'raisedAt');
  const pos = typeof rawPos === 'number' ? rawPos : lo;
  const raisedAt = typeof rawRaisedAt === 'number' ? rawRaisedAt : pos + 1;
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
      const close = text.indexOf('*/', i + 2);
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
  const scoped = text.slice(0, end);
  let ast;
  try {
    ast = parseExpressionAt(scoped, start, OPTIONS);
  } catch (e) {
    return failure(e, start, end);
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
  try {
    const ast = parse(code, { ...OPTIONS, allowReturnOutsideFunction: true });
    return { ok: true, ast: asEstree(ast), start: 0, end: code.length };
  } catch (e) {
    return failure(e, 0, code.length);
  }
}
