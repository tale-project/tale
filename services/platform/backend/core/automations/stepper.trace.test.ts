import { expect, it } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs';
import { NodeFailure } from './failure.ts';
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

// The shim hands a coded connector refusal to the stepper as a `NodeFailure`
// with its sentence and hint; the run's failure detail used to be the JSON of
// an `AppError` (2026-09-26 evaluation, D-09).
it('records a connector refusal as prose with its hint, classified connector_error', async () => {
  let finished: Record<string, unknown> | undefined;
  const ctx = {
    runQuery: async () => ({
      run: { name: 'mail', mode: 'mock', input: {}, checkpoints: null },
      document: {
        name: 'mail',
        nodes: [
          {
            id: 'send',
            type: 'imap-smtp.send',
            input: { to: 'a@example.test', subject: 'x', text: 'y' },
          },
        ],
        output: '{{ nodes.send.output }}',
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
    runAction: async () => {
      throw new NodeFailure(
        'connector_error',
        'no usable credential for imap-smtp: No default credential is configured for "imap-smtp" — add one in Settings → Connectors, or name a credential explicitly.',
        'connect the connector, or mark one of its credentials as the default',
      );
    },
  };
  await expect(
    stepRunImpl(ctx as never, { organizationId: 'org-1', runId: 'run-1' }),
  ).resolves.toEqual({ status: 'failed' });
  expect(finished).toMatchObject({
    status: 'failed',
    failureCode: 'connector_error',
    detail:
      'send: no usable credential for imap-smtp: No default credential is configured for "imap-smtp" — add one in Settings → Connectors, or name a credential explicitly. — connect the connector, or mark one of its credentials as the default',
  });
  expect(finished?.trace).toMatchObject([
    {
      node: 'send',
      status: 'error',
      error: expect.stringContaining(' — connect the connector'),
    },
  ]);
});
