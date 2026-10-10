// @vitest-environment node

import { describe, expect, it } from 'vitest';

import type { NodeRunRecord } from '../../../lib/engine/core/record/types.ts';
import {
  nodeRunBytes,
  nodeRunFromRow,
  nodeRunRowOf,
  startNodeRun,
} from './node-runs.ts';

const FULL: NodeRunRecord = {
  key: { path: 'parent[0:0]/child', item: 2, pass: 1 },
  nodeId: 'child',
  nodeType: 'transform',
  status: 'skipped',
  startedAt: 10,
  endedAt: 20,
  activeMs: 7,
  attempt: 2,
  attempts: [{ n: 1, startedAt: 5, endedAt: 9, outcome: 'interrupted' }],
  skip: { reason: 'error', via: ['a'] },
  failure: {
    code: 'node_error',
    reason: 'CODE_FAILED',
    params: { detail: 'boom' },
    message: 'boom',
    at: { pointer: '/nodes/1/code' },
  },
  input: {
    value: { q: 1 },
    summary: { kind: 'object', keys: 1, names: ['q'], bytes: 7 },
    shape: { type: 'object' },
    bytes: 7,
    hash: 'h',
  },
  decisions: [{ kind: 'onError', policy: 'continue', at: 20 }],
  waits: [{ kind: 'repeat', since: 11, until: 12 }],
  counts: { items: 3, ok: 2, failed: 1, skipped: 0, kept: 3 },
  meta: { docRef: 'child@2' },
};

describe('a record as its row', () => {
  it('reads back as the record it was written from', () => {
    expect(nodeRunFromRow(nodeRunRowOf(FULL))).toEqual(FULL);
  });

  it('keeps the columns a read filters on out of the record', () => {
    const row = nodeRunRowOf(FULL);
    expect(row).toMatchObject({
      path: 'parent[0:0]/child',
      item_index: 2,
      pass: 1,
      status: 'skipped',
      skip_reason: 'error',
      failure_code: 'node_error',
    });
    expect(Object.keys(row.record).sort()).toEqual([
      'attempts',
      'counts',
      'decisions',
      'failure',
      'meta',
      'via',
      'waits',
    ]);
  });

  it('reads a row with nothing but its columns', () => {
    expect(
      nodeRunFromRow({
        ...nodeRunRowOf({
          ...FULL,
          skip: undefined,
          failure: undefined,
          counts: undefined,
        }),
        record: {},
      }),
    ).toMatchObject({ attempts: [], decisions: [], waits: [], meta: {} });
  });
});

describe('the run input row', () => {
  it('records what the run was given, with its bytes', () => {
    const row = startNodeRun({ who: 'ada' }, 42);
    expect(row.record).toMatchObject({
      key: { path: '__start', item: -1, pass: -1 },
      nodeType: 'input',
      status: 'ok',
      startedAt: 42,
      endedAt: 42,
      output: { value: { who: 'ada' } },
    });
    expect(row.bytes).toBe(JSON.stringify({ who: 'ada' }).length);
    expect(nodeRunBytes([row, row])).toBe(row.bytes * 2);
    expect(nodeRunBytes(undefined)).toBe(0);
  });
});
