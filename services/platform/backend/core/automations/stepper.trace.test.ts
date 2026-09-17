import { expect, it } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs';
import { stepRunImpl } from './stepper.ts';

it('bounds same-turn resolved trace input while preserving downstream data and final output', async () => {
  const output = 'x'.repeat(110_000);
  let finished: Record<string, unknown> | undefined;
  const ctx = {
    runQuery: async () => ({
      run: { name: 'large-trace', mode: 'mock', input: {}, checkpoints: null },
      document: {
        name: 'large-trace',
        nodes: [
          {
            id: 'source',
            type: 'transform',
            code: 'return "x".repeat(110000);',
          },
          {
            id: 'copy',
            type: 'transform',
            input: { value: '{{ nodes.source.output }}' },
            code: 'return input.value;',
          },
        ],
        output: '{{ nodes.copy.output }}',
      },
    }),
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      const name = functionRefName(ref);
      if (name.endsWith(':claimRun')) return { claimed: true, epoch: 1 };
      if (name.endsWith(':finishRun')) {
        finished = args;
        return { status: args.status };
      }
      return { status: 'running' };
    },
  };
  await expect(
    stepRunImpl(ctx as never, { organizationId: 'org-1', runId: 'run-1' }),
  ).resolves.toEqual({ status: 'success' });
  expect(finished?.output).toBe(output);
  expect(finished?.trace).toMatchObject([
    { node: 'source' },
    {
      node: 'copy',
      input: { value: expect.stringContaining('…(+105904 chars)') },
    },
  ]);
  expect(JSON.stringify(finished?.trace).length).toBeLessThan(16_000);
});
