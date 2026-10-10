import type { FlowTranslate } from '../describe';
import type { FlowHighlight } from '../paths/highlight';
import type { FlowFrameState } from '../playback/types';
import type { FlowGraph } from '../types';
import type { FlowEdgeLook, FlowNodeLook } from './flow-render-context';

/**
 * How every box and line of a chart looks, from the run shown and the
 * highlights on it. Pure: a browser test checks the picture, this checks
 * the rules.
 *
 *  - `primary` is the highlight that quiets the rest: a host's path, a
 *    condition a pointer rests on, or a failed run's way to its failure.
 *    Inside it, boxes are lifted and ringed (unless `ringPrimary` is off,
 *    as for a failure, whose boxes already wear their run frames) and lines
 *    stand out; outside it, boxes step back and lines thin.
 *  - `incident` only brings a node's own lines forward (a pointer or the
 *    keyboard on it) and quiets nothing.
 *  - In a run, a line the run took is drawn in the emphasis colour (red
 *    into the node it failed at), a line it did not take steps back.
 */
export function flowLooks({
  graph,
  run,
  primary,
  incident,
  ringPrimary = true,
}: {
  graph: FlowGraph;
  run: FlowFrameState | null;
  primary: FlowHighlight | null;
  incident: FlowHighlight | null;
  ringPrimary?: boolean;
}): {
  nodes: Map<string, FlowNodeLook>;
  edges: Map<string, FlowEdgeLook>;
} {
  const quietRest = primary !== null && primary.quietRest !== false;
  const nodes = new Map<string, FlowNodeLook>();
  for (const node of graph.nodes) {
    const info = run?.nodes[node.id];
    const inside = primary?.nodes.has(node.id) === true;
    const look: FlowNodeLook = {
      state: info?.state ?? 'idle',
      quiet: quietRest && !inside,
      highlighted:
        quietRest && inside && ringPrimary
          ? primary?.tone === 'error'
            ? 'error'
            : 'default'
          : 'none',
    };
    if (info?.decision !== undefined) look.decision = info.decision;
    if (look.state !== 'idle' || look.quiet || look.highlighted !== 'none')
      nodes.set(node.id, look);
  }

  const edges = new Map<string, FlowEdgeLook>();
  const failedAt = run?.failure?.nodeId;
  for (const edge of graph.edges) {
    if (edge.layoutOnly) continue;
    const state = run?.edges[edge.id];
    const forward =
      primary?.edges.has(edge.id) === true ||
      incident?.edges.has(edge.id) === true;
    let look: FlowEdgeLook['look'];
    if (quietRest && !forward) look = 'quiet';
    else if (state === 'not-taken') look = 'quiet';
    else if (state === 'travelled' || state === 'travelling')
      look =
        failedAt !== undefined && edge.target === failedAt
          ? 'error'
          : 'travelled';
    else if (forward) look = 'emphasis';
    else look = 'base';
    const branch = edge.kind === 'branch-yes' || edge.kind === 'branch-no';
    const taken =
      !branch || state === undefined || state === 'idle'
        ? undefined
        : state !== 'not-taken';
    if (look !== 'base' || taken !== undefined)
      edges.set(edge.id, taken === undefined ? { look } : { look, taken });
  }
  return { nodes, edges };
}

/** The counter on each frame's header in a run: items or passes done. */
export function flowFrameCounters(
  graph: FlowGraph,
  run: FlowFrameState | null,
  t: FlowTranslate,
): Map<string, string> {
  const counters = new Map<string, string>();
  if (run === null) return counters;
  for (const group of graph.groups ?? []) {
    const member = group.members[0];
    const info = member === undefined ? undefined : run.nodes[member];
    if (info?.items?.total !== undefined)
      counters.set(
        group.id,
        t('group.items', { done: info.items.done, total: info.items.total }),
      );
    else if (info?.pass?.max !== undefined)
      counters.set(
        group.id,
        t('group.pass', { pass: info.pass.current, max: info.pass.max }),
      );
  }
  return counters;
}

/** A string that changes exactly when a look map does, to keep its
 *  identity between frames of a playback where nothing changed. */
export function looksSignature(
  map: ReadonlyMap<string, object | string>,
): string {
  return JSON.stringify([...map]);
}
