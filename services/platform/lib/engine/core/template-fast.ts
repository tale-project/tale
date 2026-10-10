/**
 * The template fast path: the units most templates are made of — a path
 * into the scope (`{{ item.title }}`, `{{ nodes.fetch.output.rows[3] }}`),
 * a literal, or a path with a fallback (`{{ input.limit ?? 50 }}`) — read
 * straight from the scope, without the round trip through the code runner.
 *
 * A unit's plan is decided once per source string, from the parsed
 * expression (never a pattern), and cached. Reading a planned unit runs no
 * authored code: it reads the data the runner would have been handed, so it
 * does not weaken the runner boundary. It answers exactly what the runner
 * answers — the value a JSON round trip of the read would give — and when
 * it cannot be sure it answers {@link RUNNER}, never a guess: the runner
 * decides, with its own error text when the read fails.
 */

import type { Node, TemplateLiteral } from 'estree';

import { cloneData } from './execute/scope';
import { parseExpressionIn } from './syntax/parse';

/** A value read from the scope: a path from one of its roots. */
interface FastPath {
  readonly kind: 'path';
  readonly root: string;
  readonly steps: readonly FastStep[];
}

/** One member read along a path; a computed key may itself be a path
 * (`rows[index]`, `byId[item.id]`). */
export interface FastStep {
  readonly key: string | number | FastPath;
  /** Read with `?.`: a missing base ends the whole path as `undefined`. */
  readonly optional: boolean;
}

/** A literal a unit may be or fall back to. */
type FastLiteral =
  | {
      readonly kind: 'literal';
      readonly value: null | boolean | number | string;
    }
  | { readonly kind: 'empty'; readonly shape: 'array' | 'object' };

/** What a fast unit reads: a path, a literal, or a path with a fallback. */
export type FastTerm =
  | FastPath
  | FastLiteral
  | {
      readonly kind: 'or';
      readonly op: '??' | '||';
      readonly left: FastPath;
      readonly right: FastPath | FastLiteral;
    };

/** How one `{{ }}` unit is evaluated: read here, or by the runner. */
export type UnitPlan =
  | { readonly kind: 'fast'; readonly term: FastTerm }
  | { readonly kind: 'runner' };

/** The answer of a read the runner must make. */
export const RUNNER: unique symbol = Symbol('runner');

/** The roots a scope hands an expression. */
const ROOTS: ReadonlySet<string> = new Set([
  'input',
  'nodes',
  'item',
  'index',
  'output',
]);

const RUNNER_PLAN: UnitPlan = { kind: 'runner' };

let fastPathOn = true;

/**
 * Turn the fast path on or off for the whole process (on by default). Off,
 * every unit goes through the runner, as it did before the fast path.
 */
export function configureTemplates(options: { fastPath: boolean }): void {
  fastPathOn = options.fastPath;
}

/** Whether units are read on the fast path. */
export function fastPathEnabled(): boolean {
  return fastPathOn;
}

/** Plans kept: enough for every unit of a busy deployment's documents. */
const PLAN_CACHE_LIMIT = 4096;
/** Sources longer than this are planned every time: they are code, not a
 * lookup, and keeping them would crowd out the units that repeat. */
const PLAN_CACHE_MAX_SOURCE = 2048;
const plans = new Map<string, UnitPlan>();

/** A unit's plan, decided once per source string. */
export function unitPlan(source: string): UnitPlan {
  const cached = plans.get(source);
  if (cached !== undefined) {
    // Most recently used last, so the oldest is the one evicted.
    plans.delete(source);
    plans.set(source, cached);
    return cached;
  }
  const plan = planOf(source);
  if (source.length <= PLAN_CACHE_MAX_SOURCE) {
    if (plans.size >= PLAN_CACHE_LIMIT) {
      const oldest = plans.keys().next().value;
      if (oldest !== undefined) plans.delete(oldest);
    }
    plans.set(source, plan);
  }
  return plan;
}

function planOf(source: string): UnitPlan {
  const parsed = parseExpressionIn(source, 0, source.length);
  if (!parsed.ok) return RUNNER_PLAN;
  const term = termOf(parsed.ast);
  return term === null ? RUNNER_PLAN : { kind: 'fast', term };
}

function termOf(node: Node): FastTerm | null {
  if (node.type === 'LogicalExpression') {
    if (node.operator !== '??' && node.operator !== '||') return null;
    const left = pathOf(node.left);
    if (left === null) return null;
    const right = pathOf(node.right) ?? literalOf(node.right);
    return right === null
      ? null
      : { kind: 'or', op: node.operator, left, right };
  }
  return pathOf(node) ?? literalOf(node);
}

/** A whole expression that is a path from a scope root, or null. */
function pathOf(node: Node): FastPath | null {
  // `a?.b.c` is one chain; a chain nested deeper (`(a?.b).c`) is not, and
  // the runner reads it.
  let current: Node = node.type === 'ChainExpression' ? node.expression : node;
  const steps: FastStep[] = [];
  while (current.type === 'MemberExpression') {
    const { property } = current;
    let key: FastStep['key'] | null;
    if (property.type === 'PrivateIdentifier') return null;
    if (!current.computed) {
      key = property.type === 'Identifier' ? property.name : null;
    } else {
      key = keyOf(property);
    }
    if (key === null) return null;
    steps.unshift({ key, optional: current.optional });
    current = current.object;
  }
  if (current.type !== 'Identifier' || !ROOTS.has(current.name)) return null;
  return { kind: 'path', root: current.name, steps };
}

/** A computed key: a string or number literal, or a path. */
function keyOf(node: Node): FastStep['key'] | null {
  if (node.type === 'Literal') {
    return typeof node.value === 'string' ||
      (typeof node.value === 'number' && Number.isFinite(node.value))
      ? node.value
      : null;
  }
  if (node.type === 'TemplateLiteral') return templateText(node);
  return pathOf(node);
}

function templateText(node: TemplateLiteral): string | null {
  if (node.expressions.length > 0) return null;
  return node.quasis[0]?.value.cooked ?? null;
}

function literalOf(node: Node): FastLiteral | null {
  switch (node.type) {
    case 'Literal': {
      const { value } = node;
      return value === null ||
        typeof value === 'boolean' ||
        typeof value === 'string' ||
        (typeof value === 'number' && Number.isFinite(value))
        ? { kind: 'literal', value }
        : null;
    }
    case 'TemplateLiteral': {
      const text = templateText(node);
      return text === null ? null : { kind: 'literal', value: text };
    }
    case 'ArrayExpression':
      return node.elements.length === 0
        ? { kind: 'empty', shape: 'array' }
        : null;
    case 'ObjectExpression':
      return node.properties.length === 0
        ? { kind: 'empty', shape: 'object' }
        : null;
    default:
      return null;
  }
}

/**
 * A planned term read from the live scope, as the runner's answer would be
 * — a JSON copy of what it read — or {@link RUNNER} when the runner must
 * decide. Never throws.
 */
export function resolveFast(
  term: FastTerm,
  scope: Readonly<Record<string, unknown>>,
): unknown {
  const value = readTerm(term, scope);
  return value === RUNNER ? RUNNER : cloneData(value);
}

function readTerm(
  term: FastTerm,
  scope: Readonly<Record<string, unknown>>,
): unknown {
  switch (term.kind) {
    case 'path':
      return readPath(term, scope);
    case 'literal':
      return term.value;
    case 'empty':
      return term.shape === 'array' ? [] : {};
    case 'or': {
      const left = readPath(term.left, scope);
      if (left === RUNNER) return RUNNER;
      const keep = term.op === '??' ? left != null : Boolean(left);
      return keep ? left : readTerm(term.right, scope);
    }
    default:
      return RUNNER;
  }
}

function readPath(
  path: FastPath,
  scope: Readonly<Record<string, unknown>>,
): unknown {
  // A root the scope does not hold is a ReferenceError in the runner.
  if (!Object.hasOwn(scope, path.root)) return RUNNER;
  let current: unknown = scope[path.root];
  if (!readable(current)) return RUNNER;
  for (const step of path.steps) {
    if (current === null || current === undefined) {
      // `?.` ends the whole chain; a plain read of a missing base is a
      // TypeError, whose text the runner gives.
      return step.optional ? undefined : RUNNER;
    }
    const key = keyText(step.key, scope);
    if (key === null) return RUNNER;
    const next = member(current, key);
    if (next === RUNNER) return RUNNER;
    current = next;
  }
  return current;
}

/** The key a step reads, as text, or null when the runner must decide. */
function keyText(
  key: FastStep['key'],
  scope: Readonly<Record<string, unknown>>,
): string | null {
  if (typeof key === 'string') return key;
  if (typeof key === 'number') return String(key);
  const value = readPath(key, scope);
  if (typeof value === 'string') return value;
  if (typeof value === 'number' && Number.isFinite(value)) {
    return String(value);
  }
  return null;
}

/** An array index as text: `0`, `12`. */
const INDEX = /^(?:0|[1-9]\d*)$/;

/** `base[key]` as the runner would read it from JSON data, or RUNNER. */
function member(base: unknown, key: string): unknown {
  // The runner reads `__proto__` against its own prototypes.
  if (key === '__proto__') return RUNNER;
  if (typeof base === 'string') {
    const boxed: object = Object(base);
    if (Object.hasOwn(boxed, key)) return Reflect.get(boxed, key);
    return key in String.prototype ? RUNNER : undefined;
  }
  if (typeof base !== 'object' || base === null) return RUNNER;
  if (!readable(base)) return RUNNER;
  if (Array.isArray(base)) {
    if (key === 'length') return base.length;
    if (INDEX.test(key)) {
      // A hole reads as null in the runner's JSON copy.
      if (!Object.hasOwn(base, key)) {
        return Number(key) < base.length ? RUNNER : undefined;
      }
      const value: unknown = base[Number(key)];
      return readable(value) ? value : RUNNER;
    }
    // Any other member of an array is either inherited (`map`) or dropped
    // by the JSON copy: the runner decides.
    return key in base ? RUNNER : undefined;
  }
  if (Object.hasOwn(base, key)) {
    const value: unknown = Reflect.get(base, key);
    return readable(value) ? value : RUNNER;
  }
  // Found on the prototype chain (`constructor`, `toString`): the runner
  // answers a function as nothing or an object as itself.
  return key in base ? RUNNER : undefined;
}

/**
 * A value whose members read the same here as from the runner's JSON copy:
 * a primitive, an array or a plain object that converts to JSON as itself.
 * A `Date`, a map, a class instance, an object without a prototype or one
 * with its own `toJSON` that an output still holds in memory is the
 * runner's to read.
 */
function readable(value: unknown): boolean {
  if (value === null) return true;
  switch (typeof value) {
    case 'string':
    case 'number':
    case 'boolean':
    case 'undefined':
      return true;
    case 'object':
      break;
    default:
      return false;
  }
  if (Object.hasOwn(value, 'toJSON')) return false;
  const proto: unknown = Object.getPrototypeOf(value);
  return Array.isArray(value)
    ? proto === Array.prototype
    : proto === Object.prototype;
}
