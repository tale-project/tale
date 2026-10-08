/**
 * Node output inference: what every node of a document hands its readers
 * when it runs, in execution order, so each node is typed from the nodes it
 * reads.
 *
 * | Node            | Output when it ran                                      |
 * | --------------- | ------------------------------------------------------- |
 * | `transform`     | its return literals (below), else unknown               |
 * | `llm`           | its `outputSchema`, else `{ text: string }`             |
 * | `agent`         | `{ text, files: Array<{ name, … }>, status }`           |
 * | `subautomation` | the child document's output, resolved like a run        |
 * | connector       | the action's documented output signature                |
 *
 * Under `forEach` the output is the list of per-item results and `item` is
 * one element of the list `forEach` names; under `repeatUntil` it is the
 * last pass's result.
 *
 * A transform's output is read from its code: when every `return` outside a
 * nested function returns an object literal with plain keys, the output is
 * that object (a key every return carries is required); a lone array
 * literal return gives a list. Values are typed with the node's own input
 * mapping as `input` and the body's top-level constants — a constant the
 * code mutates later (`out.x = 1`, `list.push(…)`) is unknown, since its
 * initializer no longer describes it.
 *
 * Child documents come from `resolveChildren` (fetched once per call);
 * nesting stops where a run stops, and a cycle reads as unknown.
 */

import type { Node, ReturnStatement } from 'estree';
import { analyze } from 'periscopic';
import { walk } from 'zimmerframe';

import { isRecord } from '../../../utils/type-utils';
import { topoSort } from '../execute/controlflow';
import { nodeTypes } from '../slots';
import type { SourceField } from '../syntax/globals';
import { ptr } from '../syntax/pointer';
import {
  outputSources,
  sourcesOf,
  type ExprSource,
  type ParseCtx,
} from '../syntax/sources';
import { exprSegments, isSingleTemplate } from '../syntax/tokens';
import type { NodeDef } from '../types';
import { MAX_SUBAUTOMATION_DEPTH, type ChildDocuments } from './children';
import { typeOfExpression, type TypeEnv } from './expr';
import { normalizeSchema } from './normalize';
import {
  elementOf,
  isUnknown,
  kindsOf,
  NULL_SHAPE,
  shapeOfValue,
  STRING_SHAPE,
  toTs,
  union,
  UNKNOWN,
  widen,
  type Shape,
  type ShapeOrigin,
} from './shape';
import { connectorOutputShape } from './signature';

export interface NodeTypeInfo {
  /** What the node's output holds when it ran — the list of per-item
   * results under `forEach`. */
  output: Shape;
  /** forEach: one item of the list. */
  item?: Shape;
  /** The node's resolved `input` mapping — what transform code reads as
   * `input`. */
  input?: Shape;
  /** `output` as a TypeScript type. */
  ts: string;
  origin: ShapeOrigin | 'unknown';
}

export interface AutomationTypes {
  /** The run input (the `inputs` schema). */
  inputs: Shape;
  nodes: Record<string, NodeTypeInfo>;
  /** What a successful run returns (null without an `output`). */
  output: Shape;
}

export interface InferDocument {
  inputs?: unknown;
  nodes: readonly NodeDef[];
  output?: unknown;
}

export interface InferOptions {
  /** The per-call parse memo, shared with validation. */
  parse?: ParseCtx;
  /** Child documents for subautomation nodes, from `resolveChildren`. */
  children?: ChildDocuments;
}

/** A transform without an `input` mapping runs over `{}`. */
const EMPTY_INPUT: Shape = Object.freeze({
  type: 'object',
  'x-origin': 'inferred',
});

const LLM_TEXT: Shape = Object.freeze({
  type: 'object',
  properties: { text: STRING_SHAPE },
  required: ['text'],
  'x-origin': 'fixed',
});

const AGENT_ENVELOPE: Shape = Object.freeze<Shape>({
  type: 'object',
  properties: {
    text: STRING_SHAPE,
    files: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          name: STRING_SHAPE,
          storageId: STRING_SHAPE,
          size: { type: 'number' },
          contentType: STRING_SHAPE,
        },
        required: ['name'],
        'x-origin': 'fixed',
      },
      'x-origin': 'fixed',
    },
    status: STRING_SHAPE,
  },
  required: ['text', 'files', 'status'],
  'x-origin': 'fixed',
});

/** Methods that change the array, map or set they are called on. */
const MUTATORS: ReadonlySet<string> = new Set([
  'push',
  'pop',
  'shift',
  'unshift',
  'splice',
  'sort',
  'reverse',
  'fill',
  'copyWithin',
  'set',
  'add',
  'delete',
  'clear',
]);

/**
 * The names an expression in `field` of `node` (or of the document output
 * when `node` is undefined) reads, typed: `input` is the run input — or,
 * in transform code, the node's own input mapping — and `item`/`index`/
 * `output` exist exactly where the runtime declares them.
 */
export function envFor(
  types: AutomationTypes,
  node: Pick<NodeDef, 'id' | 'forEach'> | undefined,
  field: SourceField,
): TypeEnv {
  const nodes = (id: string): Shape | undefined =>
    Object.hasOwn(types.nodes, id) ? types.nodes[id].output : undefined;
  const env: TypeEnv = { input: types.inputs, nodes };
  if (node === undefined) return env;
  const info = Object.hasOwn(types.nodes, node.id)
    ? types.nodes[node.id]
    : undefined;
  return scoped(env, field, typeof node.forEach === 'string', info);
}

function scoped(
  base: TypeEnv,
  field: SourceField,
  iterates: boolean,
  info: Partial<NodeTypeInfo> | undefined,
): TypeEnv {
  const env: TypeEnv = { ...base };
  if (field === 'code') env.input = info?.input ?? EMPTY_INPUT;
  if (iterates && field !== 'forEach' && field !== 'when') {
    env.item = info?.item ?? UNKNOWN;
    env.index = true;
  }
  if (field === 'repeatUntil') {
    const out = info?.output ?? UNKNOWN;
    env.output = iterates ? elementOf(out) : out;
  }
  return env;
}

/** The shape of a template field's value: one whole template keeps its
 * expression's shape, text with templates in it is a string. */
function templateShape(source: ExprSource, env: TypeEnv): Shape {
  const tokens = source.tokens;
  if (tokens === undefined || exprSegments(tokens).length === 0) {
    return STRING_SHAPE;
  }
  if (!isSingleTemplate(source.text, tokens)) return STRING_SHAPE;
  const unit = source.units[0];
  if (unit === undefined || !unit.parse.ok || unit.opaque) return UNKNOWN;
  return typeOfExpression(unit.parse.ast, env);
}

/**
 * The shape of a value tree whose strings may hold templates (an `input`
 * mapping, the document `output`): every object is exact, every template
 * is typed where it stands.
 */
function mappingShape(
  value: unknown,
  pointer: string,
  byPointer: ReadonlyMap<string, ExprSource>,
  env: TypeEnv,
  depth = 0,
): Shape {
  if (depth > 32) return UNKNOWN;
  if (typeof value === 'string') {
    const source = byPointer.get(pointer);
    return source === undefined ? STRING_SHAPE : templateShape(source, env);
  }
  if (Array.isArray(value)) {
    if (value.length === 0) return { type: 'array', 'x-origin': 'inferred' };
    return {
      type: 'array',
      items: union(
        ...value.map((v: unknown, i) =>
          widen(
            mappingShape(v, `${pointer}${ptr(i)}`, byPointer, env, depth + 1),
          ),
        ),
      ),
      'x-origin': 'inferred',
    };
  }
  if (isRecord(value)) {
    const entries = Object.entries(value);
    const shape: Shape = { type: 'object', 'x-origin': 'inferred' };
    if (entries.length > 0) {
      shape.properties = Object.fromEntries(
        entries.map(([k, v]) => [
          k,
          widen(
            mappingShape(v, `${pointer}${ptr(k)}`, byPointer, env, depth + 1),
          ),
        ]),
      );
      shape.required = entries.map(([k]) => k);
    }
    return shape;
  }
  return shapeOfValue(value);
}

/** The root identifier a member chain hangs off: `out` in `out.a[0].b`. */
function rootName(node: Node): string | undefined {
  let n = node;
  while (n.type === 'MemberExpression' || n.type === 'ChainExpression') {
    n = n.type === 'MemberExpression' ? n.object : n.expression;
  }
  return n.type === 'Identifier' ? n.name : undefined;
}

/** Every name the code changes in place, anywhere in it. */
function mutatedNames(program: Node): Set<string> {
  const out = new Set<string>();
  const mark = (target: Node): void => {
    const name = rootName(target);
    if (name !== undefined) out.add(name);
  };
  walk<Node, null>(program, null, {
    _(node, { next }) {
      if (
        node.type === 'AssignmentExpression' &&
        node.left.type === 'MemberExpression'
      ) {
        mark(node.left);
      } else if (
        node.type === 'UpdateExpression' &&
        node.argument.type === 'MemberExpression'
      ) {
        mark(node.argument);
      } else if (
        node.type === 'UnaryExpression' &&
        node.operator === 'delete'
      ) {
        mark(node.argument);
      } else if (
        node.type === 'CallExpression' &&
        node.callee.type === 'MemberExpression' &&
        !node.callee.computed &&
        node.callee.property.type === 'Identifier'
      ) {
        const callee = node.callee;
        const name =
          callee.property.type === 'Identifier' ? callee.property.name : '';
        if (MUTATORS.has(name)) {
          mark(callee.object);
        } else if (
          callee.object.type === 'Identifier' &&
          callee.object.name === 'Object' &&
          (name === 'assign' || name.startsWith('define'))
        ) {
          const target = node.arguments[0];
          if (target !== undefined && target.type !== 'SpreadElement') {
            mark(target);
          }
        }
      }
      next();
    },
  });
  return out;
}

/** What a constant changed in place still is: a list stays a list and an
 * object an object, but what they hold is no longer known. */
function afterMutation(shape: Shape): Shape {
  const kinds = kindsOf(shape);
  if (kinds?.size === 1 && kinds.has('array')) {
    return { type: 'array', 'x-origin': 'inferred' };
  }
  if (kinds?.size === 1 && kinds.has('object')) {
    return {
      type: 'object',
      additionalProperties: true,
      'x-origin': 'inferred',
    };
  }
  return UNKNOWN;
}

function isNullish(node: Node): boolean {
  return (
    (node.type === 'Literal' && node.value === null && !('regex' in node)) ||
    (node.type === 'Identifier' && node.name === 'undefined') ||
    (node.type === 'UnaryExpression' && node.operator === 'void')
  );
}

/** The output a transform body returns, read from its `return` literals. */
function returnShape(program: Node, env: TypeEnv): Shape {
  if (program.type !== 'Program') return UNKNOWN;
  const { map, scope: root } = analyze(program);
  const mutated = mutatedNames(program);

  // The body's top-level names: a constant the code never changes in place
  // is its initializer; any other name only shadows.
  const top = new Map<string, Shape>();
  for (const name of root.declarations.keys()) top.set(name, UNKNOWN);
  for (const statement of program.body) {
    if (
      statement.type !== 'VariableDeclaration' ||
      statement.kind !== 'const'
    ) {
      continue;
    }
    for (const d of statement.declarations) {
      if (d.id.type !== 'Identifier' || !d.init) continue;
      const shape = typeOfExpression(d.init, { ...env, locals: top });
      top.set(d.id.name, mutated.has(d.id.name) ? afterMutation(shape) : shape);
    }
  }

  // Every `return` outside a nested function, with the names its blocks
  // declare.
  const returns: Array<{ node: ReturnStatement; path: Node[] }> = [];
  walk<Node, null>(program, null, {
    _(node, { next, path }) {
      if (
        node.type === 'FunctionDeclaration' ||
        node.type === 'FunctionExpression' ||
        node.type === 'ArrowFunctionExpression'
      ) {
        return;
      }
      if (node.type === 'ReturnStatement') {
        returns.push({ node, path: [...path] });
      }
      next();
    },
  });

  const typed: Array<{ arg: Node; shape: Shape }> = [];
  for (const r of returns) {
    const arg = r.node.argument;
    // Returning nothing fails the node ("transform code returned nothing"):
    // it is a failure, not an output.
    if (arg === null || arg === undefined || isNullish(arg)) continue;
    const locals = new Map(top);
    for (const ancestor of r.path) {
      const scope = map.get(ancestor);
      if (scope === undefined || scope === root) continue;
      for (const name of scope.declarations.keys()) locals.set(name, UNKNOWN);
    }
    typed.push({ arg, shape: typeOfExpression(arg, { ...env, locals }) });
  }
  if (typed.length === 0) return UNKNOWN;

  if (typed.every((t) => t.arg.type === 'ObjectExpression')) {
    if (typed.some((t) => isUnknown(t.shape))) return UNKNOWN;
    const values = new Map<string, Shape[]>();
    const counts = new Map<string, number>();
    for (const t of typed) {
      for (const [k, v] of Object.entries(t.shape.properties ?? {})) {
        values.set(k, [...(values.get(k) ?? []), v]);
        counts.set(k, (counts.get(k) ?? 0) + 1);
      }
    }
    const shape: Shape = { type: 'object', 'x-origin': 'inferred' };
    if (values.size > 0) {
      shape.properties = Object.fromEntries(
        [...values].map(([k, vs]) => [k, union(...vs)]),
      );
      const required = [...counts]
        .filter(([, n]) => n === typed.length)
        .map(([k]) => k);
      if (required.length > 0) shape.required = required;
    }
    return shape;
  }
  if (typed.length === 1 && typed[0].arg.type === 'ArrayExpression') {
    return typed[0].shape;
  }
  return UNKNOWN;
}

function retag(shape: Shape, origin: ShapeOrigin): Shape {
  if (isUnknown(shape) || shape.anyOf !== undefined) return shape;
  return { ...shape, 'x-origin': origin };
}

/** A stored child document, read as a document; null when it is not one. */
function asDocument(v: unknown): InferDocument | null {
  if (!isRecord(v) || !Array.isArray(v.nodes)) return null;
  const nodes = v.nodes.filter(
    (n: unknown) =>
      isRecord(n) && typeof n.id === 'string' && typeof n.type === 'string',
  );
  return {
    inputs: v.inputs,
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- every entry was checked to be a record with a string id and type; sourcesOf reads each other field defensively
    nodes: nodes as NodeDef[],
    output: v.output,
  };
}

interface Body {
  shape: Shape;
  origin: ShapeOrigin;
}

function childOutput(
  n: NodeDef,
  opts: InferOptions,
  stack: readonly string[],
): Body {
  const unknown: Body = { shape: UNKNOWN, origin: 'child' };
  if (typeof n.automation !== 'string') return unknown;
  const child = opts.children?.get(n.automation);
  if (child === undefined || child === null) return unknown;
  const key = `${child.name}@${child.version}`;
  if (stack.length >= MAX_SUBAUTOMATION_DEPTH || stack.includes(key)) {
    return unknown;
  }
  const doc = asDocument(child.automation);
  if (doc === null) return unknown;
  const types = inferDocument(doc, opts, [...stack, key]);
  return { shape: retag(types.output, 'child'), origin: 'child' };
}

function bodyOf(
  n: NodeDef,
  env: TypeEnv,
  sources: readonly ExprSource[],
  opts: InferOptions,
  stack: readonly string[],
): Body {
  switch (n.type) {
    case 'transform': {
      const unit = sources.find((s) => s.field === 'code')?.units[0];
      const shape =
        unit === undefined || !unit.parse.ok || unit.opaque
          ? UNKNOWN
          : returnShape(unit.parse.ast, env);
      return { shape, origin: 'inferred' };
    }
    case 'llm':
      return n.outputSchema === undefined
        ? { shape: LLM_TEXT, origin: 'fixed' }
        : { shape: normalizeSchema(n.outputSchema), origin: 'declared' };
    case 'agent':
      return { shape: AGENT_ENVELOPE, origin: 'fixed' };
    case 'subautomation':
      return childOutput(n, opts, stack);
    default: {
      const connector = nodeTypes().get(n.type)?.connector;
      return {
        shape:
          connector === undefined ? UNKNOWN : connectorOutputShape(connector),
        origin: 'signature',
      };
    }
  }
}

function inferNode(
  n: NodeDef,
  base: TypeEnv,
  opts: InferOptions,
  stack: readonly string[],
): NodeTypeInfo {
  const sources = sourcesOf(n, undefined, opts.parse);
  const byPointer = new Map(sources.map((s) => [s.pointer, s]));
  const iterates = typeof n.forEach === 'string';
  const info: Partial<NodeTypeInfo> = {};
  if (iterates) {
    const list = sources.find((s) => s.field === 'forEach');
    info.item =
      list === undefined ? UNKNOWN : elementOf(templateShape(list, base));
  }
  if (n.input !== undefined) {
    info.input = mappingShape(
      n.input,
      ptr('input'),
      byPointer,
      scoped(base, 'input', iterates, info),
    );
  }
  const body = bodyOf(
    n,
    scoped(base, 'code', iterates, info),
    sources,
    opts,
    stack,
  );
  const output: Shape = iterates
    ? isUnknown(body.shape)
      ? { type: 'array', 'x-origin': body.origin }
      : { type: 'array', items: body.shape, 'x-origin': body.origin }
    : body.shape;
  return {
    output,
    ...(info.item !== undefined && { item: info.item }),
    ...(info.input !== undefined && { input: info.input }),
    ts: toTs(output),
    origin: isUnknown(body.shape) ? 'unknown' : body.origin,
  };
}

function inferDocument(
  doc: InferDocument,
  opts: InferOptions,
  stack: readonly string[],
): AutomationTypes {
  const inputs = normalizeSchema(doc.inputs);
  const unique: NodeDef[] = [];
  const ids = new Set<string>();
  for (const n of doc.nodes) {
    // A node without an id is the node pass's finding; nothing reads it.
    if (!isRecord(n) || typeof n.id !== 'string' || ids.has(n.id)) continue;
    ids.add(n.id);
    unique.push(n);
  }
  const typed = new Map<string, NodeTypeInfo>();
  // A node read before it is typed (a forward reference, a cycle) is
  // unknown; an id the document does not have is no node at all.
  const nodes = (id: string): Shape | undefined =>
    typed.get(id)?.output ?? (ids.has(id) ? UNKNOWN : undefined);
  const base: TypeEnv = { input: inputs, nodes };
  for (const n of topoSort(unique) ?? unique) {
    typed.set(n.id, inferNode(n, base, opts, stack));
  }
  const output =
    doc.output === undefined
      ? NULL_SHAPE
      : mappingShape(
          doc.output,
          ptr('output'),
          new Map(
            outputSources(doc.output, opts.parse).map((s) => [s.pointer, s]),
          ),
          base,
        );
  return { inputs, nodes: Object.fromEntries(typed), output };
}

/** The shape of every node's output, the run input and the run's result. */
export function inferTypes(
  doc: InferDocument,
  opts: InferOptions = {},
): AutomationTypes {
  return inferDocument(doc, opts, []);
}
