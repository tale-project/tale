/**
 * What the code editor offers inside an automation's fields: the names a
 * field can read (`input`, `nodes`, `item`, …), the nodes it may reference,
 * and the fields of each value as the draft check worked them out, with
 * their kinds — while typing (completion) and on hover.
 *
 * Pure over the document, the check's inferred shapes and the engine's own
 * scope rules (`scopeNamesFor`), so it answers the same in a test as in the
 * editor, and a field never offers a name its runtime would not have.
 *
 * `nodes.` offers only the nodes that run before this one: a reference to
 * itself or to a node that reads it would close a circle the engine refuses.
 */

import type {
  CodeCompletionContext,
  CodeCompletionItem,
  CodeCompletionKind,
  CodeCompletionResult,
  CodeEditorProviders,
  CodeHoverContext,
  CodeHoverInfo,
  CodePathSegment,
  CodeValueType,
} from '@tale/ui/code-editor/providers';

import {
  scopeNamesFor,
  type SourceField,
} from '@/lib/engine/core/syntax/globals';
import type { Automation, NodeDef } from '@/lib/engine/core/types';
import {
  elementOf,
  isUnknown,
  kindsOf,
  lookup,
  NUMBER_SHAPE,
  toTs,
  UNKNOWN,
  type Shape,
} from '@/lib/engine/core/typing/shape';
import type { TypesView } from '@/lib/shared/schemas/automation-issues';

import { orderedNodes } from './graph';
import { nodeTitle } from './node-face';

/** Where the editor is: one field of one node, or the document's output. */
export interface CodeAssistScope {
  /** The document on screen (its reading view). */
  doc: Automation;
  /** The node whose field this is; absent for the document's `output`. */
  node?: NodeDef;
  field: SourceField;
  /** The draft check's inferred shapes; null until it answered. */
  types: TypesView | null;
  /** What a node returned in the run laid over the canvas. */
  sampleOf?: (nodeId: string) => unknown;
}

/** The longest sample a tooltip shows. */
const SAMPLE_LENGTH = 80;

const IDENTIFIER = /^[A-Za-z_$][\w$]*$/;

/** The kind a value of this shape has, for the icon beside its name. */
function valueTypeOf(shape: Shape): CodeValueType {
  if (shape.type === 'integer') return 'integer';
  const kinds = kindsOf(shape);
  if (kinds === null || kinds.size !== 1) return 'unknown';
  const [kind] = kinds;
  return kind ?? 'unknown';
}

/**
 * The nodes a field of `node` may reference: those that run before it, in
 * the order they run (document order when the references form a circle).
 * The document's output may read every node.
 */
export function referableNodes(
  doc: Automation,
  node: NodeDef | undefined,
): NodeDef[] {
  const drawn = doc.nodes.filter((candidate) => candidate.type !== '');
  const { nodes: order } = orderedNodes(drawn);
  if (node === undefined) return order;
  const at = order.findIndex((candidate) => candidate.id === node.id);
  return at === -1 ? [] : order.slice(0, at);
}

function nodeOutput(scope: CodeAssistScope, id: string): Shape | undefined {
  const types = scope.types;
  if (types === null || !Object.hasOwn(types.nodes, id)) return undefined;
  return types.nodes[id]?.output;
}

/** The names this field can read, in the engine's own words. */
function rootsOf(scope: CodeAssistScope): ReadonlySet<string> {
  return scopeNamesFor(scope.field, scope.node);
}

/** The shape of a scope name other than `nodes`; undefined when unknown. */
function rootShape(scope: CodeAssistScope, root: string): Shape | undefined {
  const { types, node, field } = scope;
  if (root === 'index') return NUMBER_SHAPE;
  if (types === null) return undefined;
  const info =
    node !== undefined && Object.hasOwn(types.nodes, node.id)
      ? types.nodes[node.id]
      : undefined;
  switch (root) {
    case 'input':
      // Transform code reads its own input mapping as `input`.
      return field === 'code' ? (info?.input ?? UNKNOWN) : types.inputs;
    case 'item':
      return info?.item ?? UNKNOWN;
    case 'output': {
      const out = info?.output ?? UNKNOWN;
      return typeof node?.forEach === 'string' ? elementOf(out) : out;
    }
    default:
      return undefined;
  }
}

/** Follow member steps from `shape`; undefined where a step is unknown. */
function walk(
  shape: Shape,
  steps: readonly CodePathSegment[],
): { shape: Shape; optional: boolean } | undefined {
  let current = shape;
  let optional = false;
  for (const step of steps) {
    const found = lookup(current, step);
    if (found.kind !== 'found') return undefined;
    current = found.shape;
    optional ||= found.optional;
  }
  return { shape: current, optional };
}

/** The value a path names in a node's recorded output, shortened. */
function sampleAt(
  scope: CodeAssistScope,
  nodeId: string,
  steps: readonly CodePathSegment[],
): string | undefined {
  if (scope.sampleOf === undefined) return undefined;
  let value: unknown = scope.sampleOf(nodeId);
  for (const step of steps) {
    if (value === null || typeof value !== 'object') return undefined;
    value = Reflect.get(value, step);
  }
  if (value === undefined) return undefined;
  let text: string;
  try {
    text = JSON.stringify(value);
  } catch (error) {
    console.warn('[automations] a recorded value is not serialisable', error);
    return undefined;
  }
  return text.length <= SAMPLE_LENGTH
    ? text
    : `${text.slice(0, SAMPLE_LENGTH - 1)}…`;
}

/** The members a value of this shape has, each with its kind. */
function membersOf(
  shape: Shape,
  sample?: (key: string) => string | undefined,
): CodeCompletionItem[] {
  if (isUnknown(shape)) return [];
  const keys = new Set<string>();
  for (const member of shape.anyOf ?? [shape]) {
    for (const key of Object.keys(member.properties ?? {})) keys.add(key);
  }
  const kinds = kindsOf(shape);
  if (
    kinds !== null &&
    (kinds.has('array') || kinds.has('string')) &&
    !kinds.has('object')
  ) {
    keys.add('length');
  }
  const items: CodeCompletionItem[] = [];
  for (const key of keys) {
    const found = lookup(shape, key);
    if (found.kind !== 'found') continue;
    const example = sample?.(key);
    items.push({
      label: key,
      kind: 'property',
      valueType: valueTypeOf(found.shape),
      detail: toTs(found.shape, 1),
      optional: found.optional,
      info: {
        type: toTs(found.shape),
        ...(found.shape.description !== undefined && {
          description: found.shape.description,
        }),
        ...(example !== undefined && { sample: example }),
      },
    });
  }
  return items;
}

const ROOT_KIND: Readonly<Record<string, CodeCompletionKind>> = {
  input: 'input',
  nodes: 'variable',
  item: 'variable',
  index: 'variable',
  output: 'variable',
};

function rootItems(scope: CodeAssistScope): CodeCompletionItem[] {
  return [...rootsOf(scope)].map((root) => {
    const shape = rootShape(scope, root);
    const item: CodeCompletionItem = {
      label: root,
      kind: ROOT_KIND[root] ?? 'variable',
    };
    if (shape !== undefined) {
      item.valueType = valueTypeOf(shape);
      item.detail = toTs(shape, 1);
      item.info = { type: toTs(shape) };
    }
    return item;
  });
}

function nodeItems(scope: CodeAssistScope): CodeCompletionItem[] {
  return referableNodes(scope.doc, scope.node).map((candidate) => {
    const output = nodeOutput(scope, candidate.id);
    const item: CodeCompletionItem = {
      label: candidate.id,
      kind: 'node',
      detail: nodeTitle(candidate.id),
    };
    if (output !== undefined) item.info = { type: toTs(output) };
    return item;
  });
}

function referable(scope: CodeAssistScope, id: string): boolean {
  return referableNodes(scope.doc, scope.node).some(
    (candidate) => candidate.id === id,
  );
}

/** What can come next at the cursor in one field. */
export function automationCompletion(
  scope: CodeAssistScope,
  context: Pick<CodeCompletionContext, 'region' | 'path'>,
): CodeCompletionResult {
  if (context.region !== 'code' && context.region !== 'template') return null;
  const path = context.path;
  if (path === null) return null;
  if (path.length === 0) return { items: rootItems(scope) };
  const [root, ...rest] = path;
  if (typeof root !== 'string' || !rootsOf(scope).has(root)) return null;
  if (root === 'nodes') {
    if (rest.length === 0) return { items: nodeItems(scope) };
    const [id, member, ...steps] = rest;
    if (typeof id !== 'string' || !referable(scope, id)) return null;
    const output = nodeOutput(scope, id) ?? UNKNOWN;
    // A node is read through its `output` and nothing else.
    if (member === undefined) {
      return {
        items: [
          {
            label: 'output',
            kind: 'property',
            valueType: valueTypeOf(output),
            detail: toTs(output, 1),
            info: { type: toTs(output) },
          },
        ],
      };
    }
    if (member !== 'output') return null;
    const walked = walk(output, steps);
    if (walked === undefined) return null;
    return {
      items: membersOf(walked.shape, (key) =>
        sampleAt(scope, id, [...steps, key]),
      ),
    };
  }
  const base = rootShape(scope, root);
  if (base === undefined) return null;
  const walked = walk(base, rest);
  if (walked === undefined) return null;
  return { items: membersOf(walked.shape) };
}

/** `nodes.score.output.items[0]["a b"]` */
function pathText(path: readonly CodePathSegment[]): string {
  return path
    .map((segment, index) => {
      if (typeof segment === 'number') return `[${segment}]`;
      if (IDENTIFIER.test(segment)) {
        return index === 0 ? segment : `.${segment}`;
      }
      return `[${JSON.stringify(segment)}]`;
    })
    .join('');
}

/** What the name under the pointer holds, as a type. */
export function automationHover(
  scope: CodeAssistScope,
  context: Pick<CodeHoverContext, 'region' | 'path'>,
): CodeHoverInfo | null {
  if (context.region !== 'code' && context.region !== 'template') return null;
  const path = context.path;
  if (path === null || path.length === 0) return null;
  const [root, ...rest] = path;
  if (typeof root !== 'string' || !rootsOf(scope).has(root)) return null;
  const title = pathText(path);
  if (root === 'nodes') {
    const [id, member, ...steps] = rest;
    if (typeof id !== 'string') return null;
    const output = nodeOutput(scope, id);
    if (output === undefined) return null;
    if (member === undefined) {
      return { title: nodeTitle(id), type: `{ output: ${toTs(output, 2)} }` };
    }
    if (member !== 'output') return null;
    const walked = walk(output, steps);
    if (walked === undefined) return null;
    const sample = sampleAt(scope, id, steps);
    return {
      title,
      type: toTs(walked.shape),
      ...(walked.shape.description !== undefined && {
        description: walked.shape.description,
      }),
      ...(sample !== undefined && { sample }),
    };
  }
  const base = rootShape(scope, root);
  if (base === undefined) return null;
  const walked = walk(base, rest);
  if (walked === undefined) return null;
  return {
    title,
    type: toTs(walked.shape),
    ...(walked.shape.description !== undefined && {
      description: walked.shape.description,
    }),
  };
}

/** The completion and hover providers for one field. */
export function automationProviders(
  scope: CodeAssistScope,
): CodeEditorProviders {
  return {
    completion: (context) => automationCompletion(scope, context),
    hover: (context) => automationHover(scope, context),
  };
}
