import {
  projectDispatchSchema,
  type ProjectDispatch,
  type ProjectDispatchGate,
} from '@tale/shared/schemas/project-dispatch';
import { describe, expect, it } from 'vitest';

import {
  applyGateReport,
  gateCandidates,
  gateGoverns,
  gateRecoverBelow,
  judgeGate,
  type GateState,
} from './dispatch-gates.ts';

const ci: ProjectDispatchGate = {
  key: 'ci',
  labels: ['ci'],
  holdAt: 20,
};

function state(fields: Partial<GateState> = {}): GateState {
  return {
    held: false,
    value: null,
    reason: null,
    reportedAt: 1_000,
    reportedBy: 'api-key:ci-watcher',
    lastStartAt: null,
    ...fields,
  };
}

describe('a gate holds the ready work it governs while an outside signal says so [TASK-R51]', () => {
  it('holds at its hold value and opens only below its recover value', () => {
    expect(gateRecoverBelow(ci)).toBe(10);
    expect(applyGateReport(ci, false, { value: 23 })).toEqual({ held: true });
    // Below the hold value but not below the recover value: still held.
    expect(applyGateReport(ci, true, { value: 14 })).toEqual({ held: true });
    expect(applyGateReport(ci, true, { value: 9 })).toEqual({ held: false });
    // Never held: a value between the two does not hold.
    expect(applyGateReport(ci, false, { value: 14 })).toEqual({ held: false });
    expect(
      applyGateReport({ ...ci, recoverBelow: 18 }, true, { value: 17 }),
    ).toEqual({ held: false });
  });

  it('takes a reported state as it is, and refuses a value on a gate that judges none', () => {
    const freeze: ProjectDispatchGate = { key: 'freeze' };
    expect(applyGateReport(freeze, false, { state: 'hold' })).toEqual({
      held: true,
    });
    expect(applyGateReport(freeze, true, { state: 'open' })).toEqual({
      held: false,
    });
    expect(applyGateReport(freeze, false, { value: 3 })).toEqual({
      refused: 'value_without_threshold',
    });
  });

  it('governs the work carrying one of its labels, or all ready work without labels', () => {
    expect(gateGoverns(ci, ['label-ci'], ['label-docs', 'label-ci'])).toBe(
      true,
    );
    expect(gateGoverns(ci, ['label-ci'], ['label-docs'])).toBe(false);
    expect(gateGoverns({ key: 'freeze' }, [], [])).toBe(true);
  });

  it('reads a report older than its stale window as stale, and then does what it declares', () => {
    const now = 1_000 + 601_000;
    expect(judgeGate(ci, state({ held: true }), 1_000 + 60_000)).toMatchObject({
      held: true,
      stale: false,
    });
    // Ten minutes by default: a held gate nobody repeats opens again.
    expect(judgeGate(ci, state({ held: true }), now)).toMatchObject({
      held: false,
      stale: true,
    });
    expect(
      judgeGate({ ...ci, whenStale: 'hold' }, state({ held: false }), now),
    ).toMatchObject({ held: true, stale: true });
    // Never reported: stale from the start.
    expect(judgeGate({ ...ci, whenStale: 'hold' }, undefined, 0)).toMatchObject(
      { held: true, stale: true },
    );
    expect(judgeGate(ci, undefined, 0)).toMatchObject({
      held: false,
      stale: true,
    });
  });

  it('spaces the starts of the work it governs', () => {
    const spaced = { ...ci, startSpacingSeconds: 1_800 };
    expect(
      judgeGate(spaced, state({ lastStartAt: 10_000 }), 20_000).spacedUntil,
    ).toBe(10_000 + 1_800_000);
    expect(
      judgeGate(spaced, state({ lastStartAt: 10_000 }), 1_810_000).spacedUntil,
    ).toBeNull();
    expect(
      judgeGate(ci, state({ lastStartAt: 10_000 }), 20_000).spacedUntil,
    ).toBeNull();
  });

  it('refuses a gate that recovers above its hold value, recovers without one, or repeats a key', () => {
    const dispatch: ProjectDispatch = {
      enabled: true,
      agents: ['scribe'],
      maxConcurrentRuns: 1,
      statuses: ['todo'],
      assignment: 'assigned',
    };
    expect(
      projectDispatchSchema.safeParse({
        ...dispatch,
        gates: [{ key: 'ci', holdAt: 10, recoverBelow: 12 }],
      }).success,
    ).toBe(false);
    expect(
      projectDispatchSchema.safeParse({
        ...dispatch,
        gates: [{ key: 'ci', recoverBelow: 12 }],
      }).success,
    ).toBe(false);
    expect(
      projectDispatchSchema.safeParse({
        ...dispatch,
        gates: [{ key: 'ci' }, { key: 'ci', holdAt: 5 }],
      }).success,
    ).toBe(false);
    expect(
      projectDispatchSchema.safeParse({ ...dispatch, gates: [ci] }).success,
    ).toBe(true);
  });

  it('leaves the work a held gate governs out of the pass and lets the rest take part', () => {
    const candidate = (taskId: string, labelIds: string[]) => ({
      taskId,
      assigneeAgentId: null,
      labelIds,
    });
    const result = gateCandidates({
      gates: [ci],
      states: new Map([['ci', state({ held: true, reportedAt: 0 })]]),
      gateLabelIds: new Map([['ci', ['label-ci']]]),
      candidates: [
        candidate('release-build', ['label-ci']),
        candidate('faq', []),
      ],
      now: 60_000,
    });
    expect(result.open.map((task) => task.taskId)).toEqual(['faq']);
    expect(result.held).toEqual([
      { taskId: 'release-build', agentId: null, reason: 'gate:ci' },
    ]);
  });

  it('lets one start of a spaced gate’s work through per spacing, the best-ranked first, without holding the rest', () => {
    const spaced: ProjectDispatchGate = {
      key: 'ci',
      labels: ['ci'],
      startSpacingSeconds: 1_800,
    };
    const candidate = (taskId: string, labelIds: string[]) => ({
      taskId,
      assigneeAgentId: null,
      labelIds,
    });
    const candidates = [
      candidate('build-1', ['label-ci']),
      candidate('build-2', ['label-ci']),
      candidate('faq', []),
    ];
    const gateLabelIds = new Map([['ci', ['label-ci']]]);
    const free = gateCandidates({
      gates: [spaced],
      states: new Map([['ci', state({ lastStartAt: 0 })]]),
      gateLabelIds,
      candidates,
      now: 1_800_000,
    });
    expect(free.open.map((task) => task.taskId)).toEqual(['build-1', 'faq']);
    expect(free.held).toEqual([
      { taskId: 'build-2', agentId: null, reason: 'gate_spacing' },
    ]);
    // Within the spacing, none of its work takes part; the rest still does.
    const spacing = gateCandidates({
      gates: [spaced],
      states: new Map([['ci', state({ lastStartAt: 1_000_000 })]]),
      gateLabelIds,
      candidates,
      now: 1_800_000,
    });
    expect(spacing.open.map((task) => task.taskId)).toEqual(['faq']);
  });
});
