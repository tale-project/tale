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
    claimEpoch: 2,
    chainSeq: 4,
    startedAt: 1_789_190_000_000,
    finishedAt: null,
    askPending: false,
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

describe('toRunSummary', () => {
  it('carries waitingFor beside detail while waiting, and drops the raw ask fact', () => {
    const summary = toRunSummary(
      row({ detail: 'agent:review', askPending: true }),
    );
    expect(summary).toEqual({
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
    const detail = toRunDetail(row({ status: 'success', detail: null }));
    expect(detail).not.toHaveProperty('waitingFor');
    expect(detail).not.toHaveProperty('askPending');
    expect(detail.detail).toBeNull();
  });
});
