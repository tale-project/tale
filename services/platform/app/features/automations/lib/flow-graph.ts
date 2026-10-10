/**
 * An automation document as the graph the canvas draws (`@tale/ui/flow`).
 *
 * A v1 document has no edge list: a node names the nodes it needs by
 * writing `{{ nodes.<id>.output }}` in its own fields, and the engine orders
 * the run from exactly those references (`refsOf`, `topoSort`). The graph is
 * built the same way, so what the canvas draws is what the engine runs:
 *
 *  - **Start** says what starts a run and what it receives; **End** what a
 *    successful run returns and how a run can end;
 *  - a node's `when` is a **condition** of its own, drawn just above the
 *    node, in words when it reads as words; an `elseOf` partner hangs from
 *    the same condition as its **No** (else-if chains read left to right);
 *  - a line is **data** when the node reads the other's output (a skip
 *    travels along it), **order** when only a condition or a repeat
 *    mentions it;
 *  - a node that iterates (`forEach`, `repeatUntil`) sits in a **frame**;
 *  - nodes nothing reads end the run (a dotted line to End), nodes the
 *    output reads lead to End.
 *
 * Positions are never read: the canvas lays itself out from this graph, so
 * a document's `ui` metadata changes nothing here.
 */

import type {
  FlowEdge,
  FlowEdgeKind,
  FlowEntryNode,
  FlowExitNode,
  FlowGateNode,
  FlowGraph,
  FlowGroup,
  FlowNode,
  FlowNotice,
  FlowRow,
  FlowStepNode,
} from '@tale/ui/flow/types';
import { schemaKindLabel, type SchemaTreeSchema } from '@tale/ui/schema-tree';
import type { TFunction } from 'i18next';
import { Ban, CircleCheck, CircleX } from 'lucide-react';

import type { FlowFacts } from '@/lib/engine/core/analysis/flow';
import { maxRepeatsOf } from '@/lib/engine/core/execute/controlflow';
import {
  outputSources,
  refSitesOf,
  type ExprSource,
} from '@/lib/engine/core/syntax/sources';
import {
  exprSegments,
  tokenizeTemplate,
} from '@/lib/engine/core/syntax/tokens';
import { renderPath } from '@/lib/engine/core/syntax/walk';
import type { Automation, NodeDef } from '@/lib/engine/core/types';
import { isUnknown, toTs, type Shape } from '@/lib/engine/core/typing/shape';

import {
  describeCondition,
  describeList,
  renderCondition,
  renderOperand,
  type ConditionTextContext,
  type ConditionTranslate,
} from './condition-text';
import { END_ID, START_ID, decisionKeyOf, gateIdOf } from './flow-ids';
import { orderedNodes } from './graph';
import { nodeFace, nodeTitle, type NodeFaceContext } from './node-face';
import { TRIGGER_WRAPPER_KEYS } from './trigger-summary';

/** At most this many names in a "Carries …" or "run input (…)" list. */
const LIST_LIMIT = 3;

export interface FlowGraphContext extends NodeFaceContext {
  /** The `schemaTree` namespace, for the kind of each input field. */
  tSchema: TFunction;
  /** Start's trigger rows (`triggerRows`). */
  triggers: readonly FlowRow[];
  /** The local flow analysis; null on a reference cycle. */
  flow: FlowFacts | null;
  /** The shape of the run's result, when the check worked it out. */
  outputShape?: Shape | null;
  /** The cause of a trigger whose input the schema refuses, shown on
   *  Start. */
  startNotice?: string | null;
  /** The nodes that run on a pinned path: End says which outputs come
   *  back empty on it. */
  ranOnPath?: ReadonlySet<string> | null;
}

export interface AutomationFlowGraph {
  graph: FlowGraph;
  /** The references form a cycle: the order is the document's, and no
   *  path can be listed. */
  hasCycle: boolean;
  /** Each node's position in `doc.nodes` (first occurrence of an id). */
  nodeIndex: ReadonlyMap<string, number>;
  /** Node ids in execution order. */
  order: readonly string[];
}

/** `a, b, c, +2`: names are data, so no locale list words. */
function shortList(items: readonly string[]): string {
  const shown = items.slice(0, LIST_LIMIT);
  const rest = items.length - shown.length;
  return rest > 0 ? `${shown.join(', ')}, +${rest}` : shown.join(', ');
}

/** What a node reads, by the field it reads it in. */
interface NodeReads {
  /** Data reads of other nodes, with the member paths read. */
  data: Map<string, Set<string>>;
  /** Nodes its `when` reads. */
  when: Set<string>;
  /** Nodes its `repeatUntil` reads. */
  repeat: Set<string>;
  /** Top-level keys of the run input it reads (`null`: the whole of it). */
  inputKeys: Set<string> | null;
  readsInput: boolean;
  readsItem: boolean;
}

function readsOf(
  node: NodeDef,
  index: number,
  known: ReadonlySet<string>,
): NodeReads {
  const reads: NodeReads = {
    data: new Map(),
    when: new Set(),
    repeat: new Set(),
    inputKeys: new Set(),
    readsInput: false,
    readsItem: false,
  };
  for (const { source, site } of refSitesOf(node, index)) {
    if (site.root === 'nodes') {
      const id = site.nodeId;
      if (id === undefined || id === node.id || !known.has(id)) continue;
      if (source.field === 'when') reads.when.add(id);
      else if (source.field === 'repeatUntil') reads.repeat.add(id);
      else if (source.data) {
        const paths = reads.data.get(id) ?? new Set<string>();
        if (site.member === 'output' && site.path.length > 0) {
          paths.add(renderPath(site.path));
        }
        reads.data.set(id, paths);
      }
      continue;
    }
    if (!source.data) continue;
    // A transform's code reads its own input mapping as `input`, not the
    // run input.
    if (site.root === 'input' && source.field !== 'code') {
      reads.readsInput = true;
      const key = site.path[0]?.key;
      if (typeof key === 'string') reads.inputKeys?.add(key);
      else reads.inputKeys = null;
    } else if (site.root === 'item') {
      reads.readsItem = true;
    }
  }
  return reads;
}

/** The node ids an `output` template reads, in reading order, by the
 *  top-level output field they sit in (`''` for a whole-value output). */
function outputReadsOf(
  output: unknown,
  known: ReadonlySet<string>,
): { all: string[]; byField: Map<string, string[]> } {
  const all: string[] = [];
  const byField = new Map<string, string[]>();
  for (const source of outputSources(output)) {
    const field = fieldOf(source);
    for (const unit of source.units) {
      for (const site of unit.refs) {
        const id = site.nodeId;
        if (site.root !== 'nodes' || id === undefined || !known.has(id)) {
          continue;
        }
        if (!all.includes(id)) all.push(id);
        const list = byField.get(field) ?? [];
        if (!list.includes(id)) list.push(id);
        byField.set(field, list);
      }
    }
  }
  return { all, byField };
}

/** The nodes the document's `output` reads, in reading order: what End
 *  returns comes from them. */
export function outputReaders(doc: Automation): string[] {
  const known = new Set(doc.nodes.map((node) => node.id));
  return outputReadsOf(doc.output, known).all;
}

/** The top-level output field a source sits in: `/output/summary/…` →
 *  `summary`; the whole output → `''`. */
function fieldOf(source: ExprSource): string {
  const [, , field] = source.pointer.split('/');
  return field === undefined
    ? ''
    : field.replaceAll('~1', '/').replaceAll('~0', '~');
}

/** The expression a code condition shows: the one inside its braces, or
 *  the field as written. */
function conditionCode(text: string): string {
  const segments = exprSegments(tokenizeTemplate(text));
  const [only] = segments;
  if (segments.length === 1 && only?.source !== undefined) {
    if (text.trim() === text.slice(only.start, only.end).trim()) {
      return only.source;
    }
  }
  return text.trim();
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A JSON Schema as the schema tree reads it; anything else reads as
 *  "anything". */
function asSchema(value: unknown): SchemaTreeSchema {
  // An author's JSON Schema: the kind words read only the fields they know
  // and ignore the rest.
  return isRecord(value) ? value : {};
}

/** Start: the triggers, then what every run receives. */
function startNode(doc: Automation, ctx: FlowGraphContext): FlowEntryNode {
  const { t } = ctx;
  const inputs: FlowRow[] = [];
  let inputsEmpty: string | undefined;
  const schema = doc.inputs;
  if (!isRecord(schema)) {
    inputsEmpty = t('canvas.start.anyInput');
  } else {
    const properties = isRecord(schema.properties) ? schema.properties : {};
    const required = new Set(
      Array.isArray(schema.required)
        ? schema.required.filter((key) => typeof key === 'string')
        : [],
    );
    for (const [name, field] of Object.entries(properties)) {
      const words = [schemaKindLabel(ctx.tSchema, asSchema(field), ctx.locale)];
      if (required.has(name)) words.push(ctx.tSchema('required'));
      if (TRIGGER_WRAPPER_KEYS.has(name)) {
        words.push(t('canvas.start.fromTrigger'));
      }
      inputs.push({
        id: `input:${name}`,
        label: name,
        detail: words.join(' · '),
        code: true,
      });
    }
    if (inputs.length === 0) inputsEmpty = t('canvas.start.noFields');
  }
  const list = (items: string[]) =>
    new Intl.ListFormat(ctx.locale, { type: 'conjunction' }).format(items);
  const notice: FlowNotice | undefined =
    ctx.startNotice === undefined ||
    ctx.startNotice === null ||
    ctx.startNotice === ''
      ? undefined
      : { tone: 'warning', text: ctx.startNotice };
  return {
    id: START_ID,
    kind: 'entry',
    triggers: ctx.triggers,
    inputs,
    ...(inputsEmpty !== undefined && { inputsEmpty }),
    ...(notice !== undefined && { notice }),
    description: t('canvas.start.description', {
      triggers: list(ctx.triggers.map((row) => row.label)),
      fields:
        inputs.length > 0
          ? list(inputs.map((row) => row.label))
          : (inputsEmpty ?? ''),
    }),
  };
}

/** The three ways a run ends, as End and its inspector say them:
 *  `halts` is how many nodes stop the run when they fail. */
export function endOutcomes(t: ConditionTranslate, halts: number): FlowRow[] {
  return [
    {
      id: 'succeeded',
      icon: CircleCheck,
      label: t('runs.status.success'),
      detail: t('canvas.end.succeeded'),
    },
    {
      id: 'failed',
      icon: CircleX,
      label: t('runs.status.failed'),
      detail: t('canvas.end.failed', { count: halts }),
    },
    {
      id: 'stopped',
      icon: Ban,
      label: t('runs.status.cancelled'),
      detail: t('canvas.end.stopped'),
    },
  ];
}

/** End: what a successful run returns, and the three ways a run ends. */
function endNode(
  doc: Automation,
  ctx: FlowGraphContext,
  outputReads: { all: string[]; byField: Map<string, string[]> },
  words: ConditionTextContext,
): FlowExitNode {
  const { t, flow } = ctx;
  const mayBeSkipped = (id: string) => flow !== null && !flow.reach(id).always;
  const emptyOnPath = (sources: readonly string[]) =>
    ctx.ranOnPath !== undefined &&
    ctx.ranOnPath !== null &&
    sources.some((id) => !ctx.ranOnPath?.has(id));
  const outputs: FlowRow[] = [];
  let someEmpty = false;
  const output = doc.output;
  if (typeof output === 'string') {
    const sources = outputReads.byField.get('') ?? [];
    const operand = describeList(output);
    const label =
      operand?.kind === 'ref' &&
      operand.root === 'node' &&
      operand.path.length === 0 &&
      operand.length !== true
        ? t('canvas.end.returnsNode', {
            node: nodeTitle(operand.nodeId ?? ''),
          })
        : operand !== null
          ? renderOperand(operand, words)
          : null;
    someEmpty = sources.some(mayBeSkipped);
    outputs.push({
      id: 'output',
      label: label ?? output,
      ...(label === null && { code: true }),
      ...(emptyOnPath(sources) && { detail: t('canvas.end.emptyOnPath') }),
    });
  } else if (isRecord(output)) {
    const properties = isRecord(ctx.outputShape?.properties)
      ? ctx.outputShape.properties
      : undefined;
    for (const key of Object.keys(output)) {
      const sources = outputReads.byField.get(key) ?? [];
      const detail: string[] = [];
      const shape = properties?.[key];
      if (shape !== undefined && !isUnknown(shape)) {
        detail.push(schemaKindLabel(ctx.tSchema, asSchema(shape), ctx.locale));
      }
      if (sources.length > 0) {
        detail.push(
          t('canvas.end.fieldFrom', {
            nodes: new Intl.ListFormat(ctx.locale, {
              type: 'conjunction',
            }).format(sources.map(nodeTitle)),
          }),
        );
      }
      if (sources.some(mayBeSkipped)) {
        someEmpty = true;
        detail.push(t('canvas.end.maybeEmpty'));
      }
      if (emptyOnPath(sources)) detail.push(t('canvas.end.emptyOnPath'));
      outputs.push({
        id: `output:${key}`,
        label: key,
        code: true,
        ...(detail.length > 0 && { detail: detail.join(' · ') }),
      });
    }
  } else if (output !== undefined) {
    outputs.push({ id: 'output', label: JSON.stringify(output), code: true });
  }
  // End holds a row for the shape of what a run returns whenever the check
  // may work it out, so the box never grows when the check answers: the
  // shape once known, a placeholder while the check runs, words when it
  // could not tell.
  const known =
    ctx.outputShape !== undefined &&
    ctx.outputShape !== null &&
    !isUnknown(ctx.outputShape)
      ? toTs(ctx.outputShape, 2)
      : undefined;
  const shape: FlowExitNode['shape'] =
    known ??
    (ctx.returns.status === 'off' || outputs.length === 0
      ? undefined
      : ctx.returns.status === 'pending'
        ? null
        : { text: t('canvas.node.returnsUnknown'), code: false });
  return {
    id: END_ID,
    kind: 'exit',
    outputs,
    ...(outputs.length === 0 && {
      outputsEmpty: t('canvas.end.returnsNothing'),
    }),
    ...(shape !== undefined && { shape }),
    outcomes: endOutcomes(t, flow?.halts.length ?? 0),
    ...(someEmpty && {
      notice: { tone: 'info', text: t('canvas.end.someEmpty') },
    }),
  };
}

/** The words of a node's frame: what it iterates, or until when. */
function frameLabel(node: NodeDef, words: ConditionTextContext): string | null {
  const { t } = words;
  const parts: string[] = [];
  if (typeof node.forEach === 'string') {
    const list = describeList(node.forEach);
    parts.push(
      list === null
        ? t('canvas.controlFlow.forEachRaw')
        : t('canvas.controlFlow.forEach', {
            list: renderOperand(list, words),
          }),
    );
  }
  if (typeof node.repeatUntil === 'string') {
    const condition = renderCondition(
      describeCondition(node.repeatUntil),
      words,
    );
    const maxRepeats = maxRepeatsOf(node);
    parts.push(
      condition === null
        ? t('canvas.controlFlow.repeatRaw', { maxRepeats })
        : t('canvas.controlFlow.repeatUntilCapped', { condition, maxRepeats }),
    );
  }
  return parts.length === 0 ? null : parts.join(' · ');
}

/**
 * The graph of one document. Pure: the same document and context always
 * give the same graph, edge for edge, in the same order.
 */
export function toFlowGraph(
  doc: Automation,
  ctx: FlowGraphContext,
): AutomationFlowGraph {
  const { t, flow } = ctx;
  const words: ConditionTextContext = {
    t,
    locale: ctx.locale,
    nodeLabel: nodeTitle,
  };

  // Every node once (a repeated id keeps its first occurrence, as both
  // executors do), in execution order — document order on a cycle.
  const nodeIndex = new Map<string, number>();
  const unique: NodeDef[] = [];
  doc.nodes.forEach((node, index) => {
    if (typeof node.id !== 'string' || nodeIndex.has(node.id)) return;
    if (typeof node.type !== 'string' || node.type === '') return;
    nodeIndex.set(node.id, index);
    unique.push(node);
  });
  const { nodes: ordered, hasCycle } = orderedNodes(unique);
  const known: ReadonlySet<string> = new Set(nodeIndex.keys());
  const byId = new Map(ordered.map((node) => [node.id, node]));
  const reads = new Map(
    ordered.map((node) => [
      node.id,
      readsOf(node, nodeIndex.get(node.id) ?? 0, known),
    ]),
  );

  // An elseOf partner hangs from its node's condition as the No — unless
  // the pairing cannot hold: a cycle, a node without a condition, or a
  // partner that reads the node's own output (the analysis explains why
  // that partner never runs).
  const partners = new Map<string, string[]>();
  const paired = new Set<string>();
  for (const node of ordered) {
    const target = node.elseOf;
    if (typeof target !== 'string' || target === node.id) continue;
    const of = byId.get(target);
    if (of === undefined || hasCycle || typeof of.when !== 'string') continue;
    if (reads.get(node.id)?.data.has(target)) continue;
    paired.add(node.id);
    partners.set(target, [...(partners.get(target) ?? []), node.id]);
  }

  // ── Nodes, in model order: Start, each condition right before its node,
  // End. ─────────────────────────────────────────────────────────────────
  const graphNodes: FlowNode[] = [startNode(doc, ctx)];
  const groups: FlowGroup[] = [];
  for (const node of ordered) {
    const own = reads.get(node.id);
    if (typeof node.when === 'string') {
      const condition = renderCondition(describeCondition(node.when), words);
      const gate: FlowGateNode = {
        id: gateIdOf(node.id),
        kind: 'gate',
        label: nodeTitle(node.id),
        mode: partners.has(node.id) ? 'if-else' : 'only-if',
        condition: condition ?? conditionCode(node.when),
        ...(condition === null && {
          conditionIsCode: true,
          description: t('canvas.gate.asCode'),
        }),
        decisionKey: decisionKeyOf(node.id),
      };
      graphNodes.push(gate);
    }
    const face = nodeFace(node, ctx);
    const rows: FlowRow[] = [];
    if (own !== undefined) {
      for (const id of ordered.map((candidate) => candidate.id)) {
        if (own.data.has(id)) rows.push({ id, label: nodeTitle(id) });
      }
      if (own.readsInput) {
        const keys = own.inputKeys === null ? [] : [...own.inputKeys];
        rows.push({
          id: 'input',
          label:
            keys.length > 0
              ? t('canvas.node.source.input', { keys: shortList(keys) })
              : t('canvas.node.source.inputAll'),
        });
      }
      if (own.readsItem) {
        rows.push({ id: 'item', label: t('canvas.node.source.item') });
      }
    }
    const frame = frameLabel(node, words);
    if (frame !== null) {
      groups.push({
        id: `${typeof node.forEach === 'string' ? 'each' : 'repeat'}:${node.id}`,
        kind: typeof node.forEach === 'string' ? 'each' : 'repeat',
        label: frame,
        members: [node.id],
      });
    }
    const reach = flow?.reach(node.id);
    const sentences = [...(frame === null ? [] : [frame]), ...face.sentences];
    const step: FlowStepNode = {
      id: node.id,
      kind: 'step',
      label: face.label,
      icon: face.icon,
      typeLabel: face.typeLabel,
      reads: rows,
      readsEmpty: t('canvas.readsNothing'),
      ...(face.returns !== undefined && { returns: face.returns }),
      ...(face.chips.length > 0 && { chips: face.chips }),
      ...(face.markers.length > 0 && { markers: face.markers }),
      ...(reach !== undefined && !reach.always && { conditional: true }),
      ...(reach !== undefined && !reach.executed && { unreachable: true }),
      ...(sentences.length > 0 && { description: sentences.join('. ') }),
    };
    graphNodes.push(step);
  }

  const outputReads = outputReadsOf(doc.output, known);
  graphNodes.push(endNode(doc, ctx, outputReads, words));

  // ── Edges ──────────────────────────────────────────────────────────────
  const edges = new Map<string, FlowEdge>();
  const add = (
    source: string,
    target: string,
    kind: FlowEdgeKind,
    extra: Partial<FlowEdge> = {},
  ): void => {
    const id = `${source}>${target}`;
    const existing = edges.get(id);
    // One line per pair: a drawn line wins over a layout-only one, a data
    // line over an order line.
    if (existing !== undefined) {
      if (existing.layoutOnly === true && extra.layoutOnly !== true) {
        edges.set(id, { id, source, target, kind, ...extra });
      } else if (existing.kind === 'order' && kind === 'data') {
        edges.set(id, { id, source, target, kind, ...extra });
      }
      return;
    }
    edges.set(id, { id, source, target, kind, ...extra });
  };

  for (const node of ordered) {
    const own = reads.get(node.id);
    if (own === undefined) continue;
    for (const [source, paths] of own.data) {
      const fields = [...paths];
      add(source, node.id, 'data', {
        ...(fields.length > 0 && {
          detail: t('canvas.edge.carries', { fields: shortList(fields) }),
        }),
      });
    }
    if (typeof node.when === 'string') {
      const gate = gateIdOf(node.id);
      for (const source of own.when) add(source, gate, 'order');
      if (own.when.size === 0) {
        // A condition that reads no node hangs right above its node: from
        // what the node reads, without a line of its own.
        for (const source of own.data.keys()) {
          add(source, gate, 'order', { layoutOnly: true });
        }
      }
      const others = partners.get(node.id);
      add(gate, node.id, others === undefined ? 'gate' : 'branch-yes');
      for (const partner of others ?? []) {
        const target = byId.get(partner);
        add(
          gate,
          typeof target?.when === 'string' ? gateIdOf(partner) : partner,
          'branch-no',
        );
      }
    }
    for (const source of own.repeat) {
      if (!own.data.has(source)) add(source, node.id, 'order');
    }
    const target = node.elseOf;
    if (
      typeof target === 'string' &&
      target !== node.id &&
      known.has(target) &&
      !paired.has(node.id) &&
      !own.data.has(target)
    ) {
      add(target, node.id, 'order');
    }
  }

  // Whatever nothing leads into starts from Start; on a cycle with no
  // such node, the first one written does.
  const incoming = new Set([...edges.values()].map((edge) => edge.target));
  const heads: string[] = [];
  for (const node of ordered) {
    const head = typeof node.when === 'string' ? gateIdOf(node.id) : node.id;
    if (!incoming.has(head)) heads.push(head);
    if (head !== node.id && !incoming.has(node.id)) heads.push(node.id);
  }
  if (heads.length === 0 && ordered.length > 0) {
    const first = unique[0];
    if (first !== undefined) {
      heads.push(
        typeof first.when === 'string' ? gateIdOf(first.id) : first.id,
      );
    }
  }
  for (const head of heads) add(START_ID, head, 'entry');

  // What the output reads leads to End; every other node nothing reads
  // ends the run there.
  const outgoing = new Set(
    [...edges.values()]
      .filter((edge) => edge.layoutOnly !== true)
      .map((edge) => edge.source),
  );
  for (const id of outputReads.all) add(id, END_ID, 'exit');
  for (const node of ordered) {
    if (!outgoing.has(node.id) && !outputReads.all.includes(node.id)) {
      add(node.id, END_ID, 'completion');
    }
  }
  if (
    ordered.length > 0 &&
    ![...edges.values()].some((e) => e.target === END_ID)
  ) {
    const last = ordered.at(-1);
    if (last !== undefined) add(last.id, END_ID, 'completion');
  }

  const position = new Map(graphNodes.map((node, index) => [node.id, index]));
  const sortedEdges = [...edges.values()].sort(
    (a, b) =>
      (position.get(a.target) ?? 0) - (position.get(b.target) ?? 0) ||
      (position.get(a.source) ?? 0) - (position.get(b.source) ?? 0),
  );

  return {
    graph: {
      nodes: graphNodes,
      edges: sortedEdges,
      ...(groups.length > 0 && { groups }),
    },
    hasCycle,
    nodeIndex,
    order: ordered.map((node) => node.id),
  };
}
