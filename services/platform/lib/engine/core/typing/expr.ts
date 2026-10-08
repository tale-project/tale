/**
 * Expression typing: the shape of the value a template expression, a
 * condition or a piece of transform code produces, read from the parsed
 * code and the shapes of what it reads — never by running it.
 *
 *  - Roots: `input`, `nodes.<id>.output`, `item`, `index`, `output` (in
 *    `repeatUntil`) and the locals the surrounding code declares; a
 *    callback's parameters (`xs.map(x => …)`) take the element shape.
 *  - Members follow the base shape; an optional step on a base that can be
 *    null adds null to the whole chain, and an optional property reads as
 *    possibly null.
 *  - Literals keep their value (`'open'` is the string `"open"`); inside an
 *    object or array literal they widen to their type.
 *  - Operators, the common array and string methods and a few globals
 *    (`JSON`, `Math`, `Number`, `Object.keys`, …) have fixed result shapes.
 *  - `x ?? []`, `x || {}` and `ok ? x : []` keep the shape of `x` when it is
 *    already a list (an object): the empty literal is the fallback, not a
 *    second kind of value.
 *
 * Everything else is UNKNOWN — the typing never guesses, and no finding is
 * built on what it does not know. There is no flow narrowing: a guard such
 * as `Array.isArray(x) ? x : []` does not narrow `x`.
 */

import type {
  CallExpression,
  ChainExpression,
  ConditionalExpression,
  Expression,
  Function as EstreeFunction,
  LogicalExpression,
  MemberExpression,
  Node,
  ObjectExpression,
  Pattern,
  ReturnStatement,
  SpreadElement,
} from 'estree';
import { extract_names } from 'periscopic';
import { walk } from 'zimmerframe';

import type { RefSite } from '../syntax/walk';
import {
  BOOLEAN_SHAPE,
  elementOf,
  isClosed,
  isUnknown,
  kindsOf,
  lookup,
  membersOf,
  NULL_SHAPE,
  nullability,
  NUMBER_SHAPE,
  STRING_SHAPE,
  union,
  UNKNOWN,
  widen,
  withNull,
  withoutNull,
  type Shape,
} from './shape';

/** What the names an expression reads hold. */
export interface TypeEnv {
  /** The run input (templates) or the node's own input mapping (code). */
  input: Shape;
  /** The output shape of node `id`, when it ran; undefined for an id the
   * document does not have. */
  nodes: (id: string) => Shape | undefined;
  /** forEach: one item of the list. */
  item?: Shape;
  /** forEach: the item's position. */
  index?: true;
  /** repeatUntil: this pass's result. */
  output?: Shape;
  /** Names the surrounding code declares — typed where the typing knows the
   * value, UNKNOWN where a local merely shadows a scope name. */
  locals?: ReadonlyMap<string, Shape>;
}

interface Cx {
  env: TypeEnv;
  /** Callback scopes, innermost last. */
  scopes: Array<ReadonlyMap<string, Shape>>;
  depth: number;
  /** An optional step met a base that can be null inside the current
   * chain, so the chain as a whole can be null. */
  chainNull: boolean;
}

const MAX_DEPTH = 200;

const arrayOf = (items: Shape): Shape =>
  isUnknown(items)
    ? { type: 'array', 'x-origin': 'inferred' }
    : { type: 'array', items, 'x-origin': 'inferred' };

const STRING_ARRAY: Shape = arrayOf(STRING_SHAPE);

const GLOBAL_FUNCTIONS: Readonly<Record<string, Shape>> = {
  Number: NUMBER_SHAPE,
  parseInt: NUMBER_SHAPE,
  parseFloat: NUMBER_SHAPE,
  String: STRING_SHAPE,
  encodeURI: STRING_SHAPE,
  encodeURIComponent: STRING_SHAPE,
  decodeURI: STRING_SHAPE,
  decodeURIComponent: STRING_SHAPE,
  Boolean: BOOLEAN_SHAPE,
  isNaN: BOOLEAN_SHAPE,
  isFinite: BOOLEAN_SHAPE,
};

const COMPARISONS: ReadonlySet<string> = new Set([
  '==',
  '!=',
  '===',
  '!==',
  '<',
  '>',
  '<=',
  '>=',
  'in',
  'instanceof',
]);

function isLocal(name: string, cx: Cx): boolean {
  for (let i = cx.scopes.length - 1; i >= 0; i--) {
    if (cx.scopes[i].has(name)) return true;
  }
  return cx.env.locals?.has(name) ?? false;
}

function localShape(name: string, cx: Cx): Shape | undefined {
  for (let i = cx.scopes.length - 1; i >= 0; i--) {
    const s = cx.scopes[i].get(name);
    if (s !== undefined) return s;
  }
  return cx.env.locals?.get(name);
}

function identifier(name: string, cx: Cx): Shape {
  const local = localShape(name, cx);
  if (local !== undefined) return local;
  switch (name) {
    case 'input':
      return cx.env.input;
    case 'item':
      return cx.env.item ?? UNKNOWN;
    case 'index':
      return cx.env.index === true ? NUMBER_SHAPE : UNKNOWN;
    case 'output':
      return cx.env.output ?? UNKNOWN;
    case 'undefined':
      return NULL_SHAPE;
    case 'NaN':
    case 'Infinity':
      return NUMBER_SHAPE;
    default:
      return UNKNOWN;
  }
}

/** The key a member names statically: `x.key`, `x['key']`, `x[0]`,
 * x[`key`]. */
function staticKey(m: MemberExpression): string | number | undefined {
  if (!m.computed) {
    return m.property.type === 'Identifier' ? m.property.name : undefined;
  }
  const p = m.property;
  if (
    p.type === 'Literal' &&
    (typeof p.value === 'string' || typeof p.value === 'number')
  ) {
    return p.value;
  }
  if (p.type === 'TemplateLiteral' && p.expressions.length === 0) {
    return p.quasis[0]?.value.cooked ?? undefined;
  }
  return undefined;
}

/** A member read with a key the typing cannot name (`x[k]`). */
function dynamicMember(base: Shape): Shape {
  const parts: Shape[] = [];
  for (const m of membersOf(base)) {
    if (nullability(m) === 'always') continue;
    const kinds = kindsOf(m);
    if (kinds === null || kinds.size !== 1) return UNKNOWN;
    if (kinds.has('array')) parts.push(elementOf(m));
    else if (kinds.has('string')) parts.push(STRING_SHAPE);
    else if (kinds.has('object') && typeof m.additionalProperties === 'object')
      parts.push(withNull(m.additionalProperties));
    else return UNKNOWN;
  }
  return parts.length === 0 ? UNKNOWN : union(...parts);
}

function member(m: MemberExpression, cx: Cx): Shape {
  if (m.object.type === 'Super') return UNKNOWN;
  const key = staticKey(m);
  if (
    m.object.type === 'Identifier' &&
    m.object.name === 'nodes' &&
    !isLocal('nodes', cx)
  ) {
    if (key === undefined) return UNKNOWN;
    const output = cx.env.nodes(String(key));
    if (output === undefined) return UNKNOWN;
    return {
      type: 'object',
      properties: { output },
      required: ['output'],
      'x-origin': 'fixed',
    };
  }
  const base = typeOf(m.object, cx);
  if (m.optional && nullability(base) !== 'never') cx.chainNull = true;
  if (key === undefined) return dynamicMember(base);
  const found = lookup(base, key);
  if (found.kind !== 'found') return UNKNOWN;
  return found.optional ? withNull(found.shape) : found.shape;
}

function chain(c: ChainExpression, cx: Cx): Shape {
  const saved = cx.chainNull;
  cx.chainNull = false;
  const shape = typeOf(c.expression, cx);
  const nullable = cx.chainNull;
  cx.chainNull = saved;
  return nullable ? withNull(shape) : shape;
}

/** Every return of a function body and every name it declares, without
 * looking into the functions nested in it. */
function bodyFacts(body: Node): {
  returns: ReturnStatement[];
  declared: Set<string>;
} {
  const returns: ReturnStatement[] = [];
  const declared = new Set<string>();
  walk<Node, null>(body, null, {
    _(node, { next }) {
      if (
        node !== body &&
        (node.type === 'FunctionDeclaration' ||
          node.type === 'FunctionExpression' ||
          node.type === 'ArrowFunctionExpression')
      ) {
        if (node.type === 'FunctionDeclaration' && node.id) {
          declared.add(node.id.name);
        }
        return;
      }
      if (node.type === 'VariableDeclaration') {
        for (const d of node.declarations) {
          for (const name of extract_names(d.id)) declared.add(name);
        }
      } else if (node.type === 'ClassDeclaration' && node.id) {
        declared.add(node.id.name);
      } else if (node.type === 'CatchClause' && node.param) {
        for (const name of extract_names(node.param)) declared.add(name);
      } else if (node.type === 'ReturnStatement') {
        returns.push(node);
      }
      next();
    },
  });
  return { returns, declared };
}

function bind(p: Pattern, shape: Shape, scope: Map<string, Shape>): void {
  if (p.type === 'Identifier') scope.set(p.name, shape);
  else for (const name of extract_names(p)) scope.set(name, UNKNOWN);
}

/** The value a callback produces for arguments of shapes `params`: its
 * expression body, or the one `return` of its block body. */
function callbackResult(
  fn: Expression | SpreadElement | undefined,
  params: Shape[],
  cx: Cx,
): Shape {
  if (
    fn === undefined ||
    (fn.type !== 'ArrowFunctionExpression' &&
      fn.type !== 'FunctionExpression') ||
    fn.async ||
    fn.generator
  ) {
    return UNKNOWN;
  }
  const f: EstreeFunction = fn;
  const scope = new Map<string, Shape>();
  for (const [i, p] of f.params.entries()) bind(p, params[i] ?? UNKNOWN, scope);
  if (fn.type === 'FunctionExpression' && fn.id) scope.set(fn.id.name, UNKNOWN);
  let result: Node | null | undefined;
  if (fn.body.type === 'BlockStatement') {
    const facts = bodyFacts(fn.body);
    if (facts.returns.length !== 1) return UNKNOWN;
    for (const name of facts.declared) {
      if (!scope.has(name)) scope.set(name, UNKNOWN);
    }
    result = facts.returns[0].argument;
  } else {
    result = fn.body;
  }
  if (result === null || result === undefined) return UNKNOWN;
  cx.scopes.push(scope);
  try {
    return typeOf(result, cx);
  } finally {
    cx.scopes.pop();
  }
}

function arrayMethod(
  base: Shape,
  name: string,
  args: Array<Expression | SpreadElement>,
  cx: Cx,
): Shape {
  const element = elementOf(base);
  switch (name) {
    case 'map':
      return arrayOf(callbackResult(args[0], [element, NUMBER_SHAPE], cx));
    case 'filter':
    case 'slice':
    case 'sort':
    case 'reverse':
    case 'toSorted':
    case 'toReversed':
    case 'concat':
      return base;
    case 'find':
    case 'findLast':
    case 'at':
    case 'pop':
    case 'shift':
      return withNull(element);
    case 'some':
    case 'every':
    case 'includes':
      return BOOLEAN_SHAPE;
    case 'indexOf':
    case 'lastIndexOf':
    case 'findIndex':
    case 'findLastIndex':
    case 'push':
    case 'unshift':
      return NUMBER_SHAPE;
    case 'join':
    case 'toString':
      return STRING_SHAPE;
    case 'forEach':
      return NULL_SHAPE;
    default:
      return UNKNOWN;
  }
}

function stringMethod(name: string): Shape {
  switch (name) {
    case 'trim':
    case 'trimStart':
    case 'trimEnd':
    case 'toLowerCase':
    case 'toUpperCase':
    case 'toLocaleLowerCase':
    case 'toLocaleUpperCase':
    case 'slice':
    case 'substring':
    case 'substr':
    case 'replace':
    case 'replaceAll':
    case 'padStart':
    case 'padEnd':
    case 'charAt':
    case 'concat':
    case 'repeat':
    case 'normalize':
    case 'toString':
    case 'valueOf':
      return STRING_SHAPE;
    case 'at':
      return withNull(STRING_SHAPE);
    case 'split':
      return STRING_ARRAY;
    case 'includes':
    case 'startsWith':
    case 'endsWith':
      return BOOLEAN_SHAPE;
    case 'indexOf':
    case 'lastIndexOf':
    case 'search':
    case 'charCodeAt':
    case 'codePointAt':
    case 'localeCompare':
      return NUMBER_SHAPE;
    default:
      return UNKNOWN;
  }
}

/** The result of calling method `name` on a value of shape `base`. */
function method(
  base: Shape,
  name: string,
  args: Array<Expression | SpreadElement>,
  cx: Cx,
): Shape {
  if (isUnknown(base)) return UNKNOWN;
  if (base.anyOf !== undefined) {
    const parts: Shape[] = [];
    for (const m of base.anyOf) {
      if (nullability(m) === 'always') continue;
      const r = method(m, name, args, cx);
      if (isUnknown(r)) return UNKNOWN;
      parts.push(r);
    }
    return parts.length === 0 ? UNKNOWN : union(...parts);
  }
  const kinds = kindsOf(base);
  if (kinds === null || kinds.size !== 1) return UNKNOWN;
  const [kind] = kinds;
  switch (kind) {
    case 'array':
      return arrayMethod(base, name, args, cx);
    case 'string':
      return stringMethod(name);
    case 'number':
      return ['toFixed', 'toString', 'toPrecision', 'toExponential'].includes(
        name,
      )
        ? STRING_SHAPE
        : UNKNOWN;
    case 'boolean':
    case 'object':
      if (name === 'toString') return STRING_SHAPE;
      if (name === 'hasOwnProperty') return BOOLEAN_SHAPE;
      return UNKNOWN;
    default:
      return UNKNOWN;
  }
}

/** `Math.max(…)`, `JSON.stringify(…)`, `Object.keys(…)` and their kin. */
function namespaceCall(
  ns: string,
  name: string,
  args: Array<Expression | SpreadElement>,
  cx: Cx,
): Shape | undefined {
  switch (ns) {
    case 'Math':
      return NUMBER_SHAPE;
    case 'JSON':
      return name === 'stringify' ? STRING_SHAPE : UNKNOWN;
    case 'Date':
      return name === 'now' || name === 'parse' || name === 'UTC'
        ? NUMBER_SHAPE
        : UNKNOWN;
    case 'Number':
      if (name === 'parseInt' || name === 'parseFloat') return NUMBER_SHAPE;
      return name.startsWith('is') ? BOOLEAN_SHAPE : UNKNOWN;
    case 'Array':
      return name === 'isArray' ? BOOLEAN_SHAPE : UNKNOWN;
    case 'Object': {
      if (name === 'keys') return STRING_ARRAY;
      const arg = args[0];
      if (name === 'values') {
        const of =
          arg === undefined || arg.type === 'SpreadElement'
            ? UNKNOWN
            : typeOf(arg, cx);
        if (typeof of.additionalProperties === 'object') {
          return arrayOf(of.additionalProperties);
        }
        const values = Object.values(of.properties ?? {});
        return arrayOf(
          isClosed(of) && values.length > 0 ? union(...values) : UNKNOWN,
        );
      }
      if (name === 'entries') return arrayOf(UNKNOWN);
      return UNKNOWN;
    }
    default:
      return undefined;
  }
}

function call(c: CallExpression, cx: Cx): Shape {
  const callee = c.callee;
  if (callee.type === 'Identifier') {
    if (isLocal(callee.name, cx)) return UNKNOWN;
    return Object.hasOwn(GLOBAL_FUNCTIONS, callee.name)
      ? GLOBAL_FUNCTIONS[callee.name]
      : UNKNOWN;
  }
  if (callee.type !== 'MemberExpression' || callee.object.type === 'Super') {
    return UNKNOWN;
  }
  const name = staticKey(callee);
  if (typeof name !== 'string') return UNKNOWN;
  const obj = callee.object;
  if (obj.type === 'Identifier' && !isLocal(obj.name, cx)) {
    const fixed = namespaceCall(obj.name, name, c.arguments, cx);
    if (fixed !== undefined) return fixed;
  }
  const base = typeOf(obj, cx);
  if (callee.optional && nullability(base) !== 'never') cx.chainNull = true;
  return method(base, name, c.arguments, cx);
}

/** `[]` or `{}` — the empty fallback of `x ?? []`. */
function emptyLiteral(n: Node): 'array' | 'object' | null {
  if (n.type === 'ArrayExpression' && n.elements.length === 0) return 'array';
  if (n.type === 'ObjectExpression' && n.properties.length === 0) {
    return 'object';
  }
  return null;
}

/** `primary`, or the union with the alternative unless the alternative is
 * the empty literal of primary's own kind. */
function orElse(primary: Shape, alt: Node, cx: Cx): Shape {
  const kind = emptyLiteral(alt);
  if (kind !== null) {
    const kinds = kindsOf(primary);
    if (kinds !== null && kinds.size === 1 && kinds.has(kind)) return primary;
  }
  return union(primary, typeOf(alt, cx));
}

function logical(e: LogicalExpression, cx: Cx): Shape {
  const left = typeOf(e.left, cx);
  if (e.operator === '&&') return union(left, typeOf(e.right, cx));
  // `??` and `||` return the left value only when it is not null (and, for
  // `||`, truthy).
  const kept = withoutNull(left);
  if (kept === null) return typeOf(e.right, cx);
  return orElse(kept, e.right, cx);
}

function conditional(e: ConditionalExpression, cx: Cx): Shape {
  if (emptyLiteral(e.alternate) !== null) {
    return orElse(typeOf(e.consequent, cx), e.alternate, cx);
  }
  if (emptyLiteral(e.consequent) !== null) {
    return orElse(typeOf(e.alternate, cx), e.consequent, cx);
  }
  return union(typeOf(e.consequent, cx), typeOf(e.alternate, cx));
}

function object(o: ObjectExpression, cx: Cx): Shape {
  const props = new Map<string, Shape>();
  for (const p of o.properties) {
    if (p.type !== 'Property' || p.kind !== 'init') return UNKNOWN;
    let key: string;
    if (!p.computed && p.key.type === 'Identifier') key = p.key.name;
    else if (
      p.key.type === 'Literal' &&
      (typeof p.key.value === 'string' || typeof p.key.value === 'number')
    ) {
      key = String(p.key.value);
    } else return UNKNOWN;
    // `__proto__: x` sets the prototype; it is no property.
    if (key === '__proto__' && !p.computed && !p.shorthand) return UNKNOWN;
    props.delete(key);
    props.set(key, p.method ? UNKNOWN : widen(typeOf(p.value, cx)));
  }
  const shape: Shape = { type: 'object', 'x-origin': 'inferred' };
  if (props.size > 0) {
    shape.properties = Object.fromEntries(props);
    shape.required = [...props.keys()];
  }
  return shape;
}

function plus(a: Shape, b: Shape): Shape {
  const ka = kindsOf(a);
  const kb = kindsOf(b);
  const only = (k: ReadonlySet<string> | null, kind: string) =>
    k !== null && k.size === 1 && k.has(kind);
  if (only(ka, 'string') || only(kb, 'string')) return STRING_SHAPE;
  const numeric = (k: ReadonlySet<string> | null) =>
    k !== null &&
    [...k].every((x) => x === 'number' || x === 'boolean' || x === 'null');
  return numeric(ka) && numeric(kb) ? NUMBER_SHAPE : UNKNOWN;
}

function typeOf(node: Node, cx: Cx): Shape {
  if (cx.depth > MAX_DEPTH) return UNKNOWN;
  cx.depth++;
  try {
    return typeOfNode(node, cx);
  } finally {
    cx.depth--;
  }
}

function typeOfNode(node: Node, cx: Cx): Shape {
  switch (node.type) {
    case 'Identifier':
      return identifier(node.name, cx);
    case 'Literal':
      if (typeof node.value === 'string') {
        return { type: 'string', const: node.value };
      }
      if (typeof node.value === 'number') {
        return { type: 'number', const: node.value };
      }
      if (typeof node.value === 'boolean') {
        return { type: 'boolean', const: node.value };
      }
      return node.value === null && !('regex' in node) ? NULL_SHAPE : UNKNOWN;
    case 'TemplateLiteral':
      return STRING_SHAPE;
    case 'ArrayExpression': {
      if (node.elements.length === 0) {
        return { type: 'array', 'x-origin': 'inferred' };
      }
      const items = node.elements.map((el) => {
        if (el === null) return NULL_SHAPE;
        if (el.type === 'SpreadElement')
          return elementOf(typeOf(el.argument, cx));
        return widen(typeOf(el, cx));
      });
      return arrayOf(union(...items));
    }
    case 'ObjectExpression':
      return object(node, cx);
    case 'MemberExpression':
      return member(node, cx);
    case 'ChainExpression':
      return chain(node, cx);
    case 'CallExpression':
      return call(node, cx);
    case 'UnaryExpression':
      switch (node.operator) {
        case '!':
        case 'delete':
          return BOOLEAN_SHAPE;
        case 'typeof':
          return STRING_SHAPE;
        case 'void':
          return NULL_SHAPE;
        default:
          return NUMBER_SHAPE;
      }
    case 'UpdateExpression':
      return NUMBER_SHAPE;
    case 'BinaryExpression':
      if (COMPARISONS.has(node.operator)) return BOOLEAN_SHAPE;
      if (node.operator === '+') {
        if (node.left.type === 'PrivateIdentifier') return UNKNOWN;
        return plus(typeOf(node.left, cx), typeOf(node.right, cx));
      }
      return NUMBER_SHAPE;
    case 'LogicalExpression':
      return logical(node, cx);
    case 'ConditionalExpression':
      return conditional(node, cx);
    case 'SequenceExpression': {
      const last = node.expressions.at(-1);
      return last === undefined ? UNKNOWN : typeOf(last, cx);
    }
    case 'AssignmentExpression':
      return typeOf(node.right, cx);
    default:
      return UNKNOWN;
  }
}

/** The shape of the value `node` evaluates to under `env`. */
export function typeOfExpression(node: Node, env: TypeEnv): Shape {
  return typeOf(node, { env, scopes: [], depth: 0, chainNull: false });
}

/**
 * The shape a reference site starts from: the output of the node it names,
 * the input, the item, the index or the pass's `output` — undefined for a
 * root the environment does not have. The site's `path` continues from
 * here (for a node, after `.output`).
 */
export function rootShapeOf(site: RefSite, env: TypeEnv): Shape | undefined {
  switch (site.root) {
    case 'nodes':
      return site.nodeId === undefined || site.member !== 'output'
        ? undefined
        : env.nodes(site.nodeId);
    case 'input':
      return env.input;
    case 'item':
      return env.item;
    case 'index':
      return env.index === true ? NUMBER_SHAPE : undefined;
    case 'output':
      return env.output;
    default:
      return undefined;
  }
}
