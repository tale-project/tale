import type { ReactNode } from 'react';

import type { FlowNodeSpan, FlowPlaybackTimeline } from '../playback/types';
import type { FlowGateNode, FlowGraph, FlowIcon } from '../types';

/**
 * The rows of a run's Steps view, in time order: Start, each node where it
 * started (or was skipped), each condition where it decided, the waits,
 * the restarts, and End. A node that ran once per item or repeated holds
 * a row per item or pass under it.
 *
 * Every row says where it sits on the playback timeline (`start`, in
 * playback milliseconds): choosing a row seeks there. Ids are unique in
 * the view — a node's row and a condition's row carry the node's id, so a
 * host's selection (a node id) is a row id.
 */
export type FlowTimelineRow =
  | FlowTimelineTerminalRow
  | FlowTimelineNodeRow
  | FlowTimelineItemRow
  | FlowTimelineDecisionRow
  | FlowTimelineWaitRow
  | FlowTimelineMarkRow;

interface FlowTimelineRowBase {
  id: string;
  /** Where the row sits on the timeline, in playback milliseconds. */
  start: number;
}

/** Start or End. */
export interface FlowTimelineTerminalRow extends FlowTimelineRowBase {
  kind: 'entry' | 'exit';
  nodeId: string;
  /** "Start" or "End" in the session's language when left out. */
  label?: string;
  /** "Started by the schedule", "Failed at Post after 3 h 2 s". */
  detail?: string;
}

/** A node's work in the run. */
export interface FlowTimelineNodeRow extends FlowTimelineRowBase {
  kind: 'node';
  nodeId: string;
  label: string;
  /** What kind of node it is: "GitHub · List issues". */
  typeLabel?: string;
  icon?: FlowIcon;
  /** Its items or passes, in order, when it ran once per item or
   *  repeated. */
  children?: readonly FlowTimelineItemRow[];
  /** How many items or passes there are in all — more than `children`
   *  when not every one was recorded. */
  childrenTotal?: number;
  /** A line under the row, in the host's words (an agent's latest move). */
  trailing?: ReactNode;
}

/** One item a node worked on, or one of its passes. */
export interface FlowTimelineItemRow extends FlowTimelineRowBase {
  kind: 'item';
  nodeId: string;
  /** Which item, from 0. */
  item?: number;
  /** Which pass, from 1. */
  pass?: number;
  /** The item in the host's words ("“Fix login bug”"); "Item 3" or
   *  "Pass 2" in the session's language when left out. */
  label?: string;
  trailing?: ReactNode;
}

/** A condition deciding whether its node runs. */
export interface FlowTimelineDecisionRow extends FlowTimelineRowBase {
  kind: 'decision';
  /** The condition's own id (the graph's gate). */
  nodeId: string;
  /** The node it guards, by name. */
  guards: string;
  mode: FlowGateNode['mode'];
  /** The condition in words, or the expression itself. */
  condition: string;
  conditionIsCode?: boolean;
  /** `true` took Yes. */
  decision: boolean;
}

/** A stretch the run waited: an approval, a question, an agent. */
export interface FlowTimelineWaitRow extends FlowTimelineRowBase {
  kind: 'wait';
  /** The node that waited. */
  nodeId?: string;
  /** "Waited 3 h for approval (Ada)". */
  label: string;
  /** Left out: still waiting. */
  end?: number;
}

/** A restart, or a person's decision on how the run goes on. */
export interface FlowTimelineMarkRow extends FlowTimelineRowBase {
  kind: 'mark';
  mark: 'restart' | 'resume';
  nodeId?: string;
  /** "The server restarted; another took over". */
  label: string;
}

/** The row id of a node's item or pass. */
export function flowTimelineItemId(
  nodeId: string,
  at: { item?: number; pass?: number },
): string {
  return at.item !== undefined
    ? `${nodeId}#item:${at.item}`
    : `${nodeId}#pass:${at.pass ?? 0}`;
}

/** Spans by node id, in the timeline's order. */
export function flowSpansByNode(
  timeline: FlowPlaybackTimeline,
): Map<string, FlowNodeSpan[]> {
  const byNode = new Map<string, FlowNodeSpan[]>();
  for (const span of timeline.spans)
    byNode.set(span.nodeId, [...(byNode.get(span.nodeId) ?? []), span]);
  return byNode;
}

/** The spans of one row: a node's every span, an item's or a pass's own. */
export function flowRowSpans(
  row: FlowTimelineRow,
  byNode: ReadonlyMap<string, readonly FlowNodeSpan[]>,
): FlowNodeSpan[] {
  if (row.kind === 'item')
    return (byNode.get(row.nodeId) ?? []).filter((span) =>
      row.item !== undefined
        ? span.item === row.item
        : span.item === undefined && span.pass === row.pass,
    );
  if (row.kind === 'node' || row.kind === 'exit' || row.kind === 'entry')
    return [...(byNode.get(row.nodeId) ?? [])];
  if (row.kind === 'decision')
    return (byNode.get(row.nodeId) ?? []).filter(
      (span) => span.decision !== undefined,
    );
  return [];
}

/** Ties at one moment: a condition decides before its node runs, a node
 *  starts before it waits, and End comes last. */
const KIND_ORDER: Record<FlowTimelineRow['kind'], number> = {
  entry: 0,
  decision: 1,
  node: 2,
  item: 2,
  wait: 3,
  mark: 4,
  exit: 5,
};

const earliest = (spans: readonly FlowNodeSpan[]) =>
  spans.reduce((min, span) => Math.min(min, span.start), Infinity);

/** A node's items or passes as rows, in order. */
function childRows(
  nodeId: string,
  spans: readonly FlowNodeSpan[],
): FlowTimelineItemRow[] {
  const items = new Map<number, FlowNodeSpan[]>();
  const passes = new Map<number, FlowNodeSpan[]>();
  for (const span of spans) {
    if (span.item !== undefined)
      items.set(span.item, [...(items.get(span.item) ?? []), span]);
    else if (span.pass !== undefined)
      passes.set(span.pass, [...(passes.get(span.pass) ?? []), span]);
  }
  const rows: FlowTimelineItemRow[] = [];
  for (const [item, own] of [...items].sort(([a], [b]) => a - b))
    rows.push({
      kind: 'item',
      id: flowTimelineItemId(nodeId, { item }),
      nodeId,
      item,
      start: earliest(own),
    });
  for (const [pass, own] of [...passes].sort(([a], [b]) => a - b))
    rows.push({
      kind: 'item',
      id: flowTimelineItemId(nodeId, { pass }),
      nodeId,
      pass,
      start: earliest(own),
    });
  return rows;
}

/**
 * The Steps view's rows for a run on `graph`, from the same timeline the
 * canvas plays. Only what the graph draws gets a row; a node no span
 * reached has none. A live run has no End row until it is over.
 *
 * Hosts map the result to add their own words: an item's title, a
 * `trailing` line on the row of a node at work.
 */
export function flowTimelineRows(
  graph: FlowGraph,
  timeline: FlowPlaybackTimeline,
): FlowTimelineRow[] {
  const byNode = flowSpansByNode(timeline);
  const order = new Map(graph.nodes.map((node, index) => [node.id, index]));
  const rows: { row: FlowTimelineRow; rank: number }[] = [];
  const add = (row: FlowTimelineRow, rank: number) => rows.push({ row, rank });

  for (const node of graph.nodes) {
    const spans = byNode.get(node.id) ?? [];
    const rank = order.get(node.id) ?? 0;
    if (node.kind === 'entry') {
      const detail = spans.findLast((span) => span.detail)?.detail;
      add(
        {
          kind: 'entry',
          id: node.id,
          nodeId: node.id,
          start: 0,
          ...(node.label === undefined ? {} : { label: node.label }),
          ...(detail === undefined ? {} : { detail }),
        },
        rank,
      );
    } else if (node.kind === 'exit') {
      if (spans.length === 0 && timeline.live === true) continue;
      const detail = spans.findLast((span) => span.detail)?.detail;
      add(
        {
          kind: 'exit',
          id: node.id,
          nodeId: node.id,
          start: spans.length > 0 ? earliest(spans) : timeline.duration,
          ...(node.label === undefined ? {} : { label: node.label }),
          ...(detail === undefined ? {} : { detail }),
        },
        rank,
      );
    } else if (node.kind === 'gate') {
      const decided = spans.filter((span) => span.decision !== undefined);
      decided.forEach((span, index) =>
        add(
          {
            kind: 'decision',
            id: index === 0 ? node.id : `${node.id}@${index}`,
            nodeId: node.id,
            start: span.start,
            guards: node.label,
            mode: node.mode,
            condition: node.condition,
            ...(node.conditionIsCode ? { conditionIsCode: true } : {}),
            decision: span.decision === true,
          },
          rank,
        ),
      );
    } else if (spans.length > 0) {
      const children = childRows(node.id, spans);
      const total = spans.find(
        (span) =>
          span.item === undefined &&
          span.pass === undefined &&
          span.total !== undefined,
      )?.total;
      add(
        {
          kind: 'node',
          id: node.id,
          nodeId: node.id,
          start: earliest(spans),
          label: node.label,
          ...(node.typeLabel === undefined
            ? {}
            : { typeLabel: node.typeLabel }),
          ...(node.icon === undefined ? {} : { icon: node.icon }),
          ...(children.length > 0 ? { children } : {}),
          ...(children.length > 0 || total !== undefined
            ? { childrenTotal: Math.max(children.length, total ?? 0) }
            : {}),
        },
        rank,
      );
    }
  }

  const nodes = graph.nodes.length;
  (timeline.marks ?? []).forEach((mark, index) => {
    if (mark.kind === 'wait')
      add(
        {
          kind: 'wait',
          id: `wait:${index}`,
          start: mark.at,
          label: mark.label,
          ...(mark.end === undefined ? {} : { end: mark.end }),
          ...(mark.nodeId === undefined ? {} : { nodeId: mark.nodeId }),
        },
        nodes + index,
      );
    else if (mark.kind === 'restart' || mark.kind === 'resume')
      add(
        {
          kind: 'mark',
          id: `mark:${index}`,
          mark: mark.kind,
          start: mark.at,
          label: mark.label,
          ...(mark.nodeId === undefined ? {} : { nodeId: mark.nodeId }),
        },
        nodes + index,
      );
  });

  return rows
    .sort(
      (a, b) =>
        a.row.start - b.row.start ||
        KIND_ORDER[a.row.kind] - KIND_ORDER[b.row.kind] ||
        a.rank - b.rank,
    )
    .map(({ row }) => row);
}

/** How many of a node's items or passes show before "Show all". */
export const FLOW_TIMELINE_CHILD_LIMIT = 20;

/** One line of the Steps view as it is shown: a row, or the "Show all"
 *  line under a node whose items are cut short. */
export type FlowTimelineLine =
  | {
      kind: 'row';
      row: FlowTimelineRow;
      /** 1 for a row of its own, 2 for an item or a pass. */
      level: 1 | 2;
      /** The node row an item or a pass sits under. */
      parentId?: string;
      /** Its place among its siblings, from 1, and how many there are. */
      position: number;
      siblings: number;
    }
  | {
      kind: 'more';
      id: string;
      parentId: string;
      /** How many items or passes "Show all" shows. */
      count: number;
      position: number;
      siblings: number;
    };

/**
 * The lines shown: every row, and under each expanded node its first
 * `limit` items or passes — all of them once "Show all" was chosen — then
 * a "Show all" line while some are held back.
 */
export function flowTimelineLines(
  rows: readonly FlowTimelineRow[],
  expanded: ReadonlySet<string>,
  showingAll: ReadonlySet<string>,
  limit = FLOW_TIMELINE_CHILD_LIMIT,
): FlowTimelineLine[] {
  const lines: FlowTimelineLine[] = [];
  rows.forEach((row, index) => {
    lines.push({
      kind: 'row',
      row,
      level: 1,
      position: index + 1,
      siblings: rows.length,
    });
    if (row.kind !== 'node' || !expanded.has(row.id)) return;
    const children = row.children ?? [];
    const all = showingAll.has(row.id) || children.length <= limit;
    const shown = all ? children : children.slice(0, limit);
    const siblings = shown.length + (all ? 0 : 1);
    shown.forEach((child, at) =>
      lines.push({
        kind: 'row',
        row: child,
        level: 2,
        parentId: row.id,
        position: at + 1,
        siblings,
      }),
    );
    if (!all)
      lines.push({
        kind: 'more',
        id: `${row.id}#more`,
        parentId: row.id,
        count: children.length,
        position: siblings,
        siblings,
      });
  });
  return lines;
}

/** The id of a line. */
export const flowTimelineLineId = (line: FlowTimelineLine): string =>
  line.kind === 'row' ? line.row.id : line.id;

/** The row that holds `id` — itself, or the node row an item sits under. */
export function flowTimelineParentOf(
  rows: readonly FlowTimelineRow[],
  id: string,
): { parent: FlowTimelineNodeRow; index: number } | null {
  for (const row of rows) {
    if (row.kind !== 'node') continue;
    const index = (row.children ?? []).findIndex((child) => child.id === id);
    if (index >= 0) return { parent: row, index };
  }
  return null;
}

/**
 * The line the replay has reached at `t`: the last one whose row started
 * by then (a "Show all" line counts as its parent's). -1 before the first.
 */
export function flowTimelineCursor(
  lines: readonly FlowTimelineLine[],
  t: number,
): number {
  let at = -1;
  lines.forEach((line, index) => {
    if (line.kind === 'row' && line.row.start <= t) at = index;
  });
  return at;
}
