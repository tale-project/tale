import type { ChangeKind } from '../../data-display/change-list';
import type { FlowHighlight } from '../paths/highlight';
import type { FlowEdge, FlowGraph, FlowGroup, FlowNode } from '../types';
import { flowGraphProblems } from '../validate-graph';

/**
 * Two versions of a workflow on one chart. `mergeFlowGraphs` draws the
 * union of the two graphs — every node of the newer one, and the nodes only
 * the older one had where they stood — and says what each part became:
 * added, removed, changed or renamed. The canvas and its List view draw
 * that overlay (`diff`); `diffHighlight` brings what changed forward on
 * either version's own graph. Pure: no React, no layout.
 */

/** What happened to a node between the two versions. */
export type FlowDiffKind = ChangeKind;

export interface FlowNodeDiff {
  kind: FlowDiffKind;
  /** The change in the host's words, for the box's foot and its
   *  description: "Prompt and model changed". */
  summary?: string;
  /** A renamed node's name before, in the host's words: "Summary". */
  renamedFrom?: string;
  /**
   * A renamed node's id in the older graph. The union draws one box for
   * the two, and that older id's lines as this node's.
   */
  beforeId?: string;
}

export interface FlowDiffOverlay {
  /** By node id in the union graph; a node not listed is unchanged. */
  nodes: Readonly<Record<string, FlowNodeDiff>>;
  /** By edge id: a line only one version draws. */
  edges: Readonly<Record<string, 'added' | 'removed'>>;
  /** By group id: a frame only one version draws. */
  groups?: Readonly<Record<string, 'added' | 'removed'>>;
}

/** The id the union gives an older line whose id the newer graph uses for
 *  another line. */
export const flowBeforeEdgeId = (id: string) => `${id}~before`;

/** The lines only a condition draws. */
const GATE_EDGES: ReadonlySet<FlowEdge['kind']> = new Set([
  'gate',
  'branch-yes',
  'branch-no',
]);

/** A line's identity across versions: its ends and its kind. */
const edgeKey = (source: string, target: string, kind: FlowEdge['kind']) =>
  `${source}\u0000${target}\u0000${kind}`;

/** A frame's identity across versions: its members. */
const groupKey = (members: readonly string[]) =>
  [...members].sort().join('\u0000');

/** Whether `to` can be reached from `from` along `edges`. */
function reaches(
  edges: ReadonlyMap<string, readonly string[]>,
  from: string,
  to: string,
): boolean {
  const seen = new Set<string>();
  const stack = [from];
  for (let id = stack.pop(); id !== undefined; id = stack.pop()) {
    if (id === to) return true;
    if (seen.has(id)) continue;
    seen.add(id);
    stack.push(...(edges.get(id) ?? []));
  }
  return false;
}

/** Edges in the order an adapter emits them: by target, then by source,
 *  in the graph's reading order, so the layout reads them alike. */
function inReadingOrder(
  nodes: readonly FlowNode[],
  edges: readonly FlowEdge[],
): FlowEdge[] {
  const order = new Map(nodes.map((node, index) => [node.id, index]));
  return [...edges].sort(
    (a, b) =>
      (order.get(a.target) ?? 0) - (order.get(b.target) ?? 0) ||
      (order.get(a.source) ?? 0) - (order.get(b.source) ?? 0),
  );
}

/**
 * The union of two versions of a graph and what changed between them.
 *
 *  - Nodes: the newer graph's in its order; a node only the older graph
 *    had stays, `removed`, right after the node it followed there. A node
 *    only the newer graph has is `added`. For a node in both (or a renamed
 *    one) `changed` says what happened — the host compares their contents;
 *    nothing means unchanged, except that a node that changed its kind
 *    reads `changed`. A renamed node (`kind: 'renamed'`, `beforeId`) is one
 *    box: its older id leaves no removed box, and its older lines count as
 *    its own. Start and End are never removed: the newer graph's stand for
 *    the older ones.
 *  - Lines are the same line when their ends and their kind are: a line
 *    only one version draws is `added` or `removed`. A removed line that
 *    would close a loop through the newer graph (two nodes that swapped
 *    order), or a condition's line from what is no longer a condition, is
 *    left out, so the union stays a flow from Start to End the canvas can
 *    draw.
 *  - Frames are the same frame when they hold the same nodes; a frame only
 *    the older graph had stays, `removed`, round its nodes when no newer
 *    frame holds them and the union can draw it.
 */
export function mergeFlowGraphs(
  before: FlowGraph,
  after: FlowGraph,
  changed: (id: string) => FlowNodeDiff | undefined,
): { graph: FlowGraph; diff: FlowDiffOverlay } {
  const afterById = new Map(after.nodes.map((node) => [node.id, node]));
  const beforeById = new Map(before.nodes.map((node) => [node.id, node]));
  const nodeDiffs: Record<string, FlowNodeDiff> = {};
  /** An older node id and the union node that stands for it. */
  const sameAs = new Map<string, string>();

  // The newer Start and End stand for older ones of another id.
  const formerOf = new Map<string, string>();
  for (const kind of ['entry', 'exit'] as const) {
    const newer = after.nodes.find((node) => node.kind === kind);
    const older = before.nodes.find((node) => node.kind === kind);
    if (newer !== undefined && older !== undefined && !afterById.has(older.id))
      formerOf.set(newer.id, older.id);
  }
  for (const node of after.nodes) {
    const told = changed(node.id);
    const renamedId =
      told?.beforeId !== undefined &&
      told.beforeId !== node.id &&
      beforeById.has(told.beforeId) &&
      !afterById.has(told.beforeId)
        ? told.beforeId
        : undefined;
    const formerId = renamedId ?? formerOf.get(node.id) ?? node.id;
    if (formerId !== node.id) sameAs.set(formerId, node.id);
    const old = beforeById.get(formerId);
    if (told !== undefined) nodeDiffs[node.id] = told;
    else if (old === undefined) nodeDiffs[node.id] = { kind: 'added' };
    else if (old.kind !== node.kind) nodeDiffs[node.id] = { kind: 'changed' };
  }
  const unionIdOf = (id: string) => sameAs.get(id) ?? id;

  // Removed nodes, each right after the node it followed in the older
  // graph (its nearest earlier node the union holds).
  const nodes: FlowNode[] = [...after.nodes];
  let anchor: string | null = null;
  for (const node of before.nodes) {
    const union = unionIdOf(node.id);
    if (afterById.has(union)) {
      anchor = union;
      continue;
    }
    const at =
      anchor === null ? -1 : nodes.findIndex((each) => each.id === anchor);
    nodes.splice(at + 1, 0, node);
    // Only the older version has it: removed, in the host's words if any.
    const told = changed(node.id);
    nodeDiffs[node.id] = told?.kind === 'removed' ? told : { kind: 'removed' };
    anchor = node.id;
  }
  const kindInUnion = new Map(nodes.map((node) => [node.id, node.kind]));

  // Lines: the newer graph's, then the older graph's own.
  const afterKeys = new Set(
    after.edges.map((edge) => edgeKey(edge.source, edge.target, edge.kind)),
  );
  const beforeKeys = new Set(
    before.edges.map((edge) =>
      edgeKey(unionIdOf(edge.source), unionIdOf(edge.target), edge.kind),
    ),
  );
  const edgeDiffs: Record<string, 'added' | 'removed'> = {};
  const edges: FlowEdge[] = [];
  const edgeIds = new Set<string>();
  const successors = new Map<string, string[]>();
  const link = (edge: FlowEdge) => {
    edges.push(edge);
    edgeIds.add(edge.id);
    successors.set(edge.source, [
      ...(successors.get(edge.source) ?? []),
      edge.target,
    ]);
  };
  for (const edge of after.edges) {
    link(edge);
    if (
      !edge.layoutOnly &&
      !beforeKeys.has(edgeKey(edge.source, edge.target, edge.kind))
    )
      edgeDiffs[edge.id] = 'added';
  }
  for (const edge of before.edges) {
    // An older layout hint shapes nothing the union draws.
    if (edge.layoutOnly) continue;
    const source = unionIdOf(edge.source);
    const target = unionIdOf(edge.target);
    if (afterKeys.has(edgeKey(source, target, edge.kind))) continue;
    if (
      !kindInUnion.has(source) ||
      !kindInUnion.has(target) ||
      source === target
    )
      continue;
    // A condition's line leaves a condition: a node of another kind under
    // the older id keeps none of them.
    if (GATE_EDGES.has(edge.kind) && kindInUnion.get(source) !== 'gate')
      continue;
    if (reaches(successors, target, source)) continue;
    let id = edgeIds.has(edge.id) ? flowBeforeEdgeId(edge.id) : edge.id;
    for (let n = 2; edgeIds.has(id); n++)
      id = `${flowBeforeEdgeId(edge.id)}${n}`;
    link({ ...edge, id, source, target });
    edgeDiffs[id] = 'removed';
  }

  // Frames: the newer graph's, then the older graph's own where they fit.
  const afterGroups = after.groups ?? [];
  const beforeGroups = before.groups ?? [];
  const beforeGroupKeys = new Set(
    beforeGroups.map((group) => groupKey(group.members.map(unionIdOf))),
  );
  const afterGroupKeys = new Set(
    afterGroups.map((group) => groupKey(group.members)),
  );
  const groupDiffs: Record<string, 'added' | 'removed'> = {};
  const groups: FlowGroup[] = [...afterGroups];
  for (const group of afterGroups)
    if (!beforeGroupKeys.has(groupKey(group.members)))
      groupDiffs[group.id] = 'added';
  const graphOf = (candidate: readonly FlowGroup[]): FlowGraph => ({
    nodes,
    edges: inReadingOrder(nodes, edges),
    groups: candidate,
  });
  for (const group of beforeGroups) {
    const members = group.members.map(unionIdOf);
    if (afterGroupKeys.has(groupKey(members))) continue;
    const ids = new Set(groups.map((each) => each.id));
    let id = ids.has(group.id) ? `${group.id}~before` : group.id;
    for (let n = 2; ids.has(id); n++) id = `${group.id}~before${n}`;
    // A frame the union cannot draw truthfully (its nodes in another frame,
    // or a path leaving it and coming back) is left out: a frame is
    // decoration, and its nodes still say what changed.
    const known = new Set(flowGraphProblems(graphOf(groups)));
    const added = flowGraphProblems(
      graphOf([...groups, { ...group, id, members }]),
    ).filter((problem) => !known.has(problem));
    if (added.length > 0) continue;
    groups.push({ ...group, id, members });
    groupDiffs[id] = 'removed';
  }

  return {
    graph: {
      nodes,
      edges: inReadingOrder(nodes, edges),
      ...(groups.length > 0 ? { groups } : {}),
    },
    diff: {
      nodes: nodeDiffs,
      edges: edgeDiffs,
      ...(Object.keys(groupDiffs).length > 0 ? { groups: groupDiffs } : {}),
    },
  };
}

/**
 * What changed, on one version's own graph — the older one beside "Before",
 * the newer one beside "After", or the union: every node and line the
 * overlay marks that the graph draws (a renamed node under either of its
 * ids), brought forward without quieting the rest.
 */
export function diffHighlight(
  graph: FlowGraph,
  diff: FlowDiffOverlay,
): FlowHighlight {
  const formerIds = new Set(
    Object.values(diff.nodes).flatMap((entry) =>
      entry.beforeId === undefined ? [] : [entry.beforeId],
    ),
  );
  const nodes = new Set(
    graph.nodes
      .filter(
        (node) => diff.nodes[node.id] !== undefined || formerIds.has(node.id),
      )
      .map((node) => node.id),
  );
  const edges = new Set(
    graph.edges
      .filter(
        (edge) =>
          !edge.layoutOnly &&
          (diff.edges[edge.id] !== undefined ||
            diff.edges[flowBeforeEdgeId(edge.id)] !== undefined),
      )
      .map((edge) => edge.id),
  );
  return { nodes, edges, quietRest: false };
}
