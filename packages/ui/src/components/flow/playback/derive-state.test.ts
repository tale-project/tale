import { describe, expect, it } from 'vitest';

import {
  branchFlowGraph,
  branchRun,
  branchRunOverlay,
  triageFailedRun,
  triageFlowGraph,
} from '../testing/flow-fixtures';
import { buildPlaybackTimeline } from './build-timeline';
import { flowStateAt, flowStateFromOverlay } from './derive-state';

const triage = () => {
  const timeline = buildPlaybackTimeline(triageFailedRun());
  const real = (ms: number) =>
    timeline.fromReal(triageFailedRun().startedAt + ms);
  return { graph: triageFlowGraph(), timeline, real };
};

describe('flowStateAt', () => {
  it('says where every node stands at a moment', () => {
    const { graph, timeline, real } = triage();
    const before = flowStateAt(graph, timeline, real(20));
    expect(before.nodes.__start?.state).toBe('succeeded');
    expect(before.nodes.issues?.state).toBe('pending');
    expect(before.nodes.__end?.state).toBe('pending');

    const fetching = flowStateAt(graph, timeline, real(600));
    expect(fetching.nodes.issues?.state).toBe('running');
    expect(fetching.nodes.issues?.detail).toBe('1.2 s');

    const done = flowStateAt(graph, timeline, real(1_255));
    expect(done.nodes.issues?.state).toBe('succeeded');
  });

  it('counts the items of a node that runs once per item, and fails with an item', () => {
    const { graph, timeline, real } = triage();
    const second = flowStateAt(graph, timeline, real(3_000));
    expect(second.nodes.score?.state).toBe('running');
    expect(second.nodes.score?.items).toEqual({ done: 1, total: 4 });
    const end = flowStateAt(graph, timeline, timeline.duration);
    expect(end.nodes.score?.state).toBe('failed');
    expect(end.nodes.score?.reason).toBe(
      'The model provider refused the request',
    );
    expect(end.nodes.score?.items).toEqual({ done: 4, total: 4, failed: 1 });
    // A node the run never reached did not run; End took the run's outcome.
    expect(end.nodes.report?.state).toBe('not-run');
    expect(end.nodes.__end?.state).toBe('failed');
  });

  it('travels values along lines, with their progress', () => {
    const { graph, timeline } = triage();
    const travel = timeline.travels.find(
      (candidate) => candidate.edgeId === 'issues>open_issues',
    );
    if (travel === undefined) throw new Error('no travel');
    const halfway = travel.start + (travel.end - travel.start) / 2;
    const frame = flowStateAt(graph, timeline, halfway);
    expect(frame.edges['issues>open_issues']).toBe('travelling');
    expect(frame.travelling).toEqual([
      { edgeId: 'issues>open_issues', progress: 0.5 },
    ]);
    expect(frame.edges['__start>issues']).toBe('travelled');
    expect(frame.edges['open_issues>score']).toBe('idle');
    const after = flowStateAt(graph, timeline, travel.end);
    expect(after.edges['issues>open_issues']).toBe('travelled');
    expect(after.travelling).toEqual([]);
  });

  it('focuses the first failure and the way the run took to it', () => {
    const { graph, timeline } = triage();
    const end = flowStateAt(graph, timeline, timeline.duration);
    expect(end.failure?.nodeId).toBe('score');
    expect([...(end.failure?.pathNodes ?? [])].sort()).toEqual(
      ['__start', 'issues', 'open_issues', 'score'].sort(),
    );
    expect([...(end.failure?.pathEdges ?? [])].sort()).toEqual(
      ['__start>issues', 'issues>open_issues', 'open_issues>score'].sort(),
    );
    // Lines past the failure were not taken.
    expect(end.edges['score>report']).toBe('not-taken');
    expect(end.edges['report>__end']).toBe('not-taken');
  });

  it('decides conditions and leaves the other branch not taken', () => {
    const graph = branchFlowGraph();
    const timeline = buildPlaybackTimeline(branchRun());
    const end = flowStateAt(graph, timeline, timeline.duration);
    expect(end.nodes['__gate:urgent']?.decision).toBe(false);
    expect(end.nodes['__gate:normal']?.decision).toBe(true);
    expect(end.edges['__gate:urgent>urgent']).toBe('not-taken');
    expect(end.edges['__gate:urgent>__gate:normal']).toBe('travelled');
    expect(end.edges['__gate:normal>low']).toBe('not-taken');
    expect(end.edges['__gate:normal>normal']).toBe('travelled');
    expect(end.nodes.urgent?.state).toBe('skipped');
    expect(end.nodes.urgent?.reason).toBe('Skipped: the condition is false');
    // Lines out of a skipped node are not taken either.
    expect(end.edges['urgent>merge']).toBe('not-taken');
    expect(end.nodes.poll?.pass).toEqual({ current: 3, max: 3 });
    // The host's own End span speaks for the run.
    expect(end.nodes.__end?.state).toBe('succeeded');
    expect(end.nodes.__end?.detail).toBe('Succeeded in 4.6 s');
  });

  it('waits while a wait is open and runs again after it', () => {
    const graph = branchFlowGraph();
    const run = branchRun();
    const timeline = buildPlaybackTimeline(run);
    const at = (ms: number) => timeline.fromReal(run.startedAt + ms);
    expect(flowStateAt(graph, timeline, at(2_000)).nodes.normal?.state).toBe(
      'waiting',
    );
    expect(flowStateAt(graph, timeline, at(2_000)).nodes.normal?.reason).toBe(
      'Waiting for approval',
    );
    expect(flowStateAt(graph, timeline, at(2_500)).nodes.normal?.state).toBe(
      'running',
    );
  });

  it('keeps an open span running on a live timeline, and nothing is final', () => {
    const graph = triageFlowGraph();
    const run = triageFailedRun();
    const live = buildPlaybackTimeline({
      ...run,
      endedAt: undefined,
      spans: run.spans
        .filter((span) => span.item === undefined || span.item < 2)
        .concat({
          nodeId: 'score',
          startedAt: run.startedAt + 4_100,
          outcome: 'succeeded',
          item: 2,
        }),
    });
    const now = flowStateAt(graph, live, live.duration);
    expect(now.nodes.score?.state).toBe('running');
    // The run is not over: a live list has no known length yet.
    expect(now.nodes.score?.items).toEqual({ done: 2 });
    expect(now.nodes.report?.state).toBe('pending');
    expect(now.nodes.__end?.state).toBe('pending');
  });
});

describe('flowStateFromOverlay', () => {
  it('derives the lines from where their ends stand', () => {
    const graph = branchFlowGraph();
    const frame = flowStateFromOverlay(graph, branchRunOverlay());
    expect(frame.edges['__gate:urgent>urgent']).toBe('not-taken');
    expect(frame.edges['__gate:normal>normal']).toBe('travelled');
    expect(frame.edges['fetch>classify']).toBe('travelled');
    expect(frame.edges['merge>notify']).toBe('travelled');
    expect(frame.travelling).toEqual([]);
    expect(frame.failure?.nodeId).toBe('notify');
    expect(frame.failure?.pathEdges.has('merge>notify')).toBe(true);
  });

  it('takes the host’s lines when it gives them, and leaves unknown nodes not run', () => {
    const graph = triageFlowGraph();
    const frame = flowStateFromOverlay(graph, {
      finished: true,
      nodes: { issues: { state: 'succeeded' } },
      edges: { 'issues>open_issues': 'not-taken' },
    });
    expect(frame.edges['issues>open_issues']).toBe('not-taken');
    expect(frame.nodes.open_issues?.state).toBe('not-run');
    expect(frame.nodes.__end?.state).toBe('succeeded');
    const running = flowStateFromOverlay(graph, { finished: false, nodes: {} });
    expect(running.nodes.issues?.state).toBe('pending');
    expect(running.nodes.__end?.state).toBe('pending');
  });
});
