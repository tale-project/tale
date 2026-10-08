import type { FlowNodeState } from '../node-status';
import type { FlowEdge, FlowGraph, FlowNode } from '../types';
import type {
  FlowEdgeRunState,
  FlowFrameState,
  FlowNodeRunInfo,
  FlowNodeSpan,
  FlowPlaybackTimeline,
  FlowRunOverlay,
} from './types';

/**
 * Where every node and line of a chart stands in a run — at a moment of a
 * playback timeline, or as an overlay without time. Pure: the canvas, the
 * List view and a scrubber's words all read the same frame.
 *
 * A node's state at `t` comes from its spans that have started: running
 * (or waiting) while one is open, else the outcome of the last to end; a
 * node that runs once per item stays running between items and fails when
 * an item failed. A node no span reached is pending, or did not run once
 * the run is over. Start counts as done from the first moment; End takes
 * the run's outcome when it is over.
 *
 * A line is travelling while a value moves along it, travelled once one
 * arrived, and not taken when its condition decided the other way or its
 * target was skipped. Where the host recorded no travel for a line, it is
 * travelled when its source succeeded and its target started.
 */

/** A node that has started, whatever came of it. */
const STARTED: ReadonlySet<FlowNodeState> = new Set([
  'running',
  'waiting',
  'succeeded',
  'failed',
  'stopped',
]);

/** A node the run passed by. */
const PASSED_BY: ReadonlySet<FlowNodeState> = new Set(['skipped', 'not-run']);

const drawn = (graph: FlowGraph) =>
  graph.edges.filter((edge) => !edge.layoutOnly);

/** The state of a node no span (or overlay entry) speaks for. */
function untouched(node: FlowNode, finished: boolean): FlowNodeRunInfo {
  if (node.kind === 'entry') return { state: 'succeeded' };
  return { state: finished ? 'not-run' : 'pending' };
}

/** End's state: the run's outcome once it is over. */
function exitState(
  nodes: Readonly<Record<string, FlowNodeRunInfo>>,
  finished: boolean,
): FlowNodeRunInfo {
  if (!finished) return { state: 'pending' };
  const states = new Set(Object.values(nodes).map((info) => info.state));
  if (states.has('failed')) return { state: 'failed' };
  if (states.has('stopped')) return { state: 'stopped' };
  return { state: 'succeeded' };
}

/** A node's state from its spans at `t`; `null` when none has started. */
function stateFromSpans(
  spans: readonly FlowNodeSpan[],
  t: number,
  live: boolean,
): FlowNodeRunInfo | null {
  const started = spans.filter((span) => span.start <= t);
  if (started.length === 0) return null;
  const open = started.filter((span) => span.end === undefined || t < span.end);
  const more = spans.some((span) => span.start > t);
  // The span that started last speaks for the words (ties: the later one).
  const latest = started.reduce((a, b) => (b.start >= a.start ? b : a));
  const lastEnded = started
    .filter((span) => span.end !== undefined && span.end <= t)
    .reduce<FlowNodeSpan | null>(
      (a, b) => (a === null || (b.end ?? 0) >= (a.end ?? 0) ? b : a),
      null,
    );
  const itemSpans = spans.filter((span) => span.item !== undefined);
  const failedItem = started.some(
    (span) =>
      span.item !== undefined &&
      span.outcome === 'failed' &&
      span.end !== undefined &&
      span.end <= t,
  );

  let state: FlowNodeState;
  if (open.length > 0)
    state = open.every((span) => span.outcome === 'waiting')
      ? 'waiting'
      : 'running';
  else if (more)
    // Between two stretches of work: still at it (or still waiting).
    state = lastEnded?.outcome === 'waiting' ? 'waiting' : 'running';
  else if (itemSpans.length > 0 && failedItem) state = 'failed';
  else state = lastEnded?.outcome ?? 'succeeded';

  const info: FlowNodeRunInfo = { state };
  const failing =
    state === 'failed'
      ? started.find((span) => span.outcome === 'failed')
      : undefined;
  const words = failing ?? latest;
  if (words.reason !== undefined) info.reason = words.reason;
  if (words.detail !== undefined) info.detail = words.detail;
  const decided = [...started]
    .reverse()
    .find((span) => span.decision !== undefined);
  if (decided?.decision !== undefined) info.decision = decided.decision;
  if (itemSpans.length > 0) {
    const ended = itemSpans.filter(
      (span) => span.end !== undefined && span.end <= t,
    );
    const failed = ended.filter((span) => span.outcome === 'failed').length;
    info.items = {
      done: new Set(ended.map((span) => span.item)).size,
      ...(live
        ? {}
        : { total: new Set(itemSpans.map((span) => span.item)).size }),
      ...(failed > 0 ? { failed } : {}),
    };
  }
  const passes = spans.filter((span) => span.pass !== undefined);
  if (passes.length > 0) {
    const current = started
      .filter((span) => span.pass !== undefined)
      .reduce((max, span) => Math.max(max, span.pass ?? 0), 0);
    info.pass = {
      current,
      ...(live
        ? {}
        : {
            max: passes.reduce((max, span) => Math.max(max, span.pass ?? 0), 0),
          }),
    };
  }
  return info;
}

/** A line's state from where its two ends stand. */
function edgeFromNodes(
  edge: FlowEdge,
  nodes: Readonly<Record<string, FlowNodeRunInfo>>,
): FlowEdgeRunState {
  const source = nodes[edge.source];
  const target = nodes[edge.target];
  if (
    edge.kind === 'branch-yes' ||
    edge.kind === 'branch-no' ||
    edge.kind === 'gate'
  ) {
    const decision = source?.decision;
    if (decision !== undefined) {
      const takes = edge.kind === 'branch-no' ? !decision : decision;
      return takes ? 'travelled' : 'not-taken';
    }
  }
  // A skip travels down: nothing leaves a node the run passed by.
  if (
    (target !== undefined && PASSED_BY.has(target.state)) ||
    (source !== undefined && PASSED_BY.has(source.state))
  )
    return 'not-taken';
  if (
    source?.state === 'succeeded' &&
    target !== undefined &&
    STARTED.has(target.state)
  )
    return 'travelled';
  return 'idle';
}

/**
 * The first failure and the way the run took to it: every line it
 * travelled, back from the failed node, and the nodes those lines came
 * from.
 */
function failureOf(
  graph: FlowGraph,
  nodes: Readonly<Record<string, FlowNodeRunInfo>>,
  edges: Readonly<Record<string, FlowEdgeRunState>>,
  first: string | undefined,
): FlowFrameState['failure'] {
  if (first === undefined) return undefined;
  const incoming = new Map<string, FlowEdge[]>();
  for (const edge of drawn(graph))
    incoming.set(edge.target, [...(incoming.get(edge.target) ?? []), edge]);
  const pathNodes = new Set<string>([first]);
  const pathEdges = new Set<string>();
  const stack = [first];
  while (stack.length > 0) {
    const id = stack.pop();
    if (id === undefined) continue;
    for (const edge of incoming.get(id) ?? []) {
      const state = edges[edge.id];
      if (state !== 'travelled' && state !== 'travelling') continue;
      const source = nodes[edge.source];
      if (source === undefined || !STARTED.has(source.state)) continue;
      pathEdges.add(edge.id);
      if (!pathNodes.has(edge.source)) {
        pathNodes.add(edge.source);
        stack.push(edge.source);
      }
    }
  }
  return { nodeId: first, pathNodes, pathEdges };
}

const isWork = (node: FlowNode) =>
  node.kind !== 'entry' && node.kind !== 'exit';

/** The frame at moment `t` of a playback timeline. */
export function flowStateAt(
  graph: FlowGraph,
  timeline: FlowPlaybackTimeline,
  t: number,
): FlowFrameState {
  const live = timeline.live === true;
  const finished = !live && t >= timeline.duration;
  const spansOf = new Map<string, FlowNodeSpan[]>();
  for (const span of timeline.spans)
    spansOf.set(span.nodeId, [...(spansOf.get(span.nodeId) ?? []), span]);

  const nodes: Record<string, FlowNodeRunInfo> = {};
  for (const node of graph.nodes) {
    if (node.kind === 'exit') continue;
    nodes[node.id] =
      stateFromSpans(spansOf.get(node.id) ?? [], t, live) ??
      untouched(node, finished);
  }
  for (const node of graph.nodes) {
    if (node.kind !== 'exit') continue;
    nodes[node.id] =
      stateFromSpans(spansOf.get(node.id) ?? [], t, live) ??
      exitState(nodes, finished);
  }

  const travelsOf = new Map<
    string,
    FlowPlaybackTimeline['travels'][number][]
  >();
  for (const travel of timeline.travels)
    travelsOf.set(travel.edgeId, [
      ...(travelsOf.get(travel.edgeId) ?? []),
      travel,
    ]);

  const edges: Record<string, FlowEdgeRunState> = {};
  const travelling: FlowFrameState['travelling'] = [];
  for (const edge of drawn(graph)) {
    const travels = travelsOf.get(edge.id) ?? [];
    let state: FlowEdgeRunState | null = null;
    for (const travel of travels) {
      if (travel.start <= t && t < travel.end) {
        state = 'travelling';
        travelling.push({
          edgeId: edge.id,
          progress: (t - travel.start) / (travel.end - travel.start),
          ...(travel.item === undefined ? {} : { item: travel.item }),
        });
      } else if (travel.end <= t && state === null) state = 'travelled';
    }
    if (state === null) {
      const fallback = edgeFromNodes(edge, nodes);
      // A line with recorded travels is travelled only by one of them.
      state =
        travels.length > 0 && fallback === 'travelled' ? 'idle' : fallback;
    }
    edges[edge.id] = state;
  }

  // The first failure in time (ties: reading order).
  let first: { id: string; at: number } | undefined;
  for (const node of graph.nodes) {
    if (!isWork(node) || nodes[node.id]?.state !== 'failed') continue;
    const at = Math.min(
      ...(spansOf.get(node.id) ?? [])
        .filter((span) => span.outcome === 'failed' && span.start <= t)
        .map((span) => span.end ?? span.start),
    );
    if (first === undefined || at < first.at) first = { id: node.id, at };
  }
  const failure = failureOf(graph, nodes, edges, first?.id);
  return failure === undefined
    ? { nodes, edges, travelling }
    : { nodes, edges, travelling, failure };
}

/** The frame of a run shown without time. */
export function flowStateFromOverlay(
  graph: FlowGraph,
  overlay: FlowRunOverlay,
): FlowFrameState {
  const nodes: Record<string, FlowNodeRunInfo> = {};
  for (const node of graph.nodes) {
    if (node.kind === 'exit') continue;
    nodes[node.id] =
      overlay.nodes[node.id] ?? untouched(node, overlay.finished);
  }
  for (const node of graph.nodes) {
    if (node.kind !== 'exit') continue;
    nodes[node.id] =
      overlay.nodes[node.id] ?? exitState(nodes, overlay.finished);
  }
  const edges: Record<string, FlowEdgeRunState> = {};
  for (const edge of drawn(graph))
    edges[edge.id] = overlay.edges?.[edge.id] ?? edgeFromNodes(edge, nodes);
  const first = graph.nodes.find(
    (node) => isWork(node) && nodes[node.id]?.state === 'failed',
  )?.id;
  const failure = failureOf(graph, nodes, edges, first);
  return failure === undefined
    ? { nodes, edges, travelling: [] }
    : { nodes, edges, travelling: [], failure };
}
