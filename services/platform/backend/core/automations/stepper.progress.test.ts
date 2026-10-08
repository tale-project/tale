import { describe, expect, it } from 'vitest';

import type { Automation } from '../../../lib/engine/core/types';
import { fakeStepperWorld } from './stepper.test-helpers.ts';
import { stepRunImpl } from './stepper.ts';

const RUN = { organizationId: 'org-1', runId: 'run-1' } as never;

const TWO_STEPS = {
  version: 1,
  name: 'nightly-import',
  nodes: [
    { id: 'fetch', type: 'webdav.list', input: { path: '/' } },
    {
      id: 'count',
      type: 'transform',
      input: { files: '{{ nodes.fetch.output }}' },
      code: 'return input.files.length;',
    },
  ],
  output: '{{ nodes.count.output }}',
} as Automation;

describe('a run whose saved progress this engine cannot read [AUTO-R20]', () => {
  it('fails as engine_incompatible and runs none of its steps again', async () => {
    const world = fakeStepperWorld({
      document: TWO_STEPS,
      checkpoints: {
        // A later release's shape: finished steps under another key.
        steps: { fetch: { status: 'ok' } },
        executions: 1,
      },
      connector: async () => ({ status: 'ok', output: [], effects: 'read' }),
    });

    await expect(stepRunImpl(world.ctx, RUN)).resolves.toEqual({
      status: 'failed',
    });
    expect(world.connectorCalls).toEqual([]);
    expect(world.progress).toEqual([]);
    expect(world.finished).toEqual([
      expect.objectContaining({
        status: 'failed',
        failureCode: 'engine_incompatible',
        trace: [],
        effects: [],
        detail:
          "this run's saved progress could not be read by this version of Tale (the saved progress lists no steps); it was stopped instead of starting over, so no step ran twice",
      }),
    ]);
  });
});

describe('a walk whose progress write finds the run no longer live', () => {
  it.each(['success', 'failed', 'missing', 'stale', 'cancelled'])(
    'stops at the next node when the write answers %s',
    async (answer) => {
      const world = fakeStepperWorld({
        document: TWO_STEPS,
        connector: async () => ({
          status: 'ok',
          output: ['a.txt'],
          effects: 'read',
        }),
      });
      world.answerNextProgress = answer;

      await expect(stepRunImpl(world.ctx, RUN)).resolves.toEqual({
        status: 'cancelled',
      });
      // The first step's record was refused: the second never ran and the
      // run was not finished by this walker.
      expect(world.progress.map((write) => write.nodeId)).toEqual(['fetch']);
      expect(world.finished).toEqual([]);
    },
  );
});
