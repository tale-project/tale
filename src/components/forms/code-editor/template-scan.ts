/**
 * Where each `{{ <expression> }}` of a text begins and ends — the rule a
 * runtime that evaluates templates applies, without a JavaScript parser.
 *
 * A template ends at the `}}` that closes its expression, not at the first
 * `}}` in the text, so an object literal, a string holding `}}` or a nested
 * arrow body survive: `{{ xs.map(x => ({ y: x })) }}` is one template.
 *
 * 1. The first `}}` at least one character after the `{{` is the candidate
 *    closer. When the text between is balanced — every string, comment and
 *    bracket that opens in it also closes — that span is the template.
 * 2. Otherwise the scan continues from the `{{` until every bracket and
 *    string has closed, and the first `}}` from there closes the template.
 * 3. When that fails too, the first `}}` stays the closer and the span is
 *    marked `balanced: false` (the host reports the syntax error).
 *
 * A `{{` with no `}}` anywhere after it is text, listed in `unterminated`;
 * `{{}}` is an empty pair and stays quiet text.
 *
 * "Balanced" stands in for "parses": a host with a real parser (Tale's
 * engine) passes its own tokenizer to the code editor as `templateScanner`,
 * and the two agree on everything but exotic input (a regular expression
 * literal holding `}}`).
 */

export interface TemplateSpan {
  /** Offset of `{{`. */
  open: number;
  /** The expression between the braces, untrimmed: `[bodyFrom, bodyTo)`. */
  bodyFrom: number;
  bodyTo: number;
  /** Offset just after the closing `}}`. */
  end: number;
  /** False when no balanced expression fits the braces (rule 3). */
  balanced: boolean;
}

export interface TemplateScan {
  spans: TemplateSpan[];
  /** `[from, to)` of every `{{` with no `}}` after it. */
  unterminated: Array<[number, number]>;
}

const OPENERS: Readonly<Record<string, string>> = {
  '(': ')',
  '[': ']',
  '{': '}',
};

interface ScanState {
  /** Closers still expected, innermost last; `` ` `` marks a template literal. */
  stack: string[];
  /** Inside a string or block comment that has not closed. */
  open: boolean;
}

/**
 * Scans JavaScript-ish text from `from`, calling `atTopLevel(pos)` at every
 * position where nothing is open (no bracket, string or comment); a `true`
 * answer stops the scan there. Returns the state at the end of the scan.
 */
function scan(
  text: string,
  from: number,
  to: number,
  atTopLevel?: (pos: number) => boolean,
): ScanState {
  const stack: string[] = [];
  let i = from;
  while (i < to) {
    const top = stack.at(-1);
    if (top === '`') {
      // Inside a template literal: text until `${` or the closing backtick.
      const c = text[i];
      if (c === '\\') {
        i += 2;
        continue;
      }
      if (c === '`') {
        stack.pop();
        i++;
        continue;
      }
      if (c === '$' && text[i + 1] === '{') {
        stack.push('}');
        i += 2;
        continue;
      }
      i++;
      continue;
    }
    if (stack.length === 0 && atTopLevel?.(i)) return { stack, open: false };
    const c = text[i];
    if (c === '"' || c === "'") {
      let j = i + 1;
      while (j < to && text[j] !== c && text[j] !== '\n') {
        j += text[j] === '\\' ? 2 : 1;
      }
      if (j >= to || text[j] !== c) return { stack, open: true };
      i = j + 1;
      continue;
    }
    if (c === '/' && text[i + 1] === '/') {
      const newline = text.indexOf('\n', i);
      // A line comment the range ends inside closes with the range.
      if (newline === -1 || newline >= to) return { stack, open: false };
      i = newline + 1;
      continue;
    }
    if (c === '/' && text[i + 1] === '*') {
      const close = text.indexOf('*/', i + 2);
      if (close === -1 || close + 2 > to) return { stack, open: true };
      i = close + 2;
      continue;
    }
    if (c === '`') {
      stack.push('`');
      i++;
      continue;
    }
    const closer = OPENERS[c];
    if (closer !== undefined) {
      stack.push(closer);
      i++;
      continue;
    }
    if (c === ')' || c === ']' || c === '}') {
      if (stack.at(-1) !== c) return { stack: [c], open: false };
      stack.pop();
      i++;
      continue;
    }
    i++;
  }
  if (stack.length === 0) atTopLevel?.(to);
  return { stack, open: false };
}

function balanced(text: string, from: number, to: number): boolean {
  if (text.slice(from, to).trim() === '') return false;
  const state = scan(text, from, to);
  return !state.open && state.stack.length === 0;
}

/** The first `}}` after the expression that starts at `from` closes. */
function closerAfterExpression(text: string, from: number): number {
  let found = -1;
  scan(text, from, text.length, (pos) => {
    if (text.startsWith('}}', pos)) {
      found = pos;
      return true;
    }
    return false;
  });
  return found;
}

function span(open: number, close: number, isBalanced: boolean): TemplateSpan {
  return {
    open,
    bodyFrom: open + 2,
    bodyTo: close,
    end: close + 2,
    balanced: isBalanced,
  };
}

export function scanTemplates(text: string): TemplateScan {
  const spans: TemplateSpan[] = [];
  const unterminated: Array<[number, number]> = [];
  let open = text.indexOf('{{');
  while (open !== -1) {
    const close = text.indexOf('}}', open + 3);
    if (close === -1) {
      if (text.indexOf('}}', open + 2) === -1) {
        unterminated.push([open, open + 2]);
      }
      open = text.indexOf('{{', open + 2);
      continue;
    }
    let found: TemplateSpan;
    if (balanced(text, open + 2, close)) {
      found = span(open, close, true);
    } else {
      const later = closerAfterExpression(text, open + 2);
      found =
        later > close && balanced(text, open + 2, later)
          ? span(open, later, true)
          : span(open, close, false);
    }
    spans.push(found);
    open = text.indexOf('{{', found.end);
  }
  return { spans, unterminated };
}
