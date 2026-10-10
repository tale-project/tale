import type { FlowEdge, FlowGraph, FlowNode } from '../types';

/**
 * Possible paths through a workflow, and the highlight a canvas draws for
 * one or more of them.
 *
 * A host works its paths out from its own analysis — which nodes run and
 * how each condition decided — and hands them over as plain data. These
 * functions turn paths, a branch or a set of nodes into a highlight: the
 * nodes and lines to bring forward. Everything else steps back (quiet), so
 * the reader sees one way through the chart at a time.
 */

/** One way a run can go through the workflow. */
export interface FlowPath {
  id: string;
  /**
   * The steps and the conditions that run on this path. Start and End are
   * on every path and need not be listed.
   */
  nodes: readonly string[];
  /** How each condition decided on this path, keyed by the gate's
   *  `decisionKey` (else by its id): `true` takes Yes, `false` takes No. */
  decisions: Readonly<Record<string, boolean>>;
  /** The host's name for the path ("Path 2"). */
  label?: string;
}

/** What a canvas brings forward; the rest steps back. */
export interface FlowHighlight {
  nodes: ReadonlySet<string>;
  edges: ReadonlySet<string>;
  /** `error` rings the nodes in the error red (the nodes that end a run
   *  when they fail). @default 'default' */
  tone?: 'default' | 'error';
  /**
   * Whether everything outside the highlight steps back. `false` only
   * brings the highlight forward (a node a pointer rests on, the node that
   * has keyboard focus). @default true
   */
  quietRest?: boolean;
  /** Words for a quiet node's strip, by node id ("Skipped: the condition
   *  is false"). */
  reasons?: Readonly<Record<string, string>>;
  /** Said once, politely, when a host shows this highlight. */
  announcement?: string;
}

/** The key a path's `decisions` use for this gate. */
export const flowDecisionKey = (gate: FlowNode): string =>
  (gate.kind === 'gate' ? gate.decisionKey : undefined) ?? gate.id;

/** The edges a highlight can hold: drawn ones only. */
const drawnEdges = (graph: FlowGraph): FlowEdge[] =>
  graph.edges.filter((edge) => !edge.layoutOnly);

/** Start and End: on every path. */
const terminalIds = (graph: FlowGraph): string[] =>
  graph.nodes
    .filter((node) => node.kind === 'entry' || node.kind === 'exit')
    .map((node) => node.id);

/**
 * Whether `edge` lies on `path`: both its ends run on the path, and a Yes
 * or No line only on a path where its condition decided that way.
 */
function edgeOnPath(
  edge: FlowEdge,
  path: FlowPath,
  on: ReadonlySet<string>,
  byId: ReadonlyMap<string, FlowNode>,
): boolean {
  if (!on.has(edge.source) || !on.has(edge.target)) return false;
  if (edge.kind !== 'branch-yes' && edge.kind !== 'branch-no') return true;
  const gate = byId.get(edge.source);
  if (gate === undefined) return false;
  const decision = path.decisions[flowDecisionKey(gate)];
  return decision === (edge.kind === 'branch-yes');
}

/**
 * The highlight of one or more paths: every node that runs on any of
 * them, Start and End, and every line a run on one of them follows.
 */
export function highlightForPaths(
  graph: FlowGraph,
  paths: readonly FlowPath[],
): FlowHighlight {
  const byId = new Map(graph.nodes.map((node) => [node.id, node]));
  const terminals = terminalIds(graph);
  const nodes = new Set<string>();
  const edges = new Set<string>();
  const drawn = drawnEdges(graph);
  for (const path of paths) {
    const on = new Set([...terminals, ...path.nodes]);
    for (const id of on) if (byId.has(id)) nodes.add(id);
    for (const edge of drawn)
      if (edgeOnPath(edge, path, on, byId)) edges.add(edge.id);
  }
  return { nodes, edges };
}

/**
 * Every node below `from` along the drawn lines, `from` included — the
 * stand-in for a branch's paths when the host could not list them.
 */
function descendants(graph: FlowGraph, from: readonly string[]): Set<string> {
  const out = new Map<string, string[]>();
  for (const edge of drawnEdges(graph))
    out.set(edge.source, [...(out.get(edge.source) ?? []), edge.target]);
  const seen = new Set<string>();
  const stack = [...from];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined || seen.has(id)) continue;
    seen.add(id);
    stack.push(...(out.get(id) ?? []));
  }
  return seen;
}

/**
 * The highlight of a condition, or of one of its branches: the paths that
 * consult the gate, only those where it decided `decision` when given.
 *
 * With no paths (the host's analysis gave up: too many conditions to list
 * every path), the gate's branch leads the way instead — the gate and
 * everything below the branch's target.
 */
export function highlightForBranch(
  graph: FlowGraph,
  paths: readonly FlowPath[],
  gateId: string,
  decision?: boolean,
): FlowHighlight {
  const gate = graph.nodes.find((node) => node.id === gateId);
  if (gate === undefined) return { nodes: new Set(), edges: new Set() };
  const key = flowDecisionKey(gate);
  if (paths.length > 0) {
    return highlightForPaths(
      graph,
      paths.filter(
        (path) =>
          (path.nodes.includes(gateId) || key in path.decisions) &&
          (decision === undefined || path.decisions[key] === decision),
      ),
    );
  }
  // The lines the decision takes: Yes or No from an if/else gate; an
  // only-if gate's one line when it holds, none when it does not.
  const taken = (edge: FlowEdge) =>
    decision === undefined ||
    (edge.kind === 'branch-yes' && decision) ||
    (edge.kind === 'branch-no' && !decision) ||
    (edge.kind === 'gate' && decision);
  const out = drawnEdges(graph).filter(
    (edge) => edge.source === gateId && taken(edge),
  );
  const nodes = descendants(
    graph,
    out.map((edge) => edge.target),
  );
  nodes.add(gateId);
  const edges = new Set(
    drawnEdges(graph)
      .filter(
        (edge) =>
          (edge.source === gateId && out.includes(edge)) ||
          (edge.source !== gateId &&
            nodes.has(edge.source) &&
            nodes.has(edge.target)),
      )
      .map((edge) => edge.id),
  );
  return { nodes, edges };
}

/**
 * The highlight of a set of nodes — the nodes that end a run when they
 * fail, say — and the lines between them. `tone: 'error'` rings them red.
 */
export function highlightForNodes(
  graph: FlowGraph,
  ids: readonly string[],
  options: { tone?: 'default' | 'error' } = {},
): FlowHighlight {
  const known = new Set(graph.nodes.map((node) => node.id));
  const nodes = new Set(ids.filter((id) => known.has(id)));
  const edges = new Set(
    drawnEdges(graph)
      .filter((edge) => nodes.has(edge.source) && nodes.has(edge.target))
      .map((edge) => edge.id),
  );
  return options.tone === undefined
    ? { nodes, edges }
    : { nodes, edges, tone: options.tone };
}

/**
 * The lines into and out of one node, brought forward without quieting
 * anything — what a pointer resting on a node, or keyboard focus on it,
 * shows. Nothing else moves, so tabbing through the chart never flickers.
 */
export function highlightForIncident(
  graph: FlowGraph,
  id: string,
): FlowHighlight {
  return {
    nodes: new Set([id]),
    edges: new Set(
      drawnEdges(graph)
        .filter((edge) => edge.source === id || edge.target === id)
        .map((edge) => edge.id),
    ),
    quietRest: false,
  };
}

/** Whether two highlights bring the same things forward the same way. */
export function sameFlowHighlight(
  a: FlowHighlight | null | undefined,
  b: FlowHighlight | null | undefined,
): boolean {
  if (a === b) return true;
  if (!a || !b) return false;
  const sameSet = (x: ReadonlySet<string>, y: ReadonlySet<string>) =>
    x.size === y.size && [...x].every((id) => y.has(id));
  return (
    (a.tone ?? 'default') === (b.tone ?? 'default') &&
    (a.quietRest ?? true) === (b.quietRest ?? true) &&
    sameSet(a.nodes, b.nodes) &&
    sameSet(a.edges, b.edges)
  );
}
