/**
 * What a durable run costs the stepper today, with the database and the
 * connector door replaced by the fake world (`stepper.test-helpers.ts`): a
 * loop of 20 connector reads that each take a few milliseconds, and how many
 * progress writes the walk makes and how much they carry. The baseline items
 * at a time and steps at the same time are measured against — a note, not a
 * gate. Run it with
 * `bunx vitest bench --project server backend/core/automations/stepper.perf.bench.ts`.
 */

import { bench, describe } from 'vitest';

import type { Automation } from '../../../lib/engine/core/types';
import { createShutdownState } from '../../lib/shutdown';
import { type FakeWorld, fakeStepperWorld } from './stepper.test-helpers.ts';
import { stepRunImpl } from './stepper.ts';

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- test double
const RUN = { organizationId: 'org-1', runId: 'run-1' } as never;

/** How long the stand-in connector takes to answer one read. */
const CALL_MS = 5;

const FOLDERS = Array.from({ length: 20 }, (_, index) => `/folder-${index}`);

const LOOP = {
  version: 1,
  name: 'twenty-reads',
  nodes: [
    {
      id: 'list',
      type: 'webdav.list',
      forEach: '{{ input.folders }}',
      input: { path: '{{ item }}' },
    },
  ],
  output: '{{ nodes.list.output }}',
} as Automation;

/** One run of the loop to its end, turn by turn. */
async function walkLoop(): Promise<FakeWorld> {
  const world = fakeStepperWorld({
    document: LOOP,
    input: { folders: FOLDERS },
    connector: async (args) => {
      await new Promise((resolve) => setTimeout(resolve, CALL_MS));
      return { status: 'ok', output: [args.input], effects: 'read' };
    },
  });
  for (let turn = 0; world.finished.length === 0; turn++) {
    if (turn === 50) throw new Error('the loop did not finish in 50 turns');
    await stepRunImpl(world.ctx, RUN, { shutdown: createShutdownState() });
  }
  if (world.connectorCalls.length !== FOLDERS.length) {
    throw new Error(`the loop made ${world.connectorCalls.length} reads`);
  }
  return world;
}

// What one walk writes, measured once: the bench names it beside its time.
const probe = await walkLoop();
const writes = probe.progress.length;
const kilobytes = JSON.stringify(probe.progress).length / 1024;

describe('a durable run', () => {
  bench(
    `20 connector reads of ${CALL_MS} ms in a loop — ${writes} progress writes, ${kilobytes.toFixed(1)} KB`,
    async () => {
      await walkLoop();
    },
    { iterations: 5 },
  );
  bench.todo('20 connector reads in a loop, eight items at a time');
  bench.todo('three reads into three model calls, four steps at a time');
});
