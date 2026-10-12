/**
 * GitHub Actions expressions (`${{ … }}` and bare `if:` conditions): a parser, a
 * printer and a constant folder.
 *
 * The Forgejo port rewrites workflows that were written for GitHub. Where an event
 * can never happen on Forgejo (`repository_dispatch`, `merge_group`) or a job is
 * left out (`candidate-source`), the conditions that mention them are decided at
 * generation time instead of being carried into a file somebody has to maintain.
 * That takes real expressions, not text substitution: a condition such as
 * `!cancelled() && (((github.event_name == 'repository_dispatch') && …) || …)` has
 * to come out as the shorter condition it means.
 *
 * Nothing here knows about workflows. The folder follows GitHub's semantics for
 * what it folds (`&&` and `||` return an operand, strings compare without regard
 * to case, `''`, `0`, `null` and `false` are falsy) and leaves everything else
 * alone, so an expression it does not understand is carried through unchanged
 * rather than guessed at.
 */

export type Scalar = null | boolean | number | string;

export type BinaryOp = '&&' | '||' | '==' | '!=' | '<' | '<=' | '>' | '>=';

export type Expr =
  | { readonly kind: 'literal'; readonly value: Scalar }
  | { readonly kind: 'ident'; readonly name: string }
  | {
      readonly kind: 'member';
      readonly object: Expr;
      readonly property: string;
    }
  | { readonly kind: 'index'; readonly object: Expr; readonly index: Expr }
  | { readonly kind: 'wildcard'; readonly object: Expr }
  | {
      readonly kind: 'call';
      readonly name: string;
      readonly args: readonly Expr[];
    }
  | { readonly kind: 'not'; readonly operand: Expr }
  | {
      readonly kind: 'binary';
      readonly op: BinaryOp;
      readonly left: Expr;
      readonly right: Expr;
    };

export class ExpressionError extends Error {
  constructor(
    message: string,
    readonly source: string,
    readonly position: number,
  ) {
    super(`${message} at ${position} in: ${source}`);
    this.name = 'ExpressionError';
  }
}

type Token =
  | { readonly type: 'literal'; readonly value: Scalar; readonly at: number }
  | { readonly type: 'name'; readonly value: string; readonly at: number }
  | { readonly type: 'punct'; readonly value: string; readonly at: number }
  | { readonly type: 'end'; readonly at: number };

const NAME_START = /[A-Za-z_]/;
const NAME_PART = /[A-Za-z0-9_-]/;
const NUMBER = /^-?(?:0[xX][0-9a-fA-F]+|\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)/;

function tokenize(source: string): Token[] {
  const tokens: Token[] = [];
  let at = 0;
  while (at < source.length) {
    const char = source.charAt(at);
    if (/\s/.test(char)) {
      at += 1;
      continue;
    }
    if (char === "'") {
      let value = '';
      let next = at + 1;
      for (;;) {
        if (next >= source.length)
          throw new ExpressionError('Unterminated string', source, at);
        const current = source.charAt(next);
        if (current === "'") {
          if (source.charAt(next + 1) === "'") {
            value += "'";
            next += 2;
            continue;
          }
          next += 1;
          break;
        }
        value += current;
        next += 1;
      }
      tokens.push({ type: 'literal', value, at });
      at = next;
      continue;
    }
    const numeric =
      char === '-' || /\d/.test(char) ? NUMBER.exec(source.slice(at)) : null;
    if (numeric) {
      tokens.push({ type: 'literal', value: Number(numeric[0]), at });
      at += numeric[0].length;
      continue;
    }
    if (NAME_START.test(char)) {
      let next = at + 1;
      while (next < source.length && NAME_PART.test(source.charAt(next)))
        next += 1;
      tokens.push({ type: 'name', value: source.slice(at, next), at });
      at = next;
      continue;
    }
    const pair = source.slice(at, at + 2);
    if (['&&', '||', '==', '!=', '<=', '>='].includes(pair)) {
      tokens.push({ type: 'punct', value: pair, at });
      at += 2;
      continue;
    }
    if ('()[].,!<>*'.includes(char)) {
      tokens.push({ type: 'punct', value: char, at });
      at += 1;
      continue;
    }
    throw new ExpressionError(
      `Unexpected character ${JSON.stringify(char)}`,
      source,
      at,
    );
  }
  tokens.push({ type: 'end', at: source.length });
  return tokens;
}

/** Parse one expression, without the `${{ }}` around it. */
export function parseExpression(source: string): Expr {
  const tokens = tokenize(source);
  let index = 0;
  const peek = (): Token => tokens[index] ?? { type: 'end', at: source.length };
  const take = (): Token => {
    const token = peek();
    index += 1;
    return token;
  };
  const isPunct = (value: string): boolean => {
    const token = peek();
    return token.type === 'punct' && token.value === value;
  };
  const expect = (value: string): void => {
    const token = take();
    if (token.type !== 'punct' || token.value !== value)
      throw new ExpressionError(
        `Expected ${JSON.stringify(value)}`,
        source,
        token.at,
      );
  };

  const parseOr = (): Expr => {
    let left = parseAnd();
    while (isPunct('||')) {
      take();
      left = { kind: 'binary', op: '||', left, right: parseAnd() };
    }
    return left;
  };
  const parseAnd = (): Expr => {
    let left = parseEquality();
    while (isPunct('&&')) {
      take();
      left = { kind: 'binary', op: '&&', left, right: parseEquality() };
    }
    return left;
  };
  const takeOperator = (allowed: readonly BinaryOp[]): BinaryOp | undefined => {
    const token = peek();
    if (token.type !== 'punct') return undefined;
    const found = allowed.find((candidate) => candidate === token.value);
    if (found !== undefined) take();
    return found;
  };
  const parseEquality = (): Expr => {
    let left = parseRelation();
    for (
      let op = takeOperator(['==', '!=']);
      op;
      op = takeOperator(['==', '!='])
    ) {
      left = { kind: 'binary', op, left, right: parseRelation() };
    }
    return left;
  };
  const parseRelation = (): Expr => {
    let left = parseUnary();
    const relations: readonly BinaryOp[] = ['<=', '>=', '<', '>'];
    for (let op = takeOperator(relations); op; op = takeOperator(relations)) {
      left = { kind: 'binary', op, left, right: parseUnary() };
    }
    return left;
  };
  const parseUnary = (): Expr => {
    if (isPunct('!')) {
      take();
      return { kind: 'not', operand: parseUnary() };
    }
    return parsePostfix();
  };
  const parsePostfix = (): Expr => {
    let node = parsePrimary();
    for (;;) {
      if (isPunct('.')) {
        take();
        const next = take();
        if (next.type === 'punct' && next.value === '*') {
          node = { kind: 'wildcard', object: node };
        } else if (next.type === 'name') {
          node = { kind: 'member', object: node, property: next.value };
        } else if (next.type === 'literal' && typeof next.value === 'number') {
          // `a.0` is not valid GitHub syntax, but `needs.x.outputs.1` style names exist.
          node = { kind: 'member', object: node, property: String(next.value) };
        } else
          throw new ExpressionError(
            'Expected a property name',
            source,
            next.at,
          );
        continue;
      }
      if (isPunct('[')) {
        take();
        const inner = parseOr();
        expect(']');
        node = { kind: 'index', object: node, index: inner };
        continue;
      }
      return node;
    }
  };
  const parsePrimary = (): Expr => {
    const token = take();
    if (token.type === 'literal')
      return { kind: 'literal', value: token.value };
    if (token.type === 'punct' && token.value === '(') {
      const inner = parseOr();
      expect(')');
      return inner;
    }
    if (token.type === 'name') {
      if (isPunct('(')) {
        take();
        const args: Expr[] = [];
        if (!isPunct(')')) {
          args.push(parseOr());
          while (isPunct(',')) {
            take();
            args.push(parseOr());
          }
        }
        expect(')');
        return { kind: 'call', name: token.value, args };
      }
      if (token.value === 'true') return { kind: 'literal', value: true };
      if (token.value === 'false') return { kind: 'literal', value: false };
      if (token.value === 'null') return { kind: 'literal', value: null };
      return { kind: 'ident', name: token.value };
    }
    throw new ExpressionError('Unexpected token', source, token.at);
  };

  const result = parseOr();
  const rest = peek();
  if (rest.type !== 'end')
    throw new ExpressionError('Unexpected token', source, rest.at);
  return result;
}

const PRECEDENCE: Record<string, number> = {
  '||': 1,
  '&&': 2,
  '==': 3,
  '!=': 3,
  '<': 4,
  '<=': 4,
  '>': 4,
  '>=': 4,
};
const NOT_PRECEDENCE = 5;
const ATOM_PRECEDENCE = 6;

function precedenceOf(node: Expr): number {
  if (node.kind === 'binary') return PRECEDENCE[node.op] ?? ATOM_PRECEDENCE;
  if (node.kind === 'not') return NOT_PRECEDENCE;
  return ATOM_PRECEDENCE;
}

function printScalar(value: Scalar): string {
  if (value === null) return 'null';
  if (typeof value === 'string') return `'${value.replaceAll("'", "''")}'`;
  return String(value);
}

/** The shortest text that parses back to the same tree. */
export function printExpression(node: Expr): string {
  switch (node.kind) {
    case 'literal':
      return printScalar(node.value);
    case 'ident':
      return node.name;
    case 'member':
      return `${printExpression(node.object)}.${node.property}`;
    case 'index':
      return `${printExpression(node.object)}[${printExpression(node.index)}]`;
    case 'wildcard':
      return `${printExpression(node.object)}.*`;
    case 'call':
      return `${node.name}(${node.args.map(printExpression).join(', ')})`;
    case 'not': {
      const inner = printExpression(node.operand);
      return precedenceOf(node.operand) < NOT_PRECEDENCE
        ? `!(${inner})`
        : `!${inner}`;
    }
    case 'binary': {
      const precedence = precedenceOf(node);
      const left = printExpression(node.left);
      const right = printExpression(node.right);
      const leftText =
        precedenceOf(node.left) < precedence ? `(${left})` : left;
      const rightText =
        precedenceOf(node.right) <= precedence ? `(${right})` : right;
      return `${leftText} ${node.op} ${rightText}`;
    }
  }
}

/**
 * The dotted path of a plain context lookup (`github.event_name`,
 * `needs.build.outputs['sha']`), or `undefined` when the lookup is computed.
 */
export function contextPath(node: Expr): string | undefined {
  switch (node.kind) {
    case 'ident':
      return node.name;
    case 'member': {
      const parent = contextPath(node.object);
      return parent === undefined ? undefined : `${parent}.${node.property}`;
    }
    case 'index': {
      if (node.index.kind !== 'literal' || typeof node.index.value !== 'string')
        return undefined;
      const parent = contextPath(node.object);
      return parent === undefined ? undefined : `${parent}.${node.index.value}`;
    }
    default:
      return undefined;
  }
}

/** What the generator knows about the run a workflow will have on Forgejo. */
export interface Facts {
  /** Context paths with a known value: `needs.candidate-source.result` is `'skipped'`. */
  readonly values?: ReadonlyMap<string, Scalar>;
  /**
   * Context paths (and everything below them) that do not exist on Forgejo, so a
   * lookup yields `null`: `github.event.client_payload` has no payload there.
   */
  readonly absent?: readonly string[];
  /**
   * The strings a path can be, when it can only be one of a few: a workflow that
   * declares `push` and `pull_request` can only run as `github.event_name` of
   * either, so a comparison with `merge_group` is decided.
   */
  readonly oneOf?: ReadonlyMap<string, readonly string[]>;
}

/** Where the result is read: a condition only needs a truthiness, a value is kept as it is. */
export type Mode = 'condition' | 'value';

export function truthy(value: Scalar): boolean {
  if (value === null || value === false || value === '') return false;
  if (typeof value === 'number') return !(value === 0 || Number.isNaN(value));
  return true;
}

/** GitHub's number for a value of another type: null is 0, true 1, '' 0, a JSON number itself, the rest NaN. */
function toNumber(value: Scalar): number {
  if (value === null) return 0;
  if (typeof value === 'number') return value;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (value === '') return 0;
  return /^-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?$/.test(value)
    ? Number(value)
    : Number.NaN;
}

/** GitHub's `==`: strings without regard to case, other types by their numbers. */
function looseEquals(a: Scalar, b: Scalar): boolean {
  if (typeof a === 'string' && typeof b === 'string')
    return a.toLowerCase() === b.toLowerCase();
  if (a === null && b === null) return true;
  if (typeof a === typeof b) return a === b;
  return toNumber(a) === toNumber(b);
}

function lookup(
  node: Expr,
  facts: Facts,
): { found: true; value: Scalar } | { found: false } {
  const path = contextPath(node);
  if (path === undefined) return { found: false };
  const known = facts.values?.get(path);
  if (known !== undefined) return { found: true, value: known };
  for (const prefix of facts.absent ?? [])
    if (path === prefix || path.startsWith(`${prefix}.`))
      return { found: true, value: null };
  return { found: false };
}

function isLiteral(node: Expr): node is Extract<Expr, { kind: 'literal' }> {
  return node.kind === 'literal';
}

/**
 * Fold what the facts decide and nothing else. `condition` mode may also drop an
 * operand whose value a truthiness test would never see (`x && true` is `x`).
 */
export function simplify(node: Expr, facts: Facts, mode: Mode = 'value'): Expr {
  switch (node.kind) {
    case 'literal':
      return node;
    case 'ident':
    case 'member':
    case 'index': {
      const resolved = lookup(node, facts);
      if (resolved.found) return { kind: 'literal', value: resolved.value };
      if (node.kind === 'ident') return node;
      return {
        ...node,
        object: simplify(node.object, facts, 'value'),
        ...(node.kind === 'index'
          ? { index: simplify(node.index, facts, 'value') }
          : {}),
      } as Expr;
    }
    case 'wildcard':
      return {
        kind: 'wildcard',
        object: simplify(node.object, facts, 'value'),
      };
    case 'call':
      return {
        ...node,
        args: node.args.map((arg) => simplify(arg, facts, 'value')),
      };
    case 'not': {
      const operand = simplify(node.operand, facts, 'condition');
      if (isLiteral(operand))
        return { kind: 'literal', value: !truthy(operand.value) };
      return { kind: 'not', operand };
    }
    case 'binary':
      return simplifyBinary(node, facts, mode);
  }
}

/** What a comparison of a path with a string is, when the path can only be one of a few strings. */
function decidedByOneOf(
  left: Expr,
  right: Expr,
  facts: Facts,
): boolean | undefined {
  const path = contextPath(left);
  if (
    path === undefined ||
    !isLiteral(right) ||
    typeof right.value !== 'string'
  )
    return undefined;
  const allowed = facts.oneOf?.get(path);
  if (allowed === undefined) return undefined;
  const wanted = right.value.toLowerCase();
  const listed = allowed.some((entry) => entry.toLowerCase() === wanted);
  if (!listed) return false;
  return allowed.length === 1 ? true : undefined;
}

function simplifyBinary(
  node: Extract<Expr, { kind: 'binary' }>,
  facts: Facts,
  mode: Mode,
): Expr {
  const { op } = node;
  if (op === '&&' || op === '||') {
    const left = simplify(
      node.left,
      facts,
      'condition' === mode ? 'condition' : 'value',
    );
    if (isLiteral(left)) {
      const decided = truthy(left.value);
      if (op === '&&')
        return decided ? simplify(node.right, facts, mode) : left;
      return decided ? left : simplify(node.right, facts, mode);
    }
    const right = simplify(node.right, facts, mode);
    if (mode === 'condition' && isLiteral(right)) {
      const decided = truthy(right.value);
      if (op === '&&')
        return decided ? left : { kind: 'literal', value: false };
      return decided ? { kind: 'literal', value: true } : left;
    }
    return { kind: 'binary', op, left, right };
  }
  const left = simplify(node.left, facts, 'value');
  const right = simplify(node.right, facts, 'value');
  if (op === '==' || op === '!=') {
    if (isLiteral(left) && isLiteral(right)) {
      const equal = looseEquals(left.value, right.value);
      return { kind: 'literal', value: op === '==' ? equal : !equal };
    }
    const decided =
      decidedByOneOf(left, right, facts) ?? decidedByOneOf(right, left, facts);
    if (decided !== undefined)
      return { kind: 'literal', value: op === '==' ? decided : !decided };
  }
  return { kind: 'binary', op, left, right };
}

/** A string value with `${{ }}` holes. */
export type TemplatePart =
  | { readonly kind: 'text'; readonly text: string }
  | { readonly kind: 'expr'; readonly expr: Expr };

/** Split `a ${{ x }} b` into its text and its expressions. */
export function parseTemplate(source: string): TemplatePart[] {
  const parts: TemplatePart[] = [];
  let at = 0;
  for (;;) {
    const open = source.indexOf('${{', at);
    if (open === -1) {
      if (at < source.length)
        parts.push({ kind: 'text', text: source.slice(at) });
      return parts;
    }
    if (open > at) parts.push({ kind: 'text', text: source.slice(at, open) });
    const close = findClose(source, open + 3);
    if (close === -1)
      throw new ExpressionError('Unterminated ${{', source, open);
    parts.push({
      kind: 'expr',
      expr: parseExpression(source.slice(open + 3, close)),
    });
    at = close + 2;
  }
}

/** The `}}` that ends a hole, skipping any that sits inside a string literal. */
function findClose(source: string, from: number): number {
  let inString = false;
  for (let at = from; at < source.length; at += 1) {
    const char = source.charAt(at);
    if (char === "'") inString = !inString;
    else if (!inString && char === '}' && source.charAt(at + 1) === '}')
      return at;
  }
  return -1;
}

/** The text of a literal when it is written into a larger string. */
function interpolate(value: Scalar): string {
  if (value === null) return '';
  return String(value);
}

export type TemplateResult =
  /** The template is one expression that folded to a constant: use the typed value. */
  | { readonly kind: 'constant'; readonly value: Scalar }
  | { readonly kind: 'text'; readonly text: string };

/**
 * Fold every hole of a template. A template that is a single hole and folds to a
 * constant becomes that constant, so `fetch-depth: ${{ a && 1 || 0 }}` can end as the
 * number `0`; anything else is returned as text, with the holes that did not fold
 * printed back.
 */
export function foldTemplate(
  source: string,
  facts: Facts,
  mode: Mode = 'value',
): TemplateResult {
  const parts = parseTemplate(source).map((part) =>
    part.kind === 'expr'
      ? { kind: 'expr' as const, expr: simplify(part.expr, facts, mode) }
      : part,
  );
  const only = parts.length === 1 ? parts[0] : undefined;
  if (only?.kind === 'expr' && isLiteral(only.expr))
    return { kind: 'constant', value: only.expr.value };
  const text = parts
    .map((part) => {
      if (part.kind === 'text') return part.text;
      if (isLiteral(part.expr)) return interpolate(part.expr.value);
      return `\${{ ${printExpression(part.expr)} }}`;
    })
    .join('');
  return { kind: 'text', text };
}

/** Whether a string holds an expression at all. */
export function hasExpression(source: string): boolean {
  return source.includes('${{');
}
