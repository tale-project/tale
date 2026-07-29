import { describe, expect, it } from 'vitest';

import {
  isRunFinished,
  nodeStatusMap,
  projectRun,
  readEffects,
  readRunStatus,
  visitedNodeIds,
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
    { node: 'notify', integration: 'slack.post', input: { text: 'hi' } },
    { node: 'notify', integration: 'slack.post', input: { text: 'again' } },
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
              { node: 'fetch', integration: 'http.get', input: { url: 'x' } },
            ],
          },
        },
      },
    });
    expect(projection.byNode.get('fetch')?.status).toBe('ok');
    expect(projection.effects).toEqual([
      { node: 'fetch', integration: 'http.get', input: { url: 'x' } },
    ]);
  });

  it('reads no run at all as an empty projection', () => {
    const projection = projectRun(null);
    expect(projection.byNode.size).toBe(0);
    expect(projection.effects).toEqual([]);
  });
});

describe('visitedNodeIds', () => {
  it('keeps every visited node — skipped included — and adds the cursor', () => {
    // A hidden skipped node would sever the drawn path exactly where a
    // condition turned, so `fallback` must stay in.
    const ids = visitedNodeIds(projectRun(finishedRun), 'next');
    expect(ids).toEqual(new Set(['fetch', 'notify', 'fallback', 'next']));
  });

  it('leaves out nodes a finished run never reached', () => {
    const projection = projectRun({
      status: 'failed',
      trace: [
        { node: 'fetch', type: 'http.get', status: 'ok' },
        { node: 'later', type: 'transform', status: 'not_run' },
      ],
      effects: [],
    });
    expect(visitedNodeIds(projection)).toEqual(new Set(['fetch']));
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
  it('drops a record that names no node or no integration', () => {
    expect(
      readEffects([
        { node: 'a', integration: 'x', input: 1 },
        { node: 'a' },
        'nonsense',
      ]),
    ).toEqual([{ node: 'a', integration: 'x', input: 1 }]);
  });
});
