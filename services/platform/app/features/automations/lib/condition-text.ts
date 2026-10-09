/**
 * Conditions in words.
 *
 * A node's `when` and `repeatUntil` are JavaScript: `{{
 * nodes.inbox.output.conversations.length > 0 }}`. The canvas says them the
 * way a person would — "the number of conversations of Inbox is greater
 * than 0" — so a reader can follow a chart without reading code. Only the
 * shapes a condition is usually written in are described: comparisons,
 * emptiness, truthiness, `includes`/`startsWith`/`endsWith`, and up to three
 * of them joined with `&&` or `||`. Anything else stays code, and the canvas
 * shows the expression itself.
 *
 * `describeCondition` parses once, with the engine's own parser, into a
 * `Phrase` that keeps every operand's range in the field string — so a run
 * view can later put the value each operand read beside its words.
 * `renderCondition` turns a phrase into a sentence fragment in the
 * session's language: every German template is written verb-last, because
 * every use sits after "wenn" or "bis".
 */

import type { Node } from 'estree';

import { parseExpressionIn } from '@/lib/engine/core/syntax/parse';
import {
  conditionKind,
  exprSegments,
  isSingleTemplate,
  tokenizeTemplate,
} from '@/lib/engine/core/syntax/tokens';
import { renderPath } from '@/lib/engine/core/syntax/walk';

/** What an operand reads: a node's output, the run input, the item a
 *  forEach node is on, its position, or the result of a repeat's pass. */
export type OperandRoot = 'node' | 'input' | 'item' | 'index' | 'output';

export interface RefOperand {
  kind: 'ref';
  root: OperandRoot;
  /** `root: 'node'`: the node read. */
  nodeId?: string;
  /** Keys after the root (after `.output` for a node). */
  path: ReadonlyArray<string | number>;
  /** Reads `.length` at the end: "the number of …". */
  length?: true;
  /** [start, end) in the field string. */
  range: readonly [number, number];
}

export interface LiteralOperand {
  kind: 'literal';
  value: string | number | boolean | null;
  range: readonly [number, number];
}

export type Operand = RefOperand | LiteralOperand;

export type CompareOp = 'gt' | 'gte' | 'lt' | 'lte' | 'eq' | 'neq';

export type Phrase =
  | { kind: 'compare'; op: CompareOp; a: Operand; b: Operand }
  | { kind: 'empty' | 'notEmpty' | 'set' | 'notSet'; a: Operand }
  | {
      kind: 'contains' | 'notContains' | 'startsWith' | 'endsWith';
      a: Operand;
      b: Operand;
    }
  | { kind: 'and' | 'or'; parts: readonly Phrase[] }
  | { kind: 'raw' };

const RAW: Phrase = { kind: 'raw' };

/** At most this many conditions joined by one `&&` or `||`. */
const MAX_PARTS = 3;
/** `a && (b || c)` reads; one more level of grouping does not. */
const MAX_GROUP_DEPTH = 2;

const COMPARE_OPS: Readonly<Record<string, CompareOp>> = {
  '>': 'gt',
  '>=': 'gte',
  '<': 'lt',
  '<=': 'lte',
  '===': 'eq',
  '==': 'eq',
  '!==': 'neq',
  '!=': 'neq',
};

function rangeOf(node: Node): readonly [number, number] {
  return node.range ?? [0, 0];
}

/** The expression inside the wrappers that do not change what a
 *  condition means: an optional chain, `x ?? false|0|null`. */
function unwrap(node: Node): Node {
  let current = node;
  for (;;) {
    if (current.type === 'ChainExpression') {
      current = current.expression;
      continue;
    }
    if (
      current.type === 'LogicalExpression' &&
      current.operator === '??' &&
      current.right.type === 'Literal' &&
      (current.right.value === false ||
        current.right.value === 0 ||
        current.right.value === null)
    ) {
      current = current.left;
      continue;
    }
    return current;
  }
}

/** The keys of a member chain from its root identifier, or null when a
 *  step is computed from something other than a literal. */
function memberChain(
  node: Node,
): { root: string; keys: Array<string | number> } | null {
  const keys: Array<string | number> = [];
  let current: Node = unwrap(node);
  while (current.type === 'MemberExpression') {
    const { property } = current;
    if (!current.computed && property.type === 'Identifier') {
      keys.unshift(property.name);
    } else if (
      current.computed &&
      property.type === 'Literal' &&
      (typeof property.value === 'string' || typeof property.value === 'number')
    ) {
      keys.unshift(property.value);
    } else {
      return null;
    }
    if (current.object.type === 'Super') return null;
    current =
      current.object.type === 'ChainExpression'
        ? current.object.expression
        : current.object;
  }
  return current.type === 'Identifier' ? { root: current.name, keys } : null;
}

/** One operand: a literal, or a read of the automation's scope. */
function operandOf(node: Node): Operand | null {
  const inner = unwrap(node);
  const range = rangeOf(node);
  if (inner.type === 'Literal') {
    const { value } = inner;
    if (
      typeof value === 'string' ||
      typeof value === 'number' ||
      typeof value === 'boolean' ||
      value === null
    ) {
      return { kind: 'literal', value, range };
    }
    return null;
  }
  if (inner.type === 'TemplateLiteral' && inner.expressions.length === 0) {
    const text = inner.quasis[0]?.value.cooked;
    return typeof text === 'string'
      ? { kind: 'literal', value: text, range }
      : null;
  }
  if (
    inner.type === 'UnaryExpression' &&
    inner.operator === '-' &&
    inner.argument.type === 'Literal' &&
    typeof inner.argument.value === 'number'
  ) {
    return { kind: 'literal', value: -inner.argument.value, range };
  }
  if (inner.type === 'Identifier' && inner.name === 'undefined') {
    return { kind: 'literal', value: null, range };
  }
  const chain = memberChain(inner);
  if (chain === null) return null;
  let keys = chain.keys;
  const length = keys.at(-1) === 'length';
  if (length) keys = keys.slice(0, -1);
  const withLength = length ? { length: true as const } : {};
  switch (chain.root) {
    case 'nodes': {
      const [nodeId, output, ...path] = keys;
      if (typeof nodeId !== 'string' || output !== 'output') return null;
      return { kind: 'ref', root: 'node', nodeId, path, range, ...withLength };
    }
    case 'input':
    case 'item':
    case 'output':
      return {
        kind: 'ref',
        root: chain.root,
        path: keys,
        range,
        ...withLength,
      };
    case 'index':
      return keys.length === 0 && !length
        ? { kind: 'ref', root: 'index', path: [], range }
        : null;
    default:
      return null;
  }
}

/** `x.length` alone: the list or text whose length is read. */
function lengthOf(node: Node): Operand | null {
  const operand = operandOf(node);
  if (operand?.kind !== 'ref' || operand.length !== true) return null;
  const { length: _length, ...rest } = operand;
  return rest;
}

/** Whether a `.length` compared with `literal` by `op` says "not empty"
 *  (`true`), "empty" (`false`), or neither. */
function emptiness(op: string, literal: Node): boolean | undefined {
  if (literal.type !== 'Literal' || typeof literal.value !== 'number') {
    return undefined;
  }
  const n = literal.value;
  if ((op === '>' && n === 0) || (op === '>=' && n === 1)) return true;
  if ((op === '!==' || op === '!=') && n === 0) return true;
  if ((op === '===' || op === '==') && n === 0) return false;
  if ((op === '<' && n === 1) || (op === '<=' && n === 0)) return false;
  return undefined;
}

/** A value read for its truth: set, or (negated) not set. */
function truth(node: Node, negated: boolean): Phrase {
  const inner = unwrap(node);
  const length = lengthOf(inner);
  if (length !== null) {
    return { kind: negated ? 'empty' : 'notEmpty', a: length };
  }
  if (inner.type === 'UnaryExpression' && inner.operator === '!') {
    return truth(inner.argument, !negated);
  }
  const operand = operandOf(inner);
  if (operand === null || operand.kind === 'literal') return RAW;
  return { kind: negated ? 'notSet' : 'set', a: operand };
}

function phraseOf(node: Node, depth: number): Phrase {
  const inner = unwrap(node);
  switch (inner.type) {
    case 'LogicalExpression': {
      if (inner.operator === '??') return RAW;
      if (depth >= MAX_GROUP_DEPTH) return RAW;
      const operator = inner.operator;
      const parts: Node[] = [];
      const collect = (part: Node): void => {
        const unwrapped = unwrap(part);
        if (
          unwrapped.type === 'LogicalExpression' &&
          unwrapped.operator === operator
        ) {
          collect(unwrapped.left);
          collect(unwrapped.right);
        } else {
          parts.push(part);
        }
      };
      collect(inner);
      if (parts.length > MAX_PARTS) return RAW;
      const phrases = parts.map((part) => phraseOf(part, depth + 1));
      if (phrases.some((phrase) => phrase.kind === 'raw')) return RAW;
      return { kind: operator === '&&' ? 'and' : 'or', parts: phrases };
    }
    case 'UnaryExpression': {
      if (inner.operator !== '!') return RAW;
      const argument = unwrap(inner.argument);
      if (argument.type === 'CallExpression') {
        const call = callPhrase(argument);
        return call?.kind === 'contains'
          ? { ...call, kind: 'notContains' }
          : RAW;
      }
      return truth(argument, true);
    }
    case 'CallExpression': {
      if (
        inner.callee.type === 'Identifier' &&
        inner.callee.name === 'Boolean' &&
        inner.arguments.length === 1 &&
        inner.arguments[0]?.type !== 'SpreadElement'
      ) {
        const [argument] = inner.arguments;
        return argument === undefined ? RAW : truth(argument, false);
      }
      return callPhrase(inner) ?? RAW;
    }
    case 'BinaryExpression': {
      const op = COMPARE_OPS[inner.operator];
      if (op === undefined || inner.left.type === 'PrivateIdentifier') {
        return RAW;
      }
      const length = lengthOf(inner.left);
      if (length !== null) {
        const notEmpty = emptiness(inner.operator, inner.right);
        if (notEmpty !== undefined) {
          return { kind: notEmpty ? 'notEmpty' : 'empty', a: length };
        }
      }
      const a = operandOf(inner.left);
      const b = operandOf(inner.right);
      if (a === null || b === null) return RAW;
      return { kind: 'compare', op, a, b };
    }
    default:
      return truth(inner, false);
  }
}

/** `x.includes(v)`, `x.startsWith(v)`, `x.endsWith(v)`. */
function callPhrase(node: Node): Phrase | null {
  if (node.type !== 'CallExpression') return null;
  const callee = unwrap(node.callee);
  if (
    callee.type !== 'MemberExpression' ||
    callee.computed ||
    callee.property.type !== 'Identifier' ||
    callee.object.type === 'Super' ||
    node.arguments.length !== 1
  ) {
    return null;
  }
  const [argument] = node.arguments;
  if (argument === undefined || argument.type === 'SpreadElement') return null;
  const kind =
    callee.property.name === 'includes'
      ? 'contains'
      : callee.property.name === 'startsWith'
        ? 'startsWith'
        : callee.property.name === 'endsWith'
          ? 'endsWith'
          : null;
  if (kind === null) return null;
  const a = operandOf(callee.object);
  const b = operandOf(argument);
  if (a === null || b === null || a.kind !== 'ref') return null;
  return { kind, a, b };
}

/** The one expression a field holds — bare, or one whole template — and
 *  its range; null for text around templates. */
function soleExpression(text: string): { start: number; end: number } | null {
  const kind = conditionKind(text);
  if (kind === 'mixed') return null;
  if (kind === 'bare') {
    const start = text.length - text.trimStart().length;
    const end = text.trimEnd().length;
    return end > start ? { start, end } : null;
  }
  const [segment] = exprSegments(tokenizeTemplate(text));
  if (segment === undefined) return null;
  const start = segment.exprStart ?? segment.start;
  const end = segment.exprEnd ?? segment.end;
  return end > start ? { start, end } : null;
}

/**
 * The phrase a condition field says, or `raw` when it is not one of the
 * shapes that read as words (or does not parse).
 */
export function describeCondition(text: string): Phrase {
  const sole = soleExpression(text);
  if (sole === null) return RAW;
  const parsed = parseExpressionIn(text, sole.start, sole.end);
  return parsed.ok ? phraseOf(parsed.ast, 0) : RAW;
}

/**
 * What a `forEach` template walks, when it is one read of the scope
 * (`{{ nodes.open_issues.output.issues }}`); null otherwise.
 */
export function describeList(text: string): Operand | null {
  const tokens = tokenizeTemplate(text);
  if (!isSingleTemplate(text, tokens)) return null;
  const [segment] = exprSegments(tokens);
  if (segment === undefined) return null;
  const start = segment.exprStart ?? segment.start;
  const end = segment.exprEnd ?? segment.end;
  if (end <= start) return null;
  const parsed = parseExpressionIn(text, start, end);
  if (!parsed.ok) return null;
  const operand = operandOf(parsed.ast);
  return operand?.kind === 'ref' ? operand : null;
}

/** The translate function of the session's language, bound to the
 *  `automations` namespace. */
export type ConditionTranslate = (
  key: string,
  options?: Record<string, unknown>,
) => string;

export interface ConditionTextContext {
  t: ConditionTranslate;
  locale: string;
  /** A node's name as the canvas shows it on its box. */
  nodeLabel: (id: string) => string;
}

/** Keys as an author writes them, without a leading dot: `status.code`,
 *  `items[0]`, `["odd key"]`. */
function pathText(path: ReadonlyArray<string | number>): string {
  const text = renderPath(path.map((key) => ({ key })));
  return text.startsWith('.') ? text.slice(1) : text;
}

/** One operand in words: "issues of Open issues", "“done”", "250". */
export function renderOperand(
  operand: Operand,
  ctx: ConditionTextContext,
): string {
  const { t } = ctx;
  if (operand.kind === 'literal') {
    const { value } = operand;
    if (value === null) return t('condition.literal.valueNull');
    if (typeof value === 'boolean') {
      return value
        ? t('condition.literal.valueTrue')
        : t('condition.literal.valueFalse');
    }
    if (typeof value === 'number') {
      return new Intl.NumberFormat(ctx.locale).format(value);
    }
    return t('condition.quote', { text: value });
  }
  const path = pathText(operand.path);
  const whole = operand.path.length === 0;
  let base: string;
  switch (operand.root) {
    case 'node': {
      const node = ctx.nodeLabel(operand.nodeId ?? '');
      base = whole
        ? t('condition.ref.nodeOutput', { node })
        : t('condition.ref.node', { path, node });
      break;
    }
    case 'input':
      base = whole
        ? t('condition.ref.inputWhole')
        : t('condition.ref.input', { path });
      break;
    case 'item':
      base = whole
        ? t('condition.ref.itemWhole')
        : t('condition.ref.item', { path });
      break;
    case 'output':
      base = whole
        ? t('condition.ref.outputWhole')
        : t('condition.ref.output', { path });
      break;
    case 'index':
      base = t('condition.ref.index');
      break;
  }
  return operand.length === true
    ? t('condition.ref.length', { inner: base })
    : base;
}

/** Two operands in words, as one condition fragment. */
type PairWords = (
  t: ConditionTranslate,
  operands: { a: string; b: string },
) => string;

/** "{a} is greater than {b}", one key per operator. */
const COMPARE_WORDS: Readonly<Record<CompareOp, PairWords>> = {
  gt: (t, operands) => t('condition.gt', operands),
  gte: (t, operands) => t('condition.gte', operands),
  lt: (t, operands) => t('condition.lt', operands),
  lte: (t, operands) => t('condition.lte', operands),
  eq: (t, operands) => t('condition.eq', operands),
  neq: (t, operands) => t('condition.neq', operands),
};

/** "{a} contains {b}" and the other text tests. */
const TEXT_WORDS: Readonly<
  Record<'contains' | 'notContains' | 'startsWith' | 'endsWith', PairWords>
> = {
  contains: (t, operands) => t('condition.contains', operands),
  notContains: (t, operands) => t('condition.notContains', operands),
  startsWith: (t, operands) => t('condition.startsWith', operands),
  endsWith: (t, operands) => t('condition.endsWith', operands),
};

/** "{a} is empty", "{a} is set" and their opposites. */
const STATE_WORDS: Readonly<
  Record<
    'empty' | 'notEmpty' | 'set' | 'notSet',
    (t: ConditionTranslate, a: string) => string
  >
> = {
  empty: (t, a) => t('condition.empty', { a }),
  notEmpty: (t, a) => t('condition.notEmpty', { a }),
  set: (t, a) => t('condition.set', { a }),
  notSet: (t, a) => t('condition.notSet', { a }),
};

/**
 * A phrase as a sentence fragment that completes "Runs only if …" ("…
 * nur, wenn …", "… seulement si …"); null for a raw condition, which the
 * canvas shows as code.
 */
export function renderCondition(
  phrase: Phrase,
  ctx: ConditionTextContext,
): string | null {
  const { t } = ctx;
  switch (phrase.kind) {
    case 'raw':
      return null;
    case 'and':
    case 'or': {
      const parts: string[] = [];
      for (const part of phrase.parts) {
        const text = renderCondition(part, ctx);
        if (text === null) return null;
        // A group of the other kind inside reads in brackets, so
        // `a && (b || c)` and `(a && b) || c` never read alike.
        parts.push(
          part.kind === 'and' || part.kind === 'or'
            ? t('condition.group', { parts: text })
            : text,
        );
      }
      return new Intl.ListFormat(ctx.locale, {
        type: phrase.kind === 'and' ? 'conjunction' : 'disjunction',
      }).format(parts);
    }
    case 'compare':
      return COMPARE_WORDS[phrase.op](t, {
        a: renderOperand(phrase.a, ctx),
        b: renderOperand(phrase.b, ctx),
      });
    case 'contains':
    case 'notContains':
    case 'startsWith':
    case 'endsWith':
      return TEXT_WORDS[phrase.kind](t, {
        a: renderOperand(phrase.a, ctx),
        b: renderOperand(phrase.b, ctx),
      });
    default:
      // `empty`, `notEmpty`, `set`, `notSet`: one operand.
      return STATE_WORDS[phrase.kind](t, renderOperand(phrase.a, ctx));
  }
}

/** A condition field in words, or null when it reads only as code. */
export function conditionText(
  text: string,
  ctx: ConditionTextContext,
): string | null {
  return renderCondition(describeCondition(text), ctx);
}
