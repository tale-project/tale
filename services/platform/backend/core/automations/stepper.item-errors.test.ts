// @vitest-environment node

/**
 * A `forEach` step that goes on past its failed items (`onItemError:
 * continue`) in the durable stepper, across turns: a budget of zero hands the
 * run on after every item, so the items that failed must travel in the
 * cursor from one turn to the next.
 */

import { afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { unitKeyOf } from '../../../lib/engine/core/record/recorder';
import { setCodeRunner } from '../../../lib/engine/core/runner';
import type { Automation, NodeDef } from '../../../lib/engine/core/types';
import { nodeVmRunner } from '../../../lib/engine/runners/node-vm';
import { createShutdownState } from '../../lib/shutdown';
import { NodeFailure } from './failure.ts';
import {
  fakeStepperWorld,
  ledgerKey,
  type FakeAttempt,
  type FakeWorld,
} from './stepper.test-helpers.ts';
import { stepRunImpl } from './stepper.ts';

const RUN = { organizationId: 'org-1', runId: 'run-1' } as never;

beforeAll(() => {
  setCodeRunner(nodeVmRunner());
});

let budget: string | undefined;
beforeEach(() => {
  budget = process.env.TALE_AUTOMATION_STEP_BUDGET_MS;
  process.env.TALE_AUTOMATION_STEP_BUDGET_MS = '0';
});
afterEach(() => {
  if (budget === undefined) delete process.env.TALE_AUTOMATION_STEP_BUDGET_MS;
  else process.env.TALE_AUTOMATION_STEP_BUDGET_MS = budget;
});

/** A document whose `fan` step fails the items named "bad". */
function document(extra: Partial<NodeDef> = {}): Automation {
  return {
    version: 1,
    name: 'fan-out',
    nodes: [
      {
        id: 'fan',
        type: 'transform',
        forEach: '{{ input.items }}',
        onItemError: 'continue',
        code: "if (item === 'bad') throw new Error('this item is broken'); return { done: item };",
        ...extra,
      },
      {
        id: 'count',
        type: 'transform',
        input: { outs: '{{ nodes.fan.output }}' },
        code: 'return input.outs.filter((out) => out !== null).length;',
      },
    ],
    output: {
      outs: '{{ nodes.fan.output }}',
      count: '{{ nodes.count.output }}',
    },
  };
}

/** The record of one unit, the way the store keys it. */
function unit(world: FakeWorld, path: string, item = -1) {
  return world.nodeRuns.get(unitKeyOf({ path, item, pass: -1 }));
}

async function runToTheEnd(world: FakeWorld): Promise<Record<string, unknown>> {
  for (let turn = 0; turn < 30 && world.finished.length === 0; turn++) {
    await stepRunImpl(world.ctx, RUN);
    world.run.status = 'running';
  }
  expect(world.finished, 'the run finished').toHaveLength(1);
  return world.finished[0] ?? {};
}

describe('onItemError: continue in the durable stepper [AUTO-R70]', () => {
  it('keeps the items that succeeded across turns, null for the failed ones', async () => {
    const world = fakeStepperWorld({
      document: document(),
      mode: 'mock',
      input: { items: ['a', 'bad', 'c', 'bad', 'e'] },
    });
    const finished = await runToTheEnd(world);
    expect(finished.status).toBe('success');
    expect(finished.output).toEqual({
      outs: [{ done: 'a' }, null, { done: 'c' }, null, { done: 'e' }],
      count: 3,
    });
    // The run was handed on between items, so it took several turns.
    expect(world.continued.length).toBeGreaterThan(1);
    const fan = unit(world, 'fan');
    expect(fan?.status).toBe('ok');
    expect(unit(world, 'fan', 1)?.status).toBe('failed');
    expect(unit(world, 'fan', 3)?.status).toBe('failed');
    expect(unit(world, 'fan', 4)?.status).toBe('ok');
  });

  it('carries the failed items in the cursor it saves between turns', async () => {
    const world = fakeStepperWorld({
      document: document(),
      mode: 'mock',
      input: { items: ['bad', 'b', 'c'] },
    });
    await runToTheEnd(world);
    const cursors = world.progress
      .map((write) => write.cursor)
      .filter((cursor) => cursor !== undefined);
    expect(cursors).toContainEqual(
      expect.objectContaining({ node: 'fan', failed: [0] }),
    );
  });

  it('fails the step when every item failed, even in different turns', async () => {
    const world = fakeStepperWorld({
      document: document(),
      mode: 'mock',
      input: { items: ['bad', 'bad', 'bad'] },
    });
    const finished = await runToTheEnd(world);
    expect(finished.status).toBe('failed');
    expect(String(finished.detail)).toContain('this item is broken');
  });

  it('leaves the step skipped, and the run going, when onError says continue', async () => {
    const world = fakeStepperWorld({
      document: document({ onError: 'continue' }),
      mode: 'mock',
      input: { items: ['bad', 'bad'] },
    });
    const finished = await runToTheEnd(world);
    expect(finished.status).toBe('success');
    expect(unit(world, 'fan')?.status).toBe('skipped');
    expect(unit(world, 'count')?.status).toBe('skipped');
  });
});

/**
 * What stops a run is never an item's failure: a write that may already have
 * happened parks the run on its item, a walker that lost its claim stops, and
 * a server shutting down hands the run on — with `onItemError: continue` as
 * without it, and with no item recorded as failed.
 */
describe('onItemError: continue never takes what stops a run for a failed item [AUTO-R70]', () => {
  // These walk whole turns: the default budget, not one item a turn.
  beforeEach(() => {
    delete process.env.TALE_AUTOMATION_STEP_BUDGET_MS;
  });

  /** A live write over three files, going on past a failed item. */
  const writes = (): Automation => ({
    version: 1,
    name: 'invoices',
    nodes: [
      {
        id: 'send',
        type: 'webdav.write',
        forEach: '{{ input.files }}',
        onItemError: 'continue',
        input: { path: '{{ item }}', content: 'due' },
      },
    ],
    output: '{{ nodes.send.output }}',
  });

  /** A ledger row for one item of the write, as an earlier walker left it. */
  function seed(
    world: FakeWorld,
    itemIndex: number,
    over: Partial<FakeAttempt> = {},
  ): FakeAttempt {
    const row: FakeAttempt = {
      id: `seeded-send-${itemIndex}`,
      nodeId: 'send',
      itemIndex,
      pass: 0,
      attempt: 1,
      kind: 'connector',
      status: 'started',
      ...over,
    };
    world.ledger.set(ledgerKey('send', itemIndex, 0), row);
    return row;
  }

  it('parks on the item whose write may already have happened', async () => {
    const world = fakeStepperWorld({
      document: writes(),
      input: { files: ['a', 'b', 'c'] },
    });
    seed(world, 0, { status: 'done', output: { sent: 'a' } });
    const open = seed(world, 1);

    await expect(stepRunImpl(world.ctx, RUN)).resolves.toEqual({
      status: 'running',
    });
    expect(world.connectorCalls).toEqual([]);
    expect(world.finished).toEqual([]);
    expect(world.suspended).toEqual([
      expect.objectContaining({
        detail: 'in_doubt:send',
        cursor: { node: 'send', index: 1, passes: 0, outs: [{ sent: 'a' }] },
        event: {
          kind: 'in_doubt',
          detail: { path: 'send', itemIndex: 1, pass: 0, attemptId: open.id },
        },
      }),
    ]);
    expect(unit(world, 'send', 1)?.status).not.toBe('failed');
  });

  it('stops, writing nothing, once another walker holds the run', async () => {
    const world = fakeStepperWorld({
      document: writes(),
      input: { files: ['a', 'b', 'c'] },
    });
    world.afterClaim = () => {
      world.run.epoch += 1;
    };
    await expect(stepRunImpl(world.ctx, RUN)).resolves.toEqual({
      status: 'cancelled',
    });
    expect(world.connectorCalls).toEqual([]);
    expect(world.finished).toEqual([]);
    // It stopped at its first item rather than trying the others.
    expect(world.begins).toHaveLength(1);
    expect(unit(world, 'send', 0)?.status).not.toBe('failed');
  });

  it('hands the run on at the item a shutdown cut, and the next server finishes it', async () => {
    const shutdown = createShutdownState();
    const world = fakeStepperWorld({
      document: writes(),
      input: { files: ['a', 'b', 'c'] },
      connector: async (args) => {
        if (world.connectorCalls.length === 2) {
          shutdown.begin('SIGTERM', 0);
          throw new NodeFailure(
            'connector_error',
            'the call was interrupted because its server is shutting down',
          );
        }
        return { status: 'ok', output: { sent: args.input }, effects: 'write' };
      },
    });

    await expect(stepRunImpl(world.ctx, RUN, { shutdown })).resolves.toEqual({
      status: 'running',
    });
    expect(world.finished).toEqual([]);
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
    expect(unit(world, 'send', 1)?.status).not.toBe('failed');

    // The next server asks the ledger about the cut write: it was left open,
    // so a person decides. Mia sends it again, and the run ends with all
    // three written and none of them recorded as failed.
    const cut = world.ledger.get(ledgerKey('send', 1, 0));
    if (cut === undefined) throw new Error('the cut write left no ledger row');
    cut.resolution = 'retry';
    world.run.status = 'queued';
    await expect(
      stepRunImpl(world.ctx, RUN, { shutdown: createShutdownState() }),
    ).resolves.toEqual({ status: 'success' });
    expect(world.finished[0]?.output).toEqual([
      { sent: { path: 'a', content: 'due' } },
      { sent: { path: 'b', content: 'due' } },
      { sent: { path: 'c', content: 'due' } },
    ]);
    expect([0, 1, 2].map((item) => unit(world, 'send', item)?.status)).toEqual([
      'ok',
      'ok',
      'ok',
    ]);
  });
});
