import { describe, expect, it } from 'vitest';

import {
  cursorNodeStatus,
  isRunFinished,
  nodeStatusMap,
  projectRun,
  readEffects,
  readRunAgentRetry,
  readRunCursorNode,
  readRunParkNode,
  readRunStatus,
  runReasonKey,
} from './run-view';

/**
 * A run reaches the canvas in one of two shapes: the engine's finished
 * `trace`/`effects`, or the durable `checkpoints` the stepper writes node by
 * node while the run is still going. These tests hold both to the same
 * projection, and hold the effects list to being complete — an effect that
 * is summarised away is an audit record lost.
 */

const finishedRun = {
  status: 'success',
  trace: [
    { node: 'fetch', type: 'http.get', status: 'ok', output: { ok: true } },
    { node: 'notify', type: 'slack.post', status: 'ok', ms: 12 },
    { node: 'fallback', type: 'transform', status: 'skipped', note: 'else' },
  ],
  effects: [
    { node: 'notify', connector: 'slack.post', input: { text: 'hi' } },
    { node: 'notify', connector: 'slack.post', input: { text: 'again' } },
  ],
};

describe('projectRun', () => {
  it('reads a finished run from its trace and effects', () => {
    const projection = projectRun(finishedRun);
    expect(projection.byNode.get('fetch')?.status).toBe('ok');
    expect(projection.byNode.get('fetch')?.output).toEqual({ ok: true });
    expect(projection.byNode.get('fallback')?.status).toBe('skipped');
    expect(projection.effects).toHaveLength(2);
    expect(projection.byNode.get('notify')?.effects).toHaveLength(2);
  });

  it('keeps repeated effects of one node rather than collapsing them', () => {
    const projection = projectRun(finishedRun);
    expect(
      projection.byNode.get('notify')?.effects.map((e) => e.input),
    ).toEqual([{ text: 'hi' }, { text: 'again' }]);
  });

  it('reads a run in flight from the checkpoints written so far', () => {
    const projection = projectRun({
      status: 'running',
      checkpoints: {
        executions: 1,
        nodes: {
          fetch: {
            status: 'ok',
            output: { ok: true },
            trace: { node: 'fetch', type: 'http.get', status: 'ok' },
            effects: [
              { node: 'fetch', connector: 'http.get', input: { url: 'x' } },
            ],
          },
        },
      },
    });
    expect(projection.byNode.get('fetch')?.status).toBe('ok');
    expect(projection.effects).toEqual([
      { node: 'fetch', connector: 'http.get', input: { url: 'x' } },
    ]);
  });

  it('reads no run at all as an empty projection', () => {
    const projection = projectRun(null);
    expect(projection.byNode.size).toBe(0);
    expect(projection.effects).toEqual([]);
  });
});

/**
 * A stopped run is finished without a trace: the cancel leaves the
 * checkpoints (and the stepper's cursor) where they were. Reading only
 * `trace` for finished runs made every node of a stopped run "not reached
 * yet" and left the stale cursor "running now" (2026-09-26 evaluation, D-07).
 */
describe('a stopped run', () => {
  const stoppedRun = {
    status: 'cancelled',
    trace: null,
    effects: [],
    checkpoints: {
      executions: 2,
      cursor: { node: 'send' },
      nodes: {
        draft: {
          trace: {
            node: 'draft',
            type: 'llm',
            status: 'ok',
            output: 'Hello',
          },
          effects: [],
        },
      },
    },
  };

  it('keeps what ran and marks the node it was stopped on', () => {
    const projection = projectRun(stoppedRun);
    expect(projection.byNode.get('draft')?.status).toBe('ok');
    expect(projection.byNode.get('draft')?.output).toBe('Hello');
    expect(projection.byNode.get('send')?.status).toBe('stopped');
    const statuses = nodeStatusMap(
      projection,
      ['draft', 'send', 'archive'],
      readRunCursorNode(stoppedRun),
    );
    expect(statuses.get('draft')).toBe('ok');
    expect(statuses.get('send')).toBe('stopped');
    expect(statuses.get('archive')).toBe('pending');
  });

  it('never overrides a recorded outcome with the stale cursor', () => {
    const projection = projectRun({
      ...stoppedRun,
      checkpoints: { ...stoppedRun.checkpoints, cursor: { node: 'draft' } },
    });
    expect(projection.byNode.get('draft')?.status).toBe('ok');
  });

  it('answers no cursor node for any finished run', () => {
    expect(readRunCursorNode(stoppedRun)).toBeNull();
    expect(readRunCursorNode({ ...stoppedRun, status: 'running' })).toBe(
      'send',
    );
    expect(readRunCursorNode({ ...stoppedRun, status: 'failed' })).toBeNull();
  });

  it('leaves a run that failed or succeeded to its trace', () => {
    const projection = projectRun({
      ...finishedRun,
      checkpoints: stoppedRun.checkpoints,
    });
    expect(projection.byNode.has('send')).toBe(false);
    expect(projection.byNode.get('fetch')?.status).toBe('ok');
  });
});

describe('nodeStatusMap', () => {
  it('reports a node the run has not reached as pending', () => {
    const statuses = nodeStatusMap(projectRun(finishedRun), [
      'fetch',
      'notify',
      'later',
    ]);
    expect(statuses.get('fetch')).toBe('ok');
    expect(statuses.get('later')).toBe('pending');
  });
});

describe('readRunAgentRetry', () => {
  const retrying = {
    status: 'waiting',
    checkpoints: {
      nodes: {},
      cursor: { node: 'extract', agent: { execId: 'e2', attempt: 2 } },
      executions: 3,
    },
  };

  it('reads the attempt off a live run parked on a retried agent turn', () => {
    expect(readRunAgentRetry(retrying)).toBe(2);
  });

  it('reads null on the original attempt and off the agent park', () => {
    expect(
      readRunAgentRetry({
        ...retrying,
        checkpoints: {
          ...retrying.checkpoints,
          cursor: { node: 'extract', agent: { execId: 'e1' } },
        },
      }),
    ).toBeNull();
    expect(
      readRunAgentRetry({
        ...retrying,
        checkpoints: { nodes: {}, cursor: { node: 'wait' }, executions: 1 },
      }),
    ).toBeNull();
    expect(readRunAgentRetry(null)).toBeNull();
  });

  it('reads null on a finished run — the cursor is history there', () => {
    expect(readRunAgentRetry({ ...retrying, status: 'failed' })).toBeNull();
  });
});

describe('readRunStatus', () => {
  it('accepts the store statuses and refuses anything else', () => {
    expect(readRunStatus('waiting')).toBe('waiting');
    expect(readRunStatus('nonsense')).toBe('queued');
    expect(readRunStatus(undefined)).toBe('queued');
  });
});

describe('isRunFinished', () => {
  it('treats only the terminal statuses as finished', () => {
    expect(isRunFinished('success')).toBe(true);
    expect(isRunFinished('cancelled')).toBe(true);
    expect(isRunFinished('waiting')).toBe(false);
  });
});

describe('readEffects', () => {
  it('drops a record that names no node or no connector', () => {
    expect(
      readEffects([
        { node: 'a', connector: 'x', input: 1 },
        { node: 'a' },
        'nonsense',
      ]),
    ).toEqual([{ node: 'a', connector: 'x', input: 1 }]);
  });
});

describe('runReasonKey', () => {
  it('says a run waits for sandbox room in words, never the raw park', () => {
    expect(
      runReasonKey({
        status: 'waiting',
        detail: 'room:draft',
        waitingFor: 'room',
      }),
    ).toEqual({
      kind: 'waiting',
      key: 'runs.waiting.room',
      values: { node: 'draft' },
    });
    expect(
      runReasonKey({
        status: 'waiting',
        detail: 'agent:draft',
        waitingFor: 'agent',
      }),
    ).toEqual({
      kind: 'waiting',
      key: 'runs.waiting.agent',
      values: { node: 'draft' },
    });
  });

  it('says which step may already have run when a write waits for a person', () => {
    expect(
      runReasonKey({
        status: 'waiting',
        detail: 'in_doubt:send_invoice',
        waitingFor: 'in_doubt',
      }),
    ).toEqual({
      kind: 'waiting',
      key: 'runs.waiting.in_doubt',
      values: { node: 'send_invoice' },
    });
  });
});

describe('readRunParkNode', () => {
  it.each([
    ['repeat:tick', 'tick'],
    ['agent:draft', 'draft'],
    ['room:draft', 'draft'],
    ['in_doubt:send_invoice', 'send_invoice'],
  ])('reads the node off %s', (detail, node) => {
    expect(readRunParkNode(detail)).toBe(node);
  });

  it('reads nothing off an approval park or no detail', () => {
    expect(readRunParkNode('approval:appr-1')).toBeUndefined();
    expect(readRunParkNode(null)).toBeUndefined();
    expect(readRunParkNode(undefined)).toBeUndefined();
  });
});

/**
 * The node a live run is on spins only while something works on it: a
 * person's wait reads as waiting there, and a run whose server stopped as
 * interrupted there — the header badge and the canvas tell one story.
 */
describe('the node a live run is on', () => {
  const live = {
    checkpoints: {
      nodes: {},
      cursor: { node: 'send', index: 0, passes: 0, outs: [] },
    },
  };

  it.each([
    ['a step under way', { status: 'running' }, 'running'],
    ['a stalled run', { status: 'running', stalled: true }, 'interrupted'],
    [
      'a write that may already have happened',
      { status: 'waiting', waitingFor: 'in_doubt' },
      'waiting',
    ],
    ['an approval', { status: 'waiting', waitingFor: 'approval' }, 'waiting'],
    ['a question', { status: 'waiting', waitingFor: 'ask' }, 'waiting'],
    ['an agent turn', { status: 'waiting', waitingFor: 'agent' }, 'running'],
    ['a poll', { status: 'waiting', waitingFor: 'repeat' }, 'running'],
  ] as const)('reads %s on its node', (_case, fields, expected) => {
    const run = { ...live, ...fields };
    expect(cursorNodeStatus(run)).toBe(expected);
    const statuses = nodeStatusMap(
      projectRun(run),
      ['send', 'archive'],
      readRunCursorNode(run),
      cursorNodeStatus(run),
    );
    expect(statuses.get('send')).toBe(expected);
    expect(statuses.get('archive')).toBe('pending');
  });
});
