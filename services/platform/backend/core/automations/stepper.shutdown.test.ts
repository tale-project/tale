import { beforeEach, describe, expect, it, vi } from 'vitest';

import type { Automation } from '../../../lib/engine/core/types';
import { createShutdownState, type ShutdownState } from '../../lib/shutdown';
import { NodeFailure } from './failure';
import { ledgerKey } from './stepper.test-helpers.ts';
import { fakeStepperWorld } from './stepper.test-helpers.ts';
import { settleLiveTurns, stepRunImpl } from './stepper.ts';

// The model door, replaced: a suite decides what each call does.
const model = vi.hoisted(() => ({
  call: async (): Promise<Record<string, unknown>> => ({ text: 'a summary' }),
  calls: 0,
}));
vi.mock('./llm_call', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./llm_call')>();
  return {
    ...actual,
    automationLlmCall: () => async () => {
      model.calls += 1;
      return await model.call();
    },
  };
});

const RUN = { organizationId: 'org-1', runId: 'run-1' } as never;

/** The connector door's answer for a read that found `output`. */
function read(output: unknown) {
  return { status: 'ok', output, effects: 'read' };
}

/** The door's answer when the call was cut by the turn's signal: the shim
 * hands a connector's refusal over as a node failure. */
function interrupted(): never {
  throw new NodeFailure(
    'connector_error',
    'the call was interrupted because its server is shutting down',
  );
}

const THREE_READS = {
  version: 1,
  name: 'nightly-import',
  nodes: [
    { id: 'first', type: 'webdav.list', input: { path: '/a' } },
    { id: 'second', type: 'webdav.list', input: { path: '/b' } },
    { id: 'third', type: 'webdav.list', input: { path: '/c' } },
  ],
  output: '{{ nodes.third.output }}',
} as Automation;

let shutdown: ShutdownState;

beforeEach(() => {
  shutdown = createShutdownState();
  model.calls = 0;
  model.call = async () => ({ text: 'a summary' });
});

describe('a run whose server starts shutting down [AUTO-R22]', () => {
  it('hands the run on once, after the step it was on, and runs no later step', async () => {
    const world = fakeStepperWorld({
      document: THREE_READS,
      connector: async (args) => {
        if (args.input !== undefined && world.connectorCalls.length === 1) {
          shutdown.begin('SIGTERM', 20_000);
        }
        return read(['x.txt']);
      },
    });

    await expect(stepRunImpl(world.ctx, RUN, { shutdown })).resolves.toEqual({
      status: 'running',
    });

    expect(world.connectorCalls).toHaveLength(1);
    expect(world.progress.map((write) => write.nodeId)).toEqual(['first']);
    expect(world.continued).toEqual([
      expect.objectContaining({
        resumeInMs: 0,
        handoff: { reason: 'shutdown' },
      }),
    ]);
    expect(world.finished).toEqual([]);

    // The next server walks on from the step after it: the finished one
    // never runs again.
    await expect(
      stepRunImpl(world.ctx, RUN, { shutdown: createShutdownState() }),
    ).resolves.toEqual({ status: 'success' });
    expect(
      world.connectorCalls.map((call) => (call.input as { path: string }).path),
    ).toEqual(['/a', '/b', '/c']);
  });

  it('hands on before its first step when it is claimed during shutdown', async () => {
    const world = fakeStepperWorld({
      document: THREE_READS,
      connector: async () => read([]),
    });
    shutdown.begin('SIGTERM', 20_000);

    await expect(stepRunImpl(world.ctx, RUN, { shutdown })).resolves.toEqual({
      status: 'running',
    });

    expect(world.connectorCalls).toEqual([]);
    expect(world.progress).toEqual([]);
    expect(world.continued).toEqual([
      expect.objectContaining({ handoff: { reason: 'shutdown' } }),
    ]);
  });

  it('walks at least one step on a drained replica, so a stale drain read never bounces a run without a step', async () => {
    const world = fakeStepperWorld({
      document: THREE_READS,
      connector: async () => read([]),
    });

    await stepRunImpl(world.ctx, RUN, { shutdown, draining: () => true });

    expect(world.connectorCalls).toHaveLength(1);
    expect(world.continued).toEqual([
      expect.objectContaining({ handoff: { reason: 'shutdown' } }),
    ]);
  });

  it('hands on when its replica is drained for a deploy', async () => {
    let drained = false;
    const world = fakeStepperWorld({
      document: THREE_READS,
      connector: async () => {
        drained = true;
        return read([]);
      },
    });

    await stepRunImpl(world.ctx, RUN, { shutdown, draining: () => drained });

    expect(world.connectorCalls).toHaveLength(1);
    expect(world.continued).toEqual([
      expect.objectContaining({ handoff: { reason: 'shutdown' } }),
    ]);
  });

  it('hands a loop on at the item after the one it finished', async () => {
    const world = fakeStepperWorld({
      document: {
        ...THREE_READS,
        nodes: [
          {
            id: 'list',
            type: 'webdav.list',
            forEach: '{{ input.folders }}',
            input: { path: '{{ item }}' },
          },
        ],
        output: '{{ nodes.list.output }}',
      } as Automation,
      input: { folders: ['/a', '/b', '/c'] },
      connector: async (args) => {
        if (world.connectorCalls.length === 2) {
          shutdown.begin('SIGTERM', 20_000);
        }
        return read([args.input]);
      },
    });

    await stepRunImpl(world.ctx, RUN, { shutdown });

    expect(world.connectorCalls).toHaveLength(2);
    expect(world.progress.at(-1)?.cursor).toEqual({
      node: 'list',
      index: 2,
      passes: 0,
      outs: [[{ path: '/a' }], [{ path: '/b' }]],
    });
    expect(world.continued).toEqual([
      expect.objectContaining({
        handoff: { reason: 'shutdown', nodeId: 'list', itemIndex: 2 },
      }),
    ]);
  });
});

describe('a run claimed while its server is stopping [AUTO-R22]', () => {
  it('hands a loop it would resume on before its next item, keeping its place', async () => {
    // Noah's import had listed two of three folders when its last server
    // stopped; the step job lands on a server that is stopping too.
    const cursor = {
      node: 'list',
      index: 2,
      passes: 0,
      outs: [[{ path: '/a' }], [{ path: '/b' }]],
    };
    const world = fakeStepperWorld({
      document: {
        ...THREE_READS,
        nodes: [
          {
            id: 'list',
            type: 'webdav.list',
            forEach: '{{ input.folders }}',
            input: { path: '{{ item }}' },
          },
        ],
        output: '{{ nodes.list.output }}',
      } as Automation,
      input: { folders: ['/a', '/b', '/c'] },
      checkpoints: { nodes: {}, executions: 2, cursor },
      connector: async (args) => read([args.input]),
    });
    shutdown.begin('SIGTERM', 20_000);

    await expect(stepRunImpl(world.ctx, RUN, { shutdown })).resolves.toEqual({
      status: 'running',
    });

    expect(world.connectorCalls).toEqual([]);
    expect(world.continued).toEqual([
      expect.objectContaining({ handoff: { reason: 'shutdown' } }),
    ]);
    expect(world.run.checkpoints.cursor).toEqual(cursor);
  });
});

describe('a step still running when the shutdown grace runs out [AUTO-R22]', () => {
  it('is cut and handed on, neither failed nor recorded as done', async () => {
    const world = fakeStepperWorld({
      document: THREE_READS,
      connector: async () => {
        if (world.connectorCalls.length === 2) {
          shutdown.begin('SIGTERM', 0);
          interrupted();
        }
        return read([]);
      },
    });

    await expect(stepRunImpl(world.ctx, RUN, { shutdown })).resolves.toEqual({
      status: 'running',
    });

    expect(world.finished).toEqual([]);
    expect(world.progress.map((write) => write.nodeId)).toEqual(['first']);
    expect(world.continued).toEqual([
      expect.objectContaining({
        handoff: {
          reason: 'shutdown',
          nodeId: 'second',
          itemIndex: 0,
          interrupted: true,
        },
      }),
    ]);

    // The next server runs the cut step again.
    await expect(
      stepRunImpl(world.ctx, RUN, { shutdown: createShutdownState() }),
    ).resolves.toEqual({ status: 'success' });
    expect(
      world.connectorCalls.map((call) => (call.input as { path: string }).path),
    ).toEqual(['/a', '/b', '/b', '/c']);
  });

  it('keeps a cut write open, so the next server asks a person instead of sending it again', async () => {
    const world = fakeStepperWorld({
      document: {
        version: 1,
        name: 'invoices',
        nodes: [
          {
            id: 'send',
            type: 'webdav.write',
            forEach: '{{ input.numbers }}',
            input: { path: '{{ item }}', content: 'due' },
          },
        ],
        output: '{{ nodes.send.output }}',
      } as Automation,
      input: { numbers: ['a', 'b', 'c'] },
      connector: async (args) => {
        if (world.connectorCalls.length === 2) {
          shutdown.begin('SIGTERM', 0);
          interrupted();
        }
        return { status: 'ok', output: { sent: args.input }, effects: 'write' };
      },
    });

    await stepRunImpl(world.ctx, RUN, { shutdown });

    // The loop's place is saved at the cut item; the item before it is done.
    expect(world.progress.at(-1)?.cursor).toEqual(
      expect.objectContaining({ node: 'send', index: 1 }),
    );
    expect(world.ledger.get(ledgerKey('send', 0, 0))?.status).toBe('done');
    expect(world.ledger.get(ledgerKey('send', 1, 0))?.status).toBe('started');
    expect(world.continued).toEqual([
      expect.objectContaining({
        handoff: {
          reason: 'shutdown',
          nodeId: 'send',
          itemIndex: 1,
          interrupted: true,
        },
      }),
    ]);

    await expect(
      stepRunImpl(world.ctx, RUN, { shutdown: createShutdownState() }),
    ).resolves.toEqual({ status: 'running' });
    expect(world.connectorCalls).toHaveLength(2);
    expect(world.run.detail).toBe('in_doubt:send');
  });

  it('leaves a cut model call open, so the next server simply calls again', async () => {
    const world = fakeStepperWorld({
      document: {
        version: 1,
        name: 'summaries',
        nodes: [{ id: 'summary', type: 'llm', model: 'm', prompt: 'Sum up.' }],
        output: '{{ nodes.summary.output }}',
      } as Automation,
    });
    model.call = async () => {
      shutdown.begin('SIGTERM', 0);
      throw new Error('the provider request was aborted');
    };

    await stepRunImpl(world.ctx, RUN, { shutdown });

    expect(world.ledger.get(ledgerKey('summary', 0, 0))?.status).toBe(
      'started',
    );
    expect(world.finished).toEqual([]);

    model.call = async () => ({ text: 'a summary' });
    await expect(
      stepRunImpl(world.ctx, RUN, { shutdown: createShutdownState() }),
    ).resolves.toEqual({ status: 'success' });
    expect(model.calls).toBe(2);
  });
});

describe('a long loop', () => {
  it('saves its place every ten items, so a walker that dies loses at most ten', async () => {
    const folders = Array.from({ length: 25 }, (_, index) => `/f${index}`);
    const world = fakeStepperWorld({
      document: {
        ...THREE_READS,
        nodes: [
          {
            id: 'list',
            type: 'webdav.list',
            forEach: '{{ input.folders }}',
            input: { path: '{{ item }}' },
          },
        ],
        output: '{{ nodes.list.output }}',
      } as Automation,
      input: { folders },
      connector: async () => read([]),
    });

    await expect(stepRunImpl(world.ctx, RUN, { shutdown })).resolves.toEqual({
      status: 'success',
    });

    expect(
      world.progress
        .filter((write) => write.cursor !== undefined)
        .map((write) => (write.cursor as { index: number }).index),
    ).toEqual([10, 20]);
    expect(world.progress.at(-1)?.nodeId).toBe('list');
  });
});

describe('settleLiveTurns', () => {
  it('waits for the turns this process is stepping, at most as long as it is told', async () => {
    let release: () => void = () => {};
    const world = fakeStepperWorld({
      document: THREE_READS,
      connector: () =>
        new Promise((resolve) => {
          release = () => resolve(read([]));
        }),
    });

    const turn = stepRunImpl(world.ctx, RUN, { shutdown });
    await vi.waitFor(() => expect(world.connectorCalls).toHaveLength(1));
    shutdown.begin('SIGTERM', 20_000);

    await expect(settleLiveTurns(5)).resolves.toBe(1);
    release();
    await expect(settleLiveTurns(1_000)).resolves.toBe(0);
    await expect(turn).resolves.toEqual({ status: 'running' });
    expect(world.continued).toHaveLength(1);
  });
});

describe('a turn whose body ignores its cut', () => {
  it('stops renewing its lease soon after the cut, so another worker can take the run over [AUTO-R16]', async () => {
    vi.useFakeTimers();
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      const job = new AbortController();
      // A connector body that never returns and never looks at the signal.
      const world = fakeStepperWorld({
        document: THREE_READS,
        connector: () => new Promise(() => undefined),
      });
      void stepRunImpl(world.ctx, RUN, { shutdown, signal: job.signal });

      await vi.advanceTimersByTimeAsync(25_000);
      expect(world.heartbeats).toBe(2);

      // The job queue gives up on the job: the turn is cut, the body hangs.
      job.abort(new Error('the job expired'));
      await vi.advanceTimersByTimeAsync(30_000);
      expect(world.heartbeats).toBe(5);
      await vi.advanceTimersByTimeAsync(60_000);
      expect(world.heartbeats).toBe(5);
      expect(warn).toHaveBeenCalledWith(
        expect.stringContaining('no longer renewing its lease'),
      );
    } finally {
      warn.mockRestore();
      vi.useRealTimers();
    }
  });
});
