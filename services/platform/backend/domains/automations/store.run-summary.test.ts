// @vitest-environment node

/**
 * The run read model's `waitingFor` (run-lifecycle class): `status:
 * waiting` covers a person's decision AND the engine's own parks (an agent
 * turn in flight, a node polling until its condition holds), and a client
 * used to have to filter on the undocumented `detail` prefix to tell them
 * apart. The field is derived from the park's detail, with the one fact the
 * detail cannot carry — whether an `agent:` park's question is pending —
 * read beside the row; it is present only while waiting, and the raw ask
 * fact never reaches the wire.
 */

import { describe, expect, it } from 'vitest';

import {
  type RunRow,
  runLastResume,
  runStartedVia,
  runWaitingFor,
  toRunDetail,
  toRunSummary,
} from './store.ts';

function row(overrides: Partial<RunRow> = {}): RunRow {
  return {
    id: 'run-1',
    organizationId: 'org_1',
    name: 'ops/greet',
    version: 3,
    projectId: null,
    status: 'waiting',
    mode: 'live',
    startedBy: 'trigger:t-1',
    input: '{}',
    output: null,
    checkpoints: { nodes: {}, executions: 1 },
    trace: null,
    effects: null,
    detail: 'agent:review',
    failureCode: null,
    claimEpoch: 2,
    chainSeq: 4,
    startedAt: 1_789_190_000_000,
    finishedAt: null,
    askPending: false,
    resumeCount: 0,
    lastResumeReason: null,
    lastResumedAt: null,
    stalled: false,
    ...overrides,
  };
}

describe('runWaitingFor', () => {
  it.each([
    ['approval:appr-9', false, 'approval'],
    ['approval:node-x', true, 'approval'],
    ['repeat:slow', false, 'repeat'],
    ['repeat:slow', true, 'repeat'],
    ['agent:review', false, 'agent'],
    ['agent:review', true, 'ask'],
    ['room:review', false, 'room'],
    ['in_doubt:send_invoice', false, 'in_doubt'],
    ['in_doubt:send_invoice', true, 'in_doubt'],
  ] as const)(
    'reads %s (ask pending: %s) as %s',
    (detail, askPending, expected) => {
      expect(runWaitingFor(row({ detail, askPending }))).toBe(expected);
    },
  );

  it('answers nothing off a waiting run whose detail names no park', () => {
    expect(runWaitingFor(row({ detail: null }))).toBeUndefined();
    expect(runWaitingFor(row({ detail: 'something else' }))).toBeUndefined();
  });

  it.each(['queued', 'running', 'success', 'failed', 'cancelled'])(
    'answers nothing while the status is %s, whatever the detail says',
    (status) => {
      expect(
        runWaitingFor(
          row({ status, detail: 'approval:appr-9', askPending: true }),
        ),
      ).toBeUndefined();
    },
  );
});

/**
 * `startedVia` — which KIND of trigger started a `trigger:<id>` run, read off
 * the run's own input (each trigger door writes `{trigger: <kind>}`), so a
 * listing tells a scheduled run from a webhook delivery, and an old run
 * stays true after its binding changes kind (2026-09-26 evaluation, D-08).
 */
describe('runStartedVia', () => {
  it.each(['schedule', 'webhook', 'event'] as const)(
    'reads %s off a trigger run’s input',
    (kind) => {
      expect(
        runStartedVia(
          row({
            startedBy: 'trigger:t-1',
            input: JSON.stringify({ trigger: kind, payload: {} }),
          }),
        ),
      ).toBe(kind);
    },
  );

  it('reads an input the row stores decoded as well as encoded', () => {
    expect(
      runStartedVia(
        row({ startedBy: 'trigger:t-1', input: { trigger: 'schedule' } }),
      ),
    ).toBe('schedule');
  });

  it('answers nothing off a person’s or a key’s run, whatever the input says', () => {
    const input = JSON.stringify({ trigger: 'schedule' });
    expect(
      runStartedVia(row({ startedBy: 'user:u-1', input })),
    ).toBeUndefined();
    expect(
      runStartedVia(row({ startedBy: 'api-key:u-1', input })),
    ).toBeUndefined();
    expect(runStartedVia(row({ startedBy: 'u-1', input }))).toBeUndefined();
  });

  it('answers nothing off a trigger run whose input names no known kind', () => {
    expect(
      runStartedVia(row({ startedBy: 'trigger:t-1', input: '{}' })),
    ).toBeUndefined();
    expect(
      runStartedVia(
        row({ startedBy: 'trigger:t-1', input: '{"trigger":"cron"}' }),
      ),
    ).toBeUndefined();
    expect(
      runStartedVia(row({ startedBy: 'trigger:t-1', input: 'not json' })),
    ).toBeUndefined();
    expect(
      runStartedVia(row({ startedBy: 'trigger:t-1', input: null })),
    ).toBeUndefined();
  });
});

describe('toRunSummary', () => {
  it('carries startedVia on a trigger run and omits it otherwise', () => {
    const scheduled = toRunSummary(
      row({
        status: 'success',
        detail: null,
        startedBy: 'trigger:t-1',
        input: '{"trigger":"webhook","payload":{}}',
        finishedAt: 1,
      }),
    );
    expect(scheduled.startedVia).toBe('webhook');
    const manual = toRunSummary(
      row({ status: 'success', detail: null, startedBy: 'user:u-1' }),
    );
    expect(manual).not.toHaveProperty('startedVia');
  });

  it('carries waitingFor beside detail while waiting, and drops the raw ask fact', () => {
    const summary = toRunSummary(
      row({ detail: 'agent:review', askPending: true }),
    );
    expect(summary).toEqual({
      id: 'run-1',
      runId: 'run-1',
      name: 'ops/greet',
      version: 3,
      projectId: null,
      status: 'waiting',
      mode: 'live',
      startedBy: 'trigger:t-1',
      detail: 'agent:review',
      waitingFor: 'ask',
      startedAt: 1_789_190_000_000,
    });
    expect('askPending' in summary).toBe(false);
  });

  it('omits waitingFor on a finished run', () => {
    const summary = toRunSummary(
      row({
        status: 'failed',
        detail: 'the model returned no text content',
        finishedAt: 1_789_190_060_000,
      }),
    );
    expect(summary).not.toHaveProperty('waitingFor');
    expect(summary.detail).toBe('the model returned no text content');
    expect(summary.finishedAt).toBe(1_789_190_060_000);
  });

  // The stable cause rides beside the sentence on a failed run, and is
  // absent — not null — everywhere else (2026-09-14 evaluation, g5-3).
  it('carries failureCode on a failed run and omits it otherwise', () => {
    const failed = toRunSummary(
      row({
        status: 'failed',
        detail: 'llm: credit exhausted',
        failureCode: 'credit_exhausted',
        finishedAt: 1_789_190_060_000,
      }),
    );
    expect(failed.failureCode).toBe('credit_exhausted');
    const ok = toRunSummary(
      row({ status: 'success', detail: null, finishedAt: 1 }),
    );
    expect(ok).not.toHaveProperty('failureCode');
  });
});

describe('toRunDetail', () => {
  it('answers the full row with waitingFor and without askPending', () => {
    const detail = toRunDetail(
      row({ detail: 'repeat:slow', askPending: false }),
    );
    expect(detail).toMatchObject({
      id: 'run-1',
      status: 'waiting',
      detail: 'repeat:slow',
      waitingFor: 'repeat',
      claimEpoch: 2,
      chainSeq: 4,
    });
    expect('askPending' in detail).toBe(false);
  });

  it('answers a terminal row unchanged bar the ask fact', () => {
    const detail = toRunDetail(
      row({ status: 'success', detail: null, startedBy: 'user:u-1' }),
    );
    expect(detail).not.toHaveProperty('waitingFor');
    expect(detail).not.toHaveProperty('startedVia');
    expect(detail).not.toHaveProperty('askPending');
    expect(detail.detail).toBeNull();
  });

  it('carries startedVia beside the full row of a trigger run', () => {
    const detail = toRunDetail(
      row({
        status: 'success',
        detail: null,
        input: '{"trigger":"schedule","firedAt":1}',
      }),
    );
    expect(detail.startedVia).toBe('schedule');
    expect(detail.input).toBe('{"trigger":"schedule","firedAt":1}');
  });
});

/**
 * Whether and why a run moved between servers: a run that never did reads
 * exactly as before (no key at all on a summary), the two raw stamps travel
 * as one `lastResume` or not at all, and nothing about the server that held
 * it — its owner, host or process — is ever a field.
 */
describe('a run handed to another server on the wire [AUTO-R18]', () => {
  const handedOn = {
    status: 'running',
    detail: null,
    resumeCount: 2,
    lastResumeReason: 'lease_expired' as const,
    lastResumedAt: 1_789_190_030_000,
  };

  it('leaves the summary of a run that never moved unchanged', () => {
    const summary = toRunSummary(row({ status: 'running', detail: null }));
    expect(summary).not.toHaveProperty('resumeCount');
    expect(summary).not.toHaveProperty('lastResume');
    expect(summary).not.toHaveProperty('stalled');
  });

  it('carries the count and the last move on a summary once it moved', () => {
    const summary = toRunSummary(row(handedOn));
    expect(summary.resumeCount).toBe(2);
    expect(summary.lastResume).toEqual({
      reason: 'lease_expired',
      at: 1_789_190_030_000,
    });
    expect(summary).not.toHaveProperty('stalled');
    expect(summary).not.toHaveProperty('lastResumeReason');
    expect(summary).not.toHaveProperty('lastResumedAt');
  });

  it('marks a summary stalled only while it is', () => {
    expect(toRunSummary(row({ ...handedOn, stalled: true })).stalled).toBe(
      true,
    );
    expect(
      toRunSummary(row({ ...handedOn, stalled: false })),
    ).not.toHaveProperty('stalled');
  });

  it('answers the full row with the count, the stall and one lastResume', () => {
    const detail = toRunDetail(row({ ...handedOn, stalled: true }));
    expect(detail).toMatchObject({
      resumeCount: 2,
      stalled: true,
      lastResume: { reason: 'lease_expired', at: 1_789_190_030_000 },
    });
    expect(detail).not.toHaveProperty('lastResumeReason');
    expect(detail).not.toHaveProperty('lastResumedAt');
    const never = toRunDetail(row({ status: 'running', detail: null }));
    expect(never).toMatchObject({ resumeCount: 0, stalled: false });
    expect(never).not.toHaveProperty('lastResume');
  });

  it('names no server, host or process anywhere', () => {
    for (const answer of [
      toRunSummary(row({ ...handedOn, stalled: true })),
      toRunDetail(row({ ...handedOn, stalled: true })),
    ]) {
      expect(
        Object.keys(answer).filter((key) =>
          /owner|instance|engine|host|pid|lease/i.test(key),
        ),
      ).toEqual([]);
    }
  });
});

describe('runLastResume', () => {
  it.each(['shutdown', 'lease_expired'] as const)(
    'reads a %s move with its time',
    (reason) => {
      expect(
        runLastResume({ lastResumeReason: reason, lastResumedAt: 5 }),
      ).toEqual({ reason, at: 5 });
    },
  );

  it('answers nothing without both stamps', () => {
    expect(
      runLastResume({ lastResumeReason: null, lastResumedAt: 5 }),
    ).toBeUndefined();
    expect(
      runLastResume({ lastResumeReason: 'shutdown', lastResumedAt: null }),
    ).toBeUndefined();
  });
});
