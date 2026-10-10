import type { FlowTranslate } from '../describe';
import { FLOW_NODE_STATE, type FlowShownState } from '../node-status';
import { flowStateFromOverlay } from '../playback/derive-state';
import type {
  FlowCompareNode,
  FlowCompareOverlay,
  FlowEdgeRunState,
  FlowNodeRunInfo,
  FlowRunOverlay,
} from '../playback/types';
import type { FlowGraph, FlowNode } from '../types';

/**
 * Two runs on one chart. `flowCompareFromOverlays` derives the comparison
 * from where each run left every node; `flowCompareFaces` words what each
 * box shows on its foot — "A ✓ 1.2 s · B ✕ Failed". Pure: the canvas, its
 * List view and a host's own summary read the same facts.
 */

/** The runs' short names: the host's, else "A" and "B" in the session's
 *  language. */
export function flowCompareLabels(
  compare: FlowCompareOverlay,
  t: FlowTranslate,
): { a: string; b: string } {
  return compare.labels ?? { a: t('compare.a'), b: t('compare.b') };
}

const TAKEN: ReadonlySet<FlowEdgeRunState> = new Set([
  'travelled',
  'travelling',
]);

export interface FlowCompareOptions {
  labels?: { a: string; b: string };
  /** Nodes the host knows differ beyond their state — what they read or
   *  returned. */
  differs?: Iterable<string>;
  /** Nodes that are not in a run's version. */
  absent?: { a?: Iterable<string>; b?: Iterable<string> };
}

/**
 * The comparison of two runs of `graph`, each given as an overlay (where it
 * left every node). A node differs when the runs left it in different
 * states or its condition decided differently, or when the host says so; a
 * node not in one run's version is absent there instead. A line is `both`
 * when both runs took it, `a` or `b` when only one did, `neither` when
 * none did.
 */
export function flowCompareFromOverlays(
  graph: FlowGraph,
  a: FlowRunOverlay,
  b: FlowRunOverlay,
  { labels, differs = [], absent = {} }: FlowCompareOptions = {},
): FlowCompareOverlay {
  const left = flowStateFromOverlay(graph, a);
  const right = flowStateFromOverlay(graph, b);
  const told = new Set(differs);
  const absentA = new Set(absent.a ?? []);
  const absentB = new Set(absent.b ?? []);
  const nodes: Record<string, FlowCompareNode> = {};
  for (const node of graph.nodes) {
    const infoA = absentA.has(node.id) ? undefined : left.nodes[node.id];
    const infoB = absentB.has(node.id) ? undefined : right.nodes[node.id];
    const absentIn = absentA.has(node.id)
      ? 'a'
      : absentB.has(node.id)
        ? 'b'
        : undefined;
    const apart =
      infoA !== undefined &&
      infoB !== undefined &&
      (infoA.state !== infoB.state || infoA.decision !== infoB.decision);
    nodes[node.id] = {
      ...(infoA === undefined ? {} : { a: infoA }),
      ...(infoB === undefined ? {} : { b: infoB }),
      differs: absentIn === undefined && (apart || told.has(node.id)),
      ...(absentIn === undefined ? {} : { absentIn }),
    };
  }
  const edges: Record<string, 'both' | 'a' | 'b' | 'neither'> = {};
  for (const edge of graph.edges) {
    if (edge.layoutOnly) continue;
    const inA = TAKEN.has(left.edges[edge.id] ?? 'idle');
    const inB = TAKEN.has(right.edges[edge.id] ?? 'idle');
    edges[edge.id] = inA ? (inB ? 'both' : 'a') : inB ? 'b' : 'neither';
  }
  return { ...(labels === undefined ? {} : { labels }), nodes, edges };
}

/** One run's side of a box in a comparison: its state's glyph and words
 *  short enough for the box's foot. */
export interface FlowCompareSide {
  state: FlowShownState;
  text: string;
  /** A condition's decision in that run. */
  decision?: boolean;
}

/** What a box shows in a comparison. */
export interface FlowCompareFace {
  a?: FlowCompareSide;
  b?: FlowCompareSide;
  differs: boolean;
  /** "Not in A's version". */
  absent?: string;
}

/** States whose own words (a failure's, a skip's) say more than a
 *  duration. */
const TOLD_BY_REASON: ReadonlySet<FlowShownState> = new Set([
  'failed',
  'skipped',
  'stopped',
  'waiting',
]);

/** A side's words on a box's foot: the glyph says the state, so the words
 *  say what it came to — a duration, a count, a failure's words — or the
 *  state when there is nothing more. */
function sideText(
  node: FlowNode,
  info: FlowNodeRunInfo & { state: FlowShownState },
  t: FlowTranslate,
): string {
  const word = t(FLOW_NODE_STATE[info.state].labelKey);
  if (node.kind === 'gate' && info.decision !== undefined)
    return t(info.decision ? 'branch.yes' : 'branch.no');
  const counter =
    info.items?.total !== undefined
      ? t('group.items', { done: info.items.done, total: info.items.total })
      : info.pass?.max !== undefined
        ? t('group.pass', { pass: info.pass.current, max: info.pass.max })
        : undefined;
  if (TOLD_BY_REASON.has(info.state))
    return info.reason ?? info.detail ?? counter ?? word;
  return info.detail ?? counter ?? info.reason ?? word;
}

const shown = (
  info: FlowNodeRunInfo | undefined,
): (FlowNodeRunInfo & { state: FlowShownState }) | undefined =>
  info === undefined || info.state === 'idle'
    ? undefined
    : { ...info, state: info.state };

/** What every box shows on its foot in a comparison. */
export function flowCompareFaces(
  graph: FlowGraph,
  compare: FlowCompareOverlay,
  t: FlowTranslate,
): Map<string, FlowCompareFace> {
  const labels = flowCompareLabels(compare, t);
  const faces = new Map<string, FlowCompareFace>();
  for (const node of graph.nodes) {
    const entry = compare.nodes[node.id];
    if (entry === undefined) continue;
    const face: FlowCompareFace = { differs: entry.differs };
    for (const key of ['a', 'b'] as const) {
      const info = shown(entry[key]);
      if (info === undefined) continue;
      face[key] = {
        state: info.state,
        text: sideText(node, info, t),
        ...(info.decision === undefined ? {} : { decision: info.decision }),
      };
    }
    if (entry.absentIn !== undefined)
      face.absent = t('compare.absent', { label: labels[entry.absentIn] });
    faces.set(node.id, face);
  }
  return faces;
}
