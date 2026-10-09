/**
 * Why a condition came out the way it did, as a tree a person can read:
 * each sub-expression of the field with the value it had in the run, the
 * operands of an operator under it.
 *
 * Derived when a run is read, never stored. The run keeps only the values
 * its evaluation probed ({@link EvalTrace}, keyed by UTF-16 range in the
 * field's text); the field's own text, from the version the run ran,
 * supplies the structure. A literal's value is read from the text, and a
 * reference names the scope value it reads through the parser's own
 * reference walk, static keys only.
 *
 * `evaluated` says a sub-expression ran to a value: it was probed, it is a
 * literal, or its parent ran to a value and always computes it on the way —
 * both sides of a comparison, the first operand of `&&`, a ternary's test, a
 * call's receiver and arguments. A unit that ran without failing ran to a
 * value. A short-circuited operand has none of these and reads `false`. An
 * optional chain vouches for its parts only when it came out as a value
 * other than `undefined`: a chain that short-circuited reads `undefined`
 * too, and one whose value was withheld (`redacted`) or left out (`elided`)
 * says nothing either way, so inside those only a part's own probe says it
 * ran. When the unit was not probed in full — the plan was capped, or the
 * runner could not probe — a part with no probe that nothing vouches for
 * reads `unknown`: whether it ran cannot be told.
 *
 * A probe the run kept of a part the structure does not draw on its own
 * (the part before a `?.`, a parenthesized step of a chain) is shown under
 * the smallest node that holds it, where it fits within the bounds and
 * beside no part already drawn.
 *
 * Bounded per unit: {@link EXPLAIN_MAX_DEPTH} levels and
 * {@link EXPLAIN_MAX_NODES} nodes, laid out level by level so the outer
 * structure survives first. A node whose operands do not all fit keeps its
 * range, source and value, drops its operands and reads as `other` — never an
 * operator with half its operands; a reference or a literal keeps its kind.
 * Siblings are never dropped one by one.
 *
 * Pure and browser-safe: the app renders the tree, and REST and MCP serve it.
 */

import { summaryOf, type ValueSummary } from '@tale/ui/data/value-summary';
import type { ChainExpression, Identifier, Node } from 'estree';
import { walk } from 'zimmerframe';

import { foldConstant } from '../syntax/constant';
import { parseExpressionIn } from '../syntax/parse';
import {
  collectRefs,
  renderPath,
  SCOPE_ROOTS,
  type RefSite,
} from '../syntax/walk';
import type { EvalTrace, EvalUnitTrace } from './types';

export type ExplainKind =
  | 'logical'
  | 'compare'
  | 'not'
  | 'arith'
  | 'conditional'
  | 'call'
  | 'ref'
  | 'literal'
  | 'other';

/** The scope value a reference reads. */
export interface ExplainRef {
  root: 'input' | 'nodes' | 'item' | 'index' | 'output';
  /** `nodes` only: the step whose output is read. */
  nodeId?: string;
  /** Keys after the root; for `nodes`, after `.<id>.output`. */
  path: Array<string | number>;
}

export interface ExplainNode {
  /** [start, end) in the field's text. */
  range: [number, number];
  /** The sub-expression's text, at most {@link EXPLAIN_SOURCE_LENGTH}
   * characters; a longer one ends in `…`. */
  source: string;
  kind: ExplainKind;
  /**
   * `logical`, `compare`, `arith`: the operator (`&&`, `>=`, `-`); `not`:
   * `!`; `conditional`: `?:`; `call`: the function, method or property it
   * names (`includes`, `length`, `Object.keys`, absent for a computed
   * callee); `other`: `typeof`, `void`, `delete`, or `[]` for a computed
   * member read.
   */
  op?: string;
  /** `ref` only. */
  ref?: ExplainRef;
  /** What it came to: absent when it was not evaluated, or was but no probe
   * kept its value. A regular-expression literal has none either. */
  value?: ValueSummary;
  evaluated: boolean;
  /** The probes cannot tell whether it ran (`evaluated` is then `false`). */
  unknown?: true;
  /** Operands in source order. A chain of one logical operator is flat:
   * `a && b && c` has three. */
  children: ExplainNode[];
}

/** Levels per unit, the unit's own node included. */
export const EXPLAIN_MAX_DEPTH = 6;
/** Nodes per unit. */
export const EXPLAIN_MAX_NODES = 32;
/** Characters of source per node. */
export const EXPLAIN_SOURCE_LENGTH = 200;

/** One tree per unit of `trace`, in the trace's order: the bare expression
 * of a condition, or each `{{ }}` unit of a template. `field` is the text
 * the trace was taken from. */
export function explainCondition(
  field: string,
  trace: EvalTrace,
): ExplainNode[] {
  // A trace read back from storage is not trusted to be well formed.
  if (typeof field !== 'string' || !Array.isArray(trace?.units)) return [];
  return trace.units.map((unit) => {
    try {
      return explainUnit(field, unit);
    } catch (error) {
      console.warn(
        '[engine] a recorded condition could not be explained:',
        error instanceof Error ? error.message : String(error),
      );
      return unreadable(field, unit);
    }
  });
}

/** A unit the tree cannot be built for: one node, its value if a probe of
 * the whole unit kept one. */
function unreadable(field: string, unit: unknown): ExplainNode {
  const raw = isUnitLike(unit) ? unit.range : [0, 0];
  const range = clampRange([Number(raw[0]), Number(raw[1])], field.length);
  return {
    range,
    source: clip(field.slice(range[0], range[1])),
    kind: 'other',
    evaluated: false,
    unknown: true,
    children: [],
  };
}

function isUnitLike(unit: unknown): unit is { range: [unknown, unknown] } {
  return (
    typeof unit === 'object' &&
    unit !== null &&
    'range' in unit &&
    Array.isArray(unit.range) &&
    unit.range.length === 2
  );
}

/** What explaining one unit draws on: the field's text, the unit's probes
 * by range and its references. */
interface UnitContext {
  field: string;
  probes: Map<string, ValueSummary>;
  sites: RefSite[];
  /** Every probe was planned and kept: a part without one did not run. */
  complete: boolean;
}

/** One operand of a node still to be laid out. `always`: its parent
 * computes it whenever the parent itself runs to a value. */
interface Operand {
  always: boolean;
  node: Node;
  make: (vouched: boolean) => Draft;
}

interface Draft {
  out: ExplainNode;
  operands: Operand[];
  /** The node ran to a value, so it vouches for the operands it always
   * computes. */
  vouches: boolean;
}

function explainUnit(field: string, unit: EvalUnitTrace): ExplainNode {
  if (!isUnitLike(unit)) return unreadable(field, unit);
  const probes = new Map<string, ValueSummary>();
  for (const probe of Array.isArray(unit.probes) ? unit.probes : []) {
    if (
      !Array.isArray(probe?.range) ||
      typeof probe.range[0] !== 'number' ||
      typeof probe.range[1] !== 'number' ||
      typeof probe.v !== 'object' ||
      probe.v === null
    ) {
      continue;
    }
    const key = keyOf(probe.range);
    if (!probes.has(key)) probes.set(key, probe.v);
  }
  const [start, end] = unit.range;
  const inField =
    Number.isInteger(start) &&
    Number.isInteger(end) &&
    start >= 0 &&
    start <= end &&
    end <= field.length;
  const parsed = inField ? parseExpressionIn(field, start, end) : undefined;
  if (parsed === undefined || !parsed.ok) {
    const range = clampRange(unit.range, field.length);
    const value = probes.get(keyOf(unit.range));
    return {
      range,
      source: clip(field.slice(range[0], range[1])),
      kind: 'other',
      ...(value !== undefined && { value }),
      evaluated: value !== undefined,
      children: [],
    };
  }
  const ctx: UnitContext = {
    field,
    probes,
    sites: collectRefs(parsed.ast, { roots: SCOPE_ROOTS }),
    complete: unit.probed === 'full',
  };
  // A unit that ran without failing ran to a value.
  const ran = unit.probed !== 'none' && unit.error === undefined;
  const root = layout(draftOf(ctx, parsed.ast, ran));
  placeProbes(ctx, parsed.ast, root);
  return root;
}

/**
 * Show every probe the tree did not draw on its own — the part before a
 * `?.`, a parenthesized step of a chain — under the smallest node holding
 * it, as the node its sub-expression is, within the node cap.
 */
function placeProbes(ctx: UnitContext, ast: Node, root: ExplainNode): void {
  const drawn = new Set<string>();
  let count = 0;
  const visit = (node: ExplainNode): void => {
    count++;
    drawn.add(keyOf(node.range));
    for (const child of node.children) visit(child);
  };
  visit(root);
  const missing = [...ctx.probes.keys()].filter((key) => !drawn.has(key));
  if (missing.length === 0) return;
  const byRange = new Map<string, Node>();
  walk<Node, null>(ast, null, {
    _(node, { next, path }) {
      const parent = path.at(-1);
      // A part of a flattened chain (`a && b` inside `a && b && c`) is
      // drawn as its operands: its own value follows from them.
      const flattened =
        node.type === 'LogicalExpression' &&
        parent?.type === 'LogicalExpression' &&
        parent.operator === node.operator;
      if (node.range !== undefined && !flattened) {
        byRange.set(keyOf(node.range), node);
      }
      next();
    },
  });
  // Outer ones first, so a probe inside another missing one nests under it.
  const ordered = missing
    .map((key) => byRange.get(key))
    .filter((node): node is Node => node !== undefined)
    .toSorted((a, b) => {
      const [as, ae] = rangeOf(a);
      const [bs, be] = rangeOf(b);
      return be - bs - (ae - as) || as - bs;
    });
  for (const node of ordered) {
    if (count >= EXPLAIN_MAX_NODES) return;
    const [start, end] = rangeOf(node);
    // Within the depth the tree keeps: the deepest holder one level above it.
    let host = root;
    for (let depth = 1; depth < EXPLAIN_MAX_DEPTH - 1; depth++) {
      const inner = host.children.find(
        (child) => child.range[0] <= start && end <= child.range[1],
      );
      if (inner === undefined) break;
      host = inner;
    }
    // Only where it fits: never beside a part that holds it (the depth
    // stopped the descent), never over a part already drawn.
    if (
      host.children.some(
        (child) => child.range[0] < end && start < child.range[1],
      )
    ) {
      continue;
    }
    const placed = draftOf(ctx, node, true).out;
    summarize(placed);
    placed.evaluated = true;
    delete placed.unknown;
    host.children.push(placed);
    host.children.sort((a, b) => a.range[0] - b.range[0]);
    count++;
  }
}

/** Lay the tree out level by level, within the depth and node caps. */
function layout(root: Draft): ExplainNode {
  let count = 1;
  const queue: Array<{ draft: Draft; depth: number }> = [
    { draft: root, depth: 1 },
  ];
  for (let i = 0; i < queue.length; i++) {
    const { draft, depth } = queue[i];
    const { operands } = draft;
    if (operands.length === 0) continue;
    if (
      depth >= EXPLAIN_MAX_DEPTH ||
      count + operands.length > EXPLAIN_MAX_NODES
    ) {
      summarize(draft.out);
      continue;
    }
    count += operands.length;
    for (const operand of operands) {
      const child = operand.make(operand.always && draft.vouches);
      draft.out.children.push(child.out);
      queue.push({ draft: child, depth: depth + 1 });
    }
  }
  return root.out;
}

/** A node shown without its operands. */
function summarize(node: ExplainNode): void {
  if (node.kind === 'ref' || node.kind === 'literal') return;
  node.kind = 'other';
  delete node.op;
}

const COMPARE_OPS: ReadonlySet<string> = new Set([
  '==',
  '!=',
  '===',
  '!==',
  '<',
  '<=',
  '>',
  '>=',
  'in',
  'instanceof',
]);

/** `vouched`: the parent ran to a value and always computes this node. */
function draftOf(ctx: UnitContext, ast: Node, vouched: boolean): Draft {
  if (ast.type === 'ChainExpression') {
    // The chain and its outermost member or call share one range, so they
    // are one node, with the chain's probe.
    const chain = draftOf(ctx, ast.expression, vouched);
    const value = chain.out.value;
    // A withheld or left-out value says nothing about whether the chain
    // short-circuited.
    chain.vouches =
      value !== undefined &&
      value.kind !== 'undefined' &&
      value.kind !== 'redacted' &&
      value.kind !== 'elided';
    // The part before the first `?.` runs whenever the chain runs, whatever
    // the chain then came to.
    const head = headOf(ast);
    const ran = chain.out.evaluated;
    chain.operands = chain.operands.map((operand) =>
      operand.node === head
        ? { ...operand, make: (v: boolean) => operand.make(v || ran) }
        : operand,
    );
    return chain;
  }
  const literal = literalOf(ast);
  if (literal !== undefined) {
    return {
      out: nodeOf(ctx, ast, 'literal', {
        value: literal.value,
        evaluated: true,
      }),
      operands: [],
      vouches: true,
    };
  }
  const build = (
    kind: ExplainKind,
    operands: Array<{ node: Node; always: boolean }> = [],
    extra: { op?: string; ref?: ExplainRef } = {},
  ): Draft => {
    const value = ctx.probes.get(keyOf(rangeOf(ast)));
    const evaluated = value !== undefined || vouched;
    return {
      out: nodeOf(ctx, ast, kind, {
        ...extra,
        value,
        evaluated,
        unknown: !evaluated && !ctx.complete,
      }),
      operands: operands.map(({ node, always }) => ({
        always,
        node,
        make: (vouches) => draftOf(ctx, node, vouches),
      })),
      vouches: evaluated,
    };
  };
  const operand = (node: Node): { node: Node; always: boolean } => ({
    node,
    always: true,
  });

  switch (ast.type) {
    case 'Identifier':
    case 'MemberExpression': {
      const scoped = scopeRead(ctx, ast);
      if (scoped === 'leaf') return build('other');
      if (scoped !== null) {
        // A deeper read of a step's output keeps the output itself under
        // it: when the read fails, that is the value that says why.
        return build(
          'ref',
          scoped.output === undefined ? [] : [operand(scoped.output)],
          { ref: scoped.ref },
        );
      }
      if (ast.type === 'Identifier') return build('other');
      const object = ast.object;
      if (object.type === 'Super') return build('other');
      const key = staticKey(ast);
      if (key === undefined) {
        return ast.property.type === 'PrivateIdentifier'
          ? build('other')
          : build('other', [operand(object), operand(ast.property)], {
              op: '[]',
            });
      }
      return build('call', [operand(object)], { op: keyText(key) });
    }
    case 'CallExpression':
    case 'NewExpression': {
      const args = ast.arguments.map((arg) =>
        operand(arg.type === 'SpreadElement' ? arg.argument : arg),
      );
      const callee = ast.callee;
      if (callee.type === 'Super') return build('call', args);
      if (callee.type === 'Identifier') {
        return build('call', args, { op: callee.name });
      }
      if (
        callee.type === 'MemberExpression' &&
        callee.object.type !== 'Super'
      ) {
        const key = staticKey(callee);
        if (key === undefined) {
          return callee.property.type === 'PrivateIdentifier'
            ? build('call', [operand(callee.object), ...args])
            : build('call', [
                operand(callee.object),
                operand(callee.property),
                ...args,
              ]);
        }
        // `Object.keys(x)`, `Math.max(a, b)`: the namespace is part of
        // the name, not an operand.
        if (
          callee.object.type === 'Identifier' &&
          !isScopeName(ctx, callee.object)
        ) {
          return build('call', args, {
            op: `${callee.object.name}${renderPath([{ key }])}`,
          });
        }
        return build('call', [operand(callee.object), ...args], {
          op: keyText(key),
        });
      }
      return build('call', [operand(callee), ...args]);
    }
    case 'LogicalExpression': {
      const parts: Node[] = [];
      const collect = (node: Node): void => {
        if (
          node.type === 'LogicalExpression' &&
          node.operator === ast.operator
        ) {
          collect(node.left);
          collect(node.right);
        } else {
          parts.push(node);
        }
      };
      collect(ast);
      return build(
        'logical',
        parts.map((node, index) => ({ node, always: index === 0 })),
        { op: ast.operator },
      );
    }
    case 'BinaryExpression':
      if (ast.left.type === 'PrivateIdentifier') return build('other');
      return build(
        COMPARE_OPS.has(ast.operator) ? 'compare' : 'arith',
        [operand(ast.left), operand(ast.right)],
        { op: ast.operator },
      );
    case 'UnaryExpression':
      switch (ast.operator) {
        case '!':
          return build('not', [operand(ast.argument)], { op: '!' });
        case '-':
        case '+':
        case '~':
          return build('arith', [operand(ast.argument)], { op: ast.operator });
        case 'delete':
          // An assignment target, not a value.
          return build('other', [], { op: 'delete' });
        default:
          return build('other', [operand(ast.argument)], { op: ast.operator });
      }
    case 'ConditionalExpression':
      return build(
        'conditional',
        [
          operand(ast.test),
          { node: ast.consequent, always: false },
          { node: ast.alternate, always: false },
        ],
        { op: '?:' },
      );
    case 'TemplateLiteral':
      return build('other', ast.expressions.map(operand));
    case 'ArrayExpression':
      return build(
        'other',
        ast.elements.flatMap((element) =>
          element === null
            ? []
            : [
                operand(
                  element.type === 'SpreadElement' ? element.argument : element,
                ),
              ],
        ),
      );
    case 'ObjectExpression':
      return build(
        'other',
        ast.properties.map((property) =>
          operand(
            property.type === 'SpreadElement'
              ? property.argument
              : property.value,
          ),
        ),
      );
    case 'SequenceExpression':
      return build('other', ast.expressions.map(operand));
    default:
      // Functions (run per call, never probed), assignments, `this`,
      // tagged templates and the rest: their source says what they are.
      return build('other');
  }
}

function nodeOf(
  ctx: UnitContext,
  ast: Node,
  kind: ExplainKind,
  fields: {
    op?: string;
    ref?: ExplainRef;
    value: ValueSummary | undefined;
    evaluated: boolean;
    unknown?: boolean;
  },
): ExplainNode {
  const range = rangeOf(ast);
  return {
    range,
    source: clip(ctx.field.slice(range[0], range[1])),
    kind,
    ...(fields.op !== undefined && { op: clip(fields.op) }),
    ...(fields.ref !== undefined && { ref: clippedRef(fields.ref) }),
    ...(fields.value !== undefined && { value: fields.value }),
    evaluated: fields.evaluated,
    ...(fields.unknown === true && { unknown: true as const }),
    children: [],
  };
}

/** A reference with its step id and keys held to the source's length. */
function clippedRef(ref: ExplainRef): ExplainRef {
  return {
    root: ref.root,
    ...(ref.nodeId !== undefined && { nodeId: clip(ref.nodeId) }),
    path: ref.path.map((key) => (typeof key === 'string' ? clip(key) : key)),
  };
}

/** The part of an optional chain before its first `?.`: what it reads or
 * calls into, run whenever the chain runs. */
function headOf(chain: ChainExpression): Node | undefined {
  let current: Node = chain.expression;
  let head: Node | undefined;
  for (;;) {
    if (current.type === 'MemberExpression') {
      if (current.optional) head = current.object;
      current = current.object;
    } else if (current.type === 'CallExpression') {
      if (current.optional) head = current.callee;
      current = current.callee;
    } else {
      return head;
    }
  }
}

/**
 * The literal `ast` is, as the author wrote it: a number, string, boolean,
 * `null`, `undefined`, `NaN`, `Infinity`, a negative number, a template
 * without expressions, or a list or object built only of those. Its value
 * is the author's own text, which `source` shows as written, so nothing is
 * withheld from it. A regular expression is a literal without a value.
 */
function literalOf(ast: Node): { value: ValueSummary | undefined } | undefined {
  switch (ast.type) {
    case 'Literal':
      if ('regex' in ast) return { value: undefined };
      break;
    case 'TemplateLiteral':
      if (ast.expressions.length > 0) return undefined;
      break;
    case 'Identifier':
      if (!['undefined', 'NaN', 'Infinity'].includes(ast.name))
        return undefined;
      break;
    case 'UnaryExpression':
      if (
        (ast.operator !== '-' && ast.operator !== '+') ||
        ast.argument.type !== 'Literal' ||
        typeof ast.argument.value !== 'number'
      ) {
        return undefined;
      }
      break;
    case 'ArrayExpression':
    case 'ObjectExpression':
      break;
    default:
      return undefined;
  }
  const folded = foldConstant(ast);
  return folded.ok ? { value: summaryOf(folded.value) } : undefined;
}

/**
 * How `ast` reads the automation's scope when it is a static member chain
 * from a scope name: a reference (with, for a deeper read of a step's
 * output, the `nodes.<id>.output` member it passes through as `output`),
 * `'leaf'` for a read the tree does not name — `nodes` as a whole, a step's
 * record other than its output, a property of a JavaScript global
 * (`Math.PI`) — or null when it is not such a chain.
 */
function scopeRead(
  ctx: UnitContext,
  ast: Node,
): { ref: ExplainRef; output?: Node } | 'leaf' | null {
  // The member levels from the root identifier out.
  const levels: Node[] = [];
  let current: Node = ast;
  while (current.type === 'MemberExpression') {
    levels.unshift(current);
    current =
      current.object.type === 'ChainExpression'
        ? current.object.expression
        : current.object;
  }
  if (current.type !== 'Identifier') return null;
  const root = current;
  const site = siteOf(ctx, root);
  if (site === undefined || site.root === 'free') {
    // A bare name is explained by the caller; one static step off a global
    // or an undeclared name (`Math.PI`) is a leaf.
    return levels.length === 1 && staticKey(ast) !== undefined ? 'leaf' : null;
  }
  const keys =
    site.root === 'nodes'
      ? [
          ...(site.nodeId === undefined ? [] : [site.nodeId]),
          ...(site.member === undefined ? [] : [site.member]),
          ...site.path.map((step) => step.key),
        ]
      : site.path.map((step) => step.key);
  // The reference walk stops at the first computed key it cannot name, so
  // fewer keys than levels means a dynamic step.
  if (keys.length < levels.length) return null;
  const read = keys.slice(0, levels.length);
  if (site.root !== 'nodes') {
    return { ref: { root: site.root, path: read } };
  }
  const [nodeId, member, ...path] = read;
  if (typeof nodeId !== 'string' || member !== 'output') return 'leaf';
  const ref: ExplainRef = { root: 'nodes', nodeId, path };
  return path.length > 0 ? { ref, output: levels[1] } : { ref };
}

/** The reference site whose chain starts at `id`. Sites never overlap, and
 * each holds exactly one root name. */
function siteOf(ctx: UnitContext, id: Identifier): RefSite | undefined {
  const [start, end] = rangeOf(id);
  return ctx.sites.find(
    (site) =>
      site.name === id.name && site.range[0] <= start && end <= site.range[1],
  );
}

function isScopeName(ctx: UnitContext, id: Identifier): boolean {
  const site = siteOf(ctx, id);
  return site !== undefined && site.root !== 'free';
}

/** The key of a member read when it is written out (`.a`, `['a-b']`,
 * `[0]`, `` [`a`] ``), as the reference walk reads keys. */
function staticKey(member: Node): string | number | undefined {
  if (member.type !== 'MemberExpression') return undefined;
  const property = member.property;
  if (!member.computed) {
    return property.type === 'Identifier' ? property.name : undefined;
  }
  if (
    property.type === 'Literal' &&
    (typeof property.value === 'string' || typeof property.value === 'number')
  ) {
    return property.value;
  }
  if (
    property.type === 'TemplateLiteral' &&
    property.expressions.length === 0
  ) {
    const quasi = property.quasis[0];
    return quasi.value.cooked ?? quasi.value.raw;
  }
  return undefined;
}

/** `length`, `[0]`, `["a-b"]`: a key as an operator name. */
function keyText(key: string | number): string {
  const path = renderPath([{ key }]);
  return path.startsWith('.') ? path.slice(1) : path;
}

function rangeOf(node: Node): [number, number] {
  const [start, end] = node.range ?? [0, 0];
  return [start, end];
}

function keyOf(range: readonly [number, number]): string {
  return `${range[0]}:${range[1]}`;
}

/** `range` held inside a text of `length` characters. */
function clampRange(
  range: readonly [number, number],
  length: number,
): [number, number] {
  const at = (n: number): number =>
    Number.isFinite(n) ? Math.min(Math.max(Math.trunc(n), 0), length) : 0;
  const start = at(range[0]);
  return [start, Math.max(start, at(range[1]))];
}

/** At most {@link EXPLAIN_SOURCE_LENGTH} characters, never splitting a
 * character that takes two. */
function clip(text: string): string {
  if (text.length <= EXPLAIN_SOURCE_LENGTH) return text;
  let head = text.slice(0, EXPLAIN_SOURCE_LENGTH - 1);
  const last = head.charCodeAt(head.length - 1);
  if (last >= 0xd800 && last <= 0xdbff) head = head.slice(0, -1);
  return `${head}…`;
}
