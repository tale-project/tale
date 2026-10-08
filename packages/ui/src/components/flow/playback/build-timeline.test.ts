import { describe, expect, it } from 'vitest';

import { branchRun, triageFailedRun } from '../testing/flow-fixtures';
import { buildPlaybackTimeline, type FlowRealRun } from './build-timeline';

describe('buildPlaybackTimeline', () => {
  it('plays each stretch for its real length, never shorter than a step nor longer than a gap', () => {
    const run: FlowRealRun = {
      startedAt: 0,
      endedAt: 10_000_000,
      spans: [
        { nodeId: 'a', startedAt: 0, endedAt: 2, outcome: 'succeeded' },
        { nodeId: 'b', startedAt: 2, endedAt: 500, outcome: 'succeeded' },
        {
          nodeId: 'c',
          startedAt: 500,
          endedAt: 10_000_000,
          outcome: 'succeeded',
        },
      ],
      travels: [],
    };
    const timeline = buildPlaybackTimeline(run);
    const [a, b, c] = timeline.spans;
    // 2 ms plays as the 240 ms floor, 498 ms as itself, hours as 1.2 s.
    expect(a?.end).toBe(240);
    expect(b?.end).toBe(240 + 498);
    expect((c?.end ?? 0) - (c?.start ?? 0)).toBe(1_200);
    expect(timeline.duration).toBe(240 + 498 + 1_200);
    expect(timeline.live).toBeUndefined();
  });

  it('gives a value time to travel before its target starts', () => {
    const run: FlowRealRun = {
      startedAt: 0,
      endedAt: 1_000,
      spans: [
        { nodeId: 'a', startedAt: 0, endedAt: 300, outcome: 'succeeded' },
        { nodeId: 'b', startedAt: 301, endedAt: 1_000, outcome: 'succeeded' },
      ],
      travels: [{ edgeId: 'a>b', at: 300, target: 'b' }],
    };
    const timeline = buildPlaybackTimeline(run, { travelMs: 320 });
    const travel = timeline.travels[0];
    const b = timeline.spans[1];
    expect(travel?.end).toBe((travel?.start ?? 0) + 320);
    expect(b?.start).toBeGreaterThanOrEqual(travel?.end ?? Infinity);
    expect(timeline.events).toContain(travel?.start);
  });

  it('marks a long wait with its real words and a failure with its reason', () => {
    const timeline = buildPlaybackTimeline(branchRun());
    const wait = timeline.marks?.find((mark) => mark.kind === 'wait');
    expect(wait?.label).toBe('Waited 0.8 s for approval');
    const failure = buildPlaybackTimeline(triageFailedRun()).marks?.find(
      (mark) => mark.kind === 'failure',
    );
    expect(failure?.label).toBe('The model provider refused the request');
  });

  it('maps real time and playback time back and forth', () => {
    const run = branchRun();
    const timeline = buildPlaybackTimeline(run);
    for (const t of [0, 100, 777, 1_234.5, timeline.duration / 2]) {
      expect(timeline.fromReal(timeline.toReal(t))).toBeCloseTo(t, 6);
    }
    for (const span of run.spans) {
      const played = timeline.fromReal(span.startedAt);
      expect(timeline.toReal(played)).toBeCloseTo(span.startedAt, 6);
    }
    expect(timeline.toReal(0)).toBe(run.startedAt);
    expect(timeline.toReal(timeline.fromReal(run.endedAt ?? 0))).toBe(
      run.endedAt,
    );
  });

  it('keeps events in order and the duration past every travel', () => {
    const timeline = buildPlaybackTimeline(branchRun());
    expect([...timeline.events]).toEqual(
      [...timeline.events].sort((a, b) => a - b),
    );
    for (const travel of timeline.travels)
      expect(timeline.duration).toBeGreaterThanOrEqual(travel.end);
  });

  it('is live while the run has no end, and plays past its last moment one to one', () => {
    const run = { ...triageFailedRun(), endedAt: undefined };
    const timeline = buildPlaybackTimeline(run);
    expect(timeline.live).toBe(true);
    const last = timeline.duration;
    expect(timeline.fromReal(timeline.toReal(last) + 500)).toBeCloseTo(
      last + 500,
      6,
    );
  });
});
