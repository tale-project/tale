import { describe, expect, it } from 'vitest';

import { buildPlaybackTimeline } from '../playback/build-timeline';
import {
  branchFlowGraph,
  branchRun,
  triageExplainedRun,
  triageFailedRun,
  triageFlowGraph,
} from '../testing/flow-fixtures';
import {
  flowRowSpans,
  flowSpansByNode,
  flowTimelineChildrenUnread,
  flowTimelineCursor,
  flowTimelineItemId,
  flowTimelineLineId,
  flowTimelineLines,
  flowTimelineParentOf,
  flowTimelineRows,
  type FlowTimelineRow,
} from './rows';

const ids = (rows: readonly FlowTimelineRow[]) => rows.map((row) => row.id);

describe('flowTimelineRows', () => {
  it('lists Start, each node where it started, and End, in time order', () => {
    const timeline = buildPlaybackTimeline(triageFailedRun());
    const rows = flowTimelineRows(triageFlowGraph(), timeline);
    expect(ids(rows)).toEqual([
      '__start',
      'issues',
      'open_issues',
      'score',
      '__end',
    ]);
    const issues = rows[1];
    expect(issues).toMatchObject({
      kind: 'node',
      label: 'Issues',
      typeLabel: 'GitHub · List issues',
    });
    // Each row sits where its node started; End where the run ended.
    const run = triageFailedRun();
    expect(issues?.start).toBe(timeline.fromReal(run.startedAt + 50));
    expect(rows.at(-1)?.start).toBe(timeline.duration);
    for (let index = 1; index < rows.length; index++)
      expect(rows[index]?.start).toBeGreaterThanOrEqual(
        rows[index - 1]?.start ?? 0,
      );
  });

  it('holds a row per item under a node that ran once per item', () => {
    const timeline = buildPlaybackTimeline(triageFailedRun());
    const score = flowTimelineRows(triageFlowGraph(), timeline).find(
      (row) => row.id === 'score',
    );
    if (score?.kind !== 'node') throw new Error('no Score row');
    expect(score.children?.map((child) => child.id)).toEqual([
      'score#item:0',
      'score#item:1',
      'score#item:2',
      'score#item:3',
    ]);
    expect(score.childrenTotal).toBe(4);
    expect(score.children?.[2]).toMatchObject({ kind: 'item', item: 2 });
    // The node's own span knows how many items its list holds.
    const told = flowTimelineRows(
      triageFlowGraph(),
      buildPlaybackTimeline(triageExplainedRun()),
    ).find((row) => row.id === 'score');
    expect(told?.kind === 'node' && told.childrenTotal).toBe(12);
  });

  it('puts a condition before the node it guards, a node before its wait, and passes under a node that repeats', () => {
    const timeline = buildPlaybackTimeline(branchRun());
    const rows = flowTimelineRows(branchFlowGraph(), timeline);
    expect(ids(rows)).toEqual([
      '__start',
      'fetch',
      'classify',
      'enrich',
      '__gate:urgent',
      'urgent',
      '__gate:normal',
      'low',
      'normal',
      'wait:0',
      'merge',
      'notify',
      'poll',
      '__end',
    ]);
    expect(rows[4]).toMatchObject({
      kind: 'decision',
      guards: 'Urgent',
      mode: 'if-else',
      condition: 'urgent of Classify is true',
      decision: false,
    });
    expect(rows[6]).toMatchObject({ conditionIsCode: true, decision: true });
    expect(rows[9]).toMatchObject({
      kind: 'wait',
      label: 'Waited 0.8 s for approval',
    });
    const poll = rows[12];
    if (poll?.kind !== 'node') throw new Error('no Poll row');
    expect(poll.children?.map((child) => child.id)).toEqual([
      'poll#pass:1',
      'poll#pass:2',
      'poll#pass:3',
    ]);
    // End's own span gives its words.
    expect(rows.at(-1)).toMatchObject({
      kind: 'exit',
      detail: 'Succeeded in 4.6 s',
    });
  });

  it('lists waits and restarts with the node they belong to', () => {
    const timeline = buildPlaybackTimeline(triageExplainedRun());
    const rows = flowTimelineRows(triageFlowGraph(), timeline);
    expect(rows.find((row) => row.kind === 'wait')).toMatchObject({
      nodeId: 'open_issues',
      label: 'Waited 30 ms for approval (Ada)',
    });
    expect(rows.find((row) => row.kind === 'mark')).toMatchObject({
      mark: 'restart',
      nodeId: 'score',
      label: 'The server restarted; another took over',
    });
  });

  it('has no End row while a live run goes on', () => {
    const live = buildPlaybackTimeline({
      ...triageFailedRun(),
      endedAt: undefined,
    });
    expect(ids(flowTimelineRows(triageFlowGraph(), live))).not.toContain(
      '__end',
    );
  });

  it('finds each row’s spans and each item’s node', () => {
    const timeline = buildPlaybackTimeline(triageFailedRun());
    const rows = flowTimelineRows(triageFlowGraph(), timeline);
    const byNode = flowSpansByNode(timeline);
    const score = rows.find((row) => row.id === 'score');
    if (score?.kind !== 'node') throw new Error('no Score row');
    expect(flowRowSpans(score, byNode)).toHaveLength(4);
    const third = score.children?.[2];
    if (third === undefined) throw new Error('no third item');
    expect(flowRowSpans(third, byNode).map((span) => span.outcome)).toEqual([
      'failed',
    ]);
    expect(flowTimelineParentOf(rows, 'score#item:2')).toEqual({
      parent: score,
      index: 2,
    });
    expect(flowTimelineParentOf(rows, 'score')).toBeNull();
    expect(flowTimelineItemId('poll', { pass: 2 })).toBe('poll#pass:2');
  });
});

describe('flowTimelineLines', () => {
  it('says an open node’s items load while they are not read yet', () => {
    const unread: FlowTimelineRow[] = [
      {
        kind: 'node',
        id: 'a',
        nodeId: 'a',
        start: 0,
        label: 'A',
        childrenTotal: 3,
      },
    ];
    expect(flowTimelineChildrenUnread(unread[0] as FlowTimelineRow)).toBe(true);
    const lines = flowTimelineLines(unread, new Set(['a']), new Set());
    expect(lines.map(flowTimelineLineId)).toEqual(['a', 'a#loading']);
    expect(lines[1]).toMatchObject({ kind: 'loading', parentId: 'a' });
    // Read, even as none, the node holds what it holds.
    const read = flowTimelineLines(
      [{ ...(unread[0] as FlowTimelineRow), children: [] } as FlowTimelineRow],
      new Set(['a']),
      new Set(),
    );
    expect(read.map(flowTimelineLineId)).toEqual(['a']);
    // The cursor never rests on it.
    expect(flowTimelineCursor(lines, 10)).toBe(0);
  });

  const rows = flowTimelineRows(
    triageFlowGraph(),
    buildPlaybackTimeline(triageFailedRun()),
  );

  it('shows a node’s items only while it is open, each with its place among them', () => {
    expect(flowTimelineLines(rows, new Set(), new Set())).toHaveLength(5);
    const open = flowTimelineLines(rows, new Set(['score']), new Set());
    expect(open.map(flowTimelineLineId)).toEqual([
      '__start',
      'issues',
      'open_issues',
      'score',
      'score#item:0',
      'score#item:1',
      'score#item:2',
      'score#item:3',
      '__end',
    ]);
    expect(open[5]).toMatchObject({
      kind: 'row',
      level: 2,
      parentId: 'score',
      position: 2,
      siblings: 4,
    });
    expect(open[3]).toMatchObject({ level: 1, position: 4, siblings: 5 });
  });

  it('holds items back past the limit behind a "Show all" line, until it is chosen', () => {
    const cut = flowTimelineLines(rows, new Set(['score']), new Set(), 2);
    expect(cut.map(flowTimelineLineId)).toEqual([
      '__start',
      'issues',
      'open_issues',
      'score',
      'score#item:0',
      'score#item:1',
      'score#more',
      '__end',
    ]);
    expect(cut[6]).toMatchObject({
      kind: 'more',
      parentId: 'score',
      count: 4,
      position: 3,
      siblings: 3,
    });
    expect(
      flowTimelineLines(rows, new Set(['score']), new Set(['score']), 2),
    ).toHaveLength(9);
  });

  it('says which line the replay has reached', () => {
    const timeline = buildPlaybackTimeline(triageFailedRun());
    const lines = flowTimelineLines(rows, new Set(['score']), new Set());
    expect(flowTimelineCursor(lines, 0)).toBe(0);
    const run = triageFailedRun();
    expect(
      flowTimelineCursor(lines, timeline.fromReal(run.startedAt + 1_270)),
    ).toBe(2);
    // Score and its first item start together: the item is the later line.
    expect(
      flowTimelineCursor(lines, timeline.fromReal(run.startedAt + 1_300)),
    ).toBe(4);
    expect(flowTimelineCursor(lines, timeline.duration)).toBe(lines.length - 1);
  });
});
