import { describe, expect, test } from 'vitest';

import {
  DEFAULT_LEAD_IN_MS,
  DEFAULT_MIN_SCENE_MS,
  DEFAULT_TAIL_MS,
  driftReport,
  driftViolations,
  planTimeline,
} from './timeline';

describe('planTimeline', () => {
  test('scene budget is lead-in + audio + tail', () => {
    const plan = planTimeline([{ id: 'a', audioDurationMs: 4000 }]);
    expect(plan.scenes[0]).toEqual({
      id: 'a',
      startMs: 0,
      narrationStartMs: DEFAULT_LEAD_IN_MS,
      budgetMs: DEFAULT_LEAD_IN_MS + 4000 + DEFAULT_TAIL_MS,
    });
    expect(plan.totalMs).toBe(DEFAULT_LEAD_IN_MS + 4000 + DEFAULT_TAIL_MS);
  });

  test('a short or silent scene is held to the minimum', () => {
    const plan = planTimeline([{ id: 'silent', audioDurationMs: 0 }]);
    expect(plan.scenes[0]?.budgetMs).toBe(DEFAULT_MIN_SCENE_MS);
  });

  test('offsets accumulate scene by scene', () => {
    const plan = planTimeline([
      { id: 'a', audioDurationMs: 4000 },
      { id: 'b', audioDurationMs: 2000, leadInMs: 1000 },
    ]);
    const [a, b] = plan.scenes;
    expect(b?.startMs).toBe(a?.budgetMs);
    expect(b?.narrationStartMs).toBe((a?.budgetMs ?? 0) + 1000);
    expect(plan.totalMs).toBe((a?.budgetMs ?? 0) + (b?.budgetMs ?? 0));
  });

  test('per-scene overrides replace the defaults', () => {
    const plan = planTimeline([
      { id: 'title', audioDurationMs: 3000, leadInMs: 1200, tailMs: 300 },
    ]);
    expect(plan.scenes[0]?.budgetMs).toBe(1200 + 3000 + 300);
    expect(plan.scenes[0]?.narrationStartMs).toBe(1200);
  });

  test('fractional audio durations round up, never truncate', () => {
    const plan = planTimeline([{ id: 'a', audioDurationMs: 4000.4, minMs: 0 }]);
    expect(plan.scenes[0]?.budgetMs).toBe(
      DEFAULT_LEAD_IN_MS + 4001 + DEFAULT_TAIL_MS,
    );
  });

  test('negative audio duration throws', () => {
    expect(() => planTimeline([{ id: 'x', audioDurationMs: -1 }])).toThrow(
      /negative audio duration/,
    );
  });
});

describe('driftReport', () => {
  const plan = planTimeline([
    { id: 'a', audioDurationMs: 4000 },
    { id: 'b', audioDurationMs: 2000 },
  ]);

  test('reports signed drift per scene', () => {
    const report = driftReport(
      plan,
      new Map([
        ['a', 10],
        ['b', (plan.scenes[1]?.startMs ?? 0) - 40],
      ]),
    );
    expect(report.map((r) => r.driftMs)).toEqual([10, -40]);
  });

  test('a missing scene start is an error, not a zero', () => {
    expect(() => driftReport(plan, new Map([['a', 0]]))).toThrow(
      /No recorded start for scene "b"/,
    );
  });

  test('driftViolations flags only scenes over the budget', () => {
    const report = driftReport(
      plan,
      new Map([
        ['a', 99],
        ['b', (plan.scenes[1]?.startMs ?? 0) + 101],
      ]),
    );
    expect(driftViolations(report).map((r) => r.id)).toEqual(['b']);
  });
});
