import { describe, expect, it } from 'vitest';

import {
  branchFlowGraph,
  branchRun,
  branchRunOverlay,
  triageExplainedRun,
  triageFailedRun,
  triageFlowGraph,
} from '../testing/flow-fixtures';
import { buildPlaybackTimeline } from './build-timeline';
import {
  flowSpanStateAt,
  flowStateAt,
  flowStateFromOverlay,
} from './derive-state';

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

    // What a step came to ("1.2 s") shows once the replay gets there.
    const fetching = flowStateAt(graph, timeline, real(600));
    expect(fetching.nodes.issues?.state).toBe('running');
    expect(fetching.nodes.issues?.detail).toBeUndefined();

    const done = flowStateAt(graph, timeline, real(1_255));
    expect(done.nodes.issues?.state).toBe('succeeded');
    expect(done.nodes.issues?.detail).toBe('1.2 s');
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
          detail: 'Scoring the third issue',
        }),
    });
    const now = flowStateAt(graph, live, live.duration);
    expect(now.nodes.score?.state).toBe('running');
    // A span still open says what it is doing now, in the host's words.
    expect(now.nodes.score?.detail).toBe('Scoring the third issue');
    // The run is not over: a live list has no known length yet.
    expect(now.nodes.score?.items).toEqual({ done: 2 });
    expect(now.nodes.report?.state).toBe('pending');
    expect(now.nodes.__end?.state).toBe('pending');
  });
});

describe('what a span says, and when', () => {
  it('says why only once the replay reached what a span came to', () => {
    const graph = triageFlowGraph();
    const run = triageExplainedRun();
    const timeline = buildPlaybackTimeline(run);
    const at = (ms: number) => timeline.fromReal(run.startedAt + ms);
    // The third issue is still being scored: neither its failure's words
    // nor their explanation show yet.
    const scoring = flowStateAt(graph, timeline, at(4_500)).nodes.score;
    expect(scoring?.state).toBe('running');
    expect(scoring?.reason).toBeUndefined();
    expect(scoring?.explanation).toBeUndefined();
    const end = flowStateAt(graph, timeline, timeline.duration).nodes.score;
    expect(end?.state).toBe('failed');
    expect(end?.reason).toBe('The model provider refused the request');
    expect(end?.explanation).toBe(
      'The model provider refused the request for the third issue: the prompt was too long.',
    );
  });

  it('says what a wait waits for while it waits', () => {
    const info = flowSpanStateAt(
      [
        {
          nodeId: 'review',
          start: 100,
          end: 900,
          outcome: 'waiting',
          reason: 'Waiting for approval',
          explanation: 'Waiting for Ada to approve the reply',
        },
      ],
      400,
      false,
    );
    expect(info).toMatchObject({
      state: 'waiting',
      reason: 'Waiting for approval',
      explanation: 'Waiting for Ada to approve the reply',
    });
  });

  it('counts a live list against its known length, and passes against their most', () => {
    const items = flowSpanStateAt(
      [
        { nodeId: 'score', start: 0, outcome: 'succeeded', total: 12 },
        { nodeId: 'score', start: 0, end: 10, outcome: 'succeeded', item: 0 },
        { nodeId: 'score', start: 10, outcome: 'succeeded', item: 1 },
      ],
      20,
      true,
    );
    expect(items?.items).toEqual({ done: 1, total: 12 });
    const passes = flowSpanStateAt(
      [
        { nodeId: 'poll', start: 0, outcome: 'succeeded', total: 5 },
        { nodeId: 'poll', start: 0, end: 10, outcome: 'succeeded', pass: 1 },
        { nodeId: 'poll', start: 10, outcome: 'succeeded', pass: 2 },
      ],
      20,
      true,
    );
    expect(passes?.pass).toEqual({ current: 2, max: 5 });
    // The finished Triage run knows its list held 12 issues, though only
    // four were recorded.
    const graph = triageFlowGraph();
    const timeline = buildPlaybackTimeline(triageExplainedRun());
    expect(
      flowStateAt(graph, timeline, timeline.duration).nodes.score?.items,
    ).toEqual({ done: 4, total: 12, failed: 1 });
  });

  it('passes an overlay’s explanation through', () => {
    const frame = flowStateFromOverlay(triageFlowGraph(), {
      finished: true,
      nodes: {
        issues: {
          state: 'skipped',
          reason: 'Skipped: condition was false',
          explanation: 'Skipped because limit (0) is not greater than 0',
        },
      },
    });
    expect(frame.nodes.issues?.explanation).toBe(
      'Skipped because limit (0) is not greater than 0',
    );
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

  it('lets a step an earlier run handed over feed its readers, and leads a failure back through it', () => {
    const graph = triageFlowGraph();
    const frame = flowStateFromOverlay(graph, {
      finished: true,
      nodes: {
        issues: { state: 'reused' },
        open_issues: { state: 'failed', reason: 'It failed again' },
      },
    });
    expect(frame.nodes.issues?.state).toBe('reused');
    expect(frame.edges['issues>open_issues']).toBe('travelled');
    expect(frame.failure?.nodeId).toBe('open_issues');
    expect(frame.failure?.pathNodes.has('issues')).toBe(true);
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
