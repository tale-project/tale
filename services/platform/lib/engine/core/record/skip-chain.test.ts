// @vitest-environment node

import { describe, expect, it } from 'vitest';

import {
  failedAndContinued,
  nodeIdOfPath,
  siblingPath,
  skipChain,
} from './skip-chain';
import type { Decision, NodeRunRecord, StepFailure } from './types';

function row(path: string, extra: Partial<NodeRunRecord> = {}): NodeRunRecord {
  return {
    key: { path, item: -1, pass: -1 },
    nodeId: nodeIdOfPath(path),
    nodeType: 'transform',
    status: 'ok',
    activeMs: 1,
    attempt: 1,
    attempts: [],
    decisions: [],
    waits: [],
    meta: {},
    ...extra,
  };
}

function byPath(...records: NodeRunRecord[]): Map<string, NodeRunRecord> {
  return new Map(records.map((r) => [r.key.path, r]));
}

const whenFalse: Extract<Decision, { kind: 'when' }> = {
  kind: 'when',
  result: false,
  value: { kind: 'boolean', text: 'false' },
  trace: { pointer: '/nodes/0/when', units: [] },
  at: 10,
};

const failure: StepFailure = {
  code: 'node_error',
  reason: 'CODE_FAILED',
  params: {},
  message: 'boom',
};

describe('skipChain', () => {
  it('is empty for a step that ran', () => {
    expect(skipChain(byPath(row('a')), 'a')).toEqual([]);
  });

  it('names a step skipped by its own condition, with the decision', () => {
    const records = byPath(
      row('triage', {
        status: 'skipped',
        skip: { reason: 'when' },
        decisions: [whenFalse],
      }),
    );
    expect(skipChain(records, 'triage')).toEqual([
      { kind: 'when', nodeId: 'triage', path: 'triage', decision: whenFalse },
    ]);
  });

  it('follows the first skipped reference to the condition that was false', () => {
    // Ada's report reads the scores, which read the triage, whose
    // condition did not hold.
    const records = byPath(
      row('triage', {
        status: 'skipped',
        skip: { reason: 'when' },
        decisions: [whenFalse],
      }),
      row('score', {
        status: 'skipped',
        skip: { reason: 'upstream', via: ['triage'] },
      }),
      row('report', {
        status: 'skipped',
        skip: { reason: 'upstream', via: ['score', 'triage'] },
      }),
    );
    expect(skipChain(records, 'report')).toEqual([
      { kind: 'upstream', nodeId: 'report', path: 'report', via: 'score' },
      { kind: 'upstream', nodeId: 'score', path: 'score', via: 'triage' },
      { kind: 'when', nodeId: 'triage', path: 'triage', decision: whenFalse },
    ]);
  });

  it('ends at a step that failed and let the run go on', () => {
    const records = byPath(
      row('fetch', {
        status: 'failed',
        skip: { reason: 'error' },
        failure,
        decisions: [{ kind: 'onError', policy: 'continue', at: 5 }],
      }),
      row('send', {
        status: 'skipped',
        skip: { reason: 'upstream', via: ['fetch'] },
      }),
    );
    expect(skipChain(records, 'send')).toEqual([
      { kind: 'upstream', nodeId: 'send', path: 'send', via: 'fetch' },
      { kind: 'error', nodeId: 'fetch', path: 'fetch', failure },
    ]);
  });

  it('reads a failure the run went on past from its decision alone', () => {
    const records = byPath(
      row('fetch', {
        status: 'failed',
        decisions: [{ kind: 'onError', policy: 'continue', at: 5 }],
      }),
      row('send', {
        status: 'skipped',
        skip: { reason: 'upstream', via: ['fetch'] },
      }),
    );
    expect(skipChain(records, 'send').at(-1)).toEqual({
      kind: 'error',
      nodeId: 'fetch',
      path: 'fetch',
    });
  });

  it('names a stored skip with reason error as a failure', () => {
    const records = byPath(
      row('fetch', { status: 'skipped', skip: { reason: 'error' }, failure }),
    );
    expect(skipChain(records, 'fetch')).toEqual([
      { kind: 'error', nodeId: 'fetch', path: 'fetch', failure },
    ]);
  });

  it('names the partner of an alternative whose partner ran', () => {
    const records = byPath(
      row('approve', { decisions: [{ ...whenFalse, result: true }] }),
      row('reject', {
        status: 'skipped',
        skip: { reason: 'else' },
        decisions: [
          {
            kind: 'else',
            partner: 'approve',
            partnerSkippedByWhen: false,
            result: false,
            at: 11,
          },
        ],
      }),
    );
    expect(skipChain(records, 'reject')).toEqual([
      { kind: 'else', nodeId: 'reject', path: 'reject', partner: 'approve' },
    ]);
  });

  it('follows the partner of an alternative when the partner was skipped for another reason', () => {
    const records = byPath(
      row('fetch', {
        status: 'skipped',
        skip: { reason: 'when' },
        decisions: [whenFalse],
      }),
      row('approve', {
        status: 'skipped',
        skip: { reason: 'upstream', via: ['fetch'] },
      }),
      row('reject', {
        status: 'skipped',
        skip: { reason: 'else', via: ['approve'] },
      }),
    );
    expect(skipChain(records, 'reject')).toEqual([
      { kind: 'else', nodeId: 'reject', path: 'reject', partner: 'approve' },
      { kind: 'upstream', nodeId: 'approve', path: 'approve', via: 'fetch' },
      { kind: 'when', nodeId: 'fetch', path: 'fetch', decision: whenFalse },
    ]);
  });

  it('stops at a partner that failed: its condition held', () => {
    const records = byPath(
      row('approve', { status: 'failed', skip: { reason: 'error' } }),
      row('reject', {
        status: 'skipped',
        skip: { reason: 'else', via: ['approve'] },
      }),
    );
    expect(skipChain(records, 'reject')).toEqual([
      { kind: 'else', nodeId: 'reject', path: 'reject', partner: 'approve' },
    ]);
  });

  it('reads the skipped references from the upstream decision when the skip lists none', () => {
    const records = byPath(
      row('a', { status: 'skipped', skip: { reason: 'when' } }),
      row('b', {
        status: 'skipped',
        skip: { reason: 'upstream' },
        decisions: [{ kind: 'upstream', skipped: ['a'], at: 3 }],
      }),
    );
    expect(skipChain(records, 'b')).toEqual([
      { kind: 'upstream', nodeId: 'b', path: 'b', via: 'a' },
      { kind: 'when', nodeId: 'a', path: 'a' },
    ]);
  });

  it('follows steps inside the same subautomation walk', () => {
    const records = byPath(
      row('batch[1:0]/check', {
        status: 'skipped',
        skip: { reason: 'when' },
        decisions: [whenFalse],
      }),
      row('batch[1:0]/send', {
        status: 'skipped',
        skip: { reason: 'upstream', via: ['check'] },
      }),
      // The same step of another item ran.
      row('batch[0:0]/check'),
    );
    expect(skipChain(records, 'batch[1:0]/send')).toEqual([
      {
        kind: 'upstream',
        nodeId: 'send',
        path: 'batch[1:0]/send',
        via: 'check',
      },
      {
        kind: 'when',
        nodeId: 'check',
        path: 'batch[1:0]/check',
        decision: whenFalse,
      },
    ]);
  });

  it('follows a step that failed per item through its own record, not its items', () => {
    // The map holds each step's own record; an item row never stands in.
    const records = byPath(
      row('each', {
        status: 'failed',
        skip: { reason: 'error' },
        failure,
        counts: { items: 3, ok: 2, failed: 1, skipped: 0, kept: 3 },
      }),
      row('sum', {
        status: 'skipped',
        skip: { reason: 'upstream', via: ['each'] },
      }),
    );
    expect(skipChain(records, 'sum')).toEqual([
      { kind: 'upstream', nodeId: 'sum', path: 'sum', via: 'each' },
      { kind: 'error', nodeId: 'each', path: 'each', failure },
    ]);
  });

  it('ends on a malformed record that loops', () => {
    const records = byPath(
      row('a', { status: 'skipped', skip: { reason: 'upstream', via: ['b'] } }),
      row('b', { status: 'skipped', skip: { reason: 'upstream', via: ['a'] } }),
    );
    expect(skipChain(records, 'a')).toEqual([
      { kind: 'upstream', nodeId: 'a', path: 'a', via: 'b' },
      { kind: 'upstream', nodeId: 'b', path: 'b', via: 'a' },
    ]);
    const self = byPath(
      row('a', { status: 'skipped', skip: { reason: 'upstream', via: ['a'] } }),
    );
    expect(skipChain(self, 'a')).toHaveLength(1);
  });

  it('stays within the number of steps on a long chain', () => {
    const records = byPath(
      row('n0', { status: 'skipped', skip: { reason: 'when' } }),
      ...Array.from({ length: 40 }, (_, i) =>
        row(`n${i + 1}`, {
          status: 'skipped',
          skip: { reason: 'upstream', via: [`n${i}`] },
        }),
      ),
    );
    const chain = skipChain(records, 'n40');
    expect(chain).toHaveLength(41);
    expect(chain.at(-1)).toEqual({ kind: 'when', nodeId: 'n0', path: 'n0' });
  });

  it('ends where a referenced step has no record', () => {
    const records = byPath(
      row('b', { status: 'skipped', skip: { reason: 'upstream', via: ['a'] } }),
    );
    expect(
      skipChain(records, 'b', { status: 'failed', finished: true }),
    ).toEqual([{ kind: 'upstream', nodeId: 'b', path: 'b', via: 'a' }]);
  });

  it('ends at a record that ran though a reference named it skipped', () => {
    const records = byPath(
      row('a'),
      row('b', { status: 'skipped', skip: { reason: 'upstream', via: ['a'] } }),
    );
    expect(skipChain(records, 'b')).toEqual([
      { kind: 'upstream', nodeId: 'b', path: 'b', via: 'a' },
    ]);
  });

  it('says nothing for a skip whose record gives no reason', () => {
    expect(skipChain(byPath(row('a', { status: 'skipped' })), 'a')).toEqual([]);
    expect(
      skipChain(
        byPath(row('a', { status: 'skipped', skip: { reason: 'upstream' } })),
        'a',
      ),
    ).toEqual([]);
  });

  describe('a step the run never reached', () => {
    it('names where a failed run ended', () => {
      expect(
        skipChain(byPath(row('fetch')), 'send', {
          status: 'failed',
          finished: true,
          failedNode: 'fetch',
        }),
      ).toEqual([
        {
          kind: 'not_run',
          nodeId: 'send',
          path: 'send',
          stoppedAt: 'fetch',
          runStatus: 'failed',
        },
      ]);
    });

    it('names a stopped run, with or without the step it stopped at', () => {
      expect(
        skipChain(new Map(), 'batch[0:0]/send', {
          status: 'cancelled',
          finished: true,
        }),
      ).toEqual([
        {
          kind: 'not_run',
          nodeId: 'send',
          path: 'batch[0:0]/send',
          runStatus: 'cancelled',
        },
      ]);
    });

    it('says nothing for the step the run ended at', () => {
      expect(
        skipChain(new Map(), 'fetch', {
          status: 'failed',
          finished: true,
          failedNode: 'fetch',
        }),
      ).toEqual([]);
    });

    it('says nothing while the run goes on, or when it succeeded', () => {
      expect(
        skipChain(new Map(), 'send', { status: 'running', finished: false }),
      ).toEqual([]);
      expect(
        skipChain(new Map(), 'send', { status: 'success', finished: true }),
      ).toEqual([]);
      expect(skipChain(new Map(), 'send')).toEqual([]);
    });
  });
});

describe('paths', () => {
  it('reads the node id at the end of a path', () => {
    expect(nodeIdOfPath('send')).toBe('send');
    expect(nodeIdOfPath('batch[2:0]/inner[0:1]/send')).toBe('send');
  });

  it('places a sibling in the same walk', () => {
    expect(siblingPath('send', 'fetch')).toBe('fetch');
    expect(siblingPath('batch[2:0]/send', 'fetch')).toBe('batch[2:0]/fetch');
  });
});

describe('failedAndContinued', () => {
  it('holds for a stored error skip or a failure with an onError decision', () => {
    expect(failedAndContinued(row('a', { skip: { reason: 'error' } }))).toBe(
      true,
    );
    expect(
      failedAndContinued(
        row('a', {
          status: 'failed',
          decisions: [{ kind: 'onError', policy: 'continue', at: 1 }],
        }),
      ),
    ).toBe(true);
    expect(failedAndContinued(row('a', { status: 'failed' }))).toBe(false);
    expect(failedAndContinued(row('a'))).toBe(false);
  });
});
