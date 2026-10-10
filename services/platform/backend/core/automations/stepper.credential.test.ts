import { describe, expect, it } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs';
import { stepRunImpl } from './stepper.ts';

/** A live run whose one step reads an API, as the credential it names. */
function liveRead(credential: string | undefined) {
  return {
    run: {
      name: 'orders',
      mode: 'live',
      input: {},
      checkpoints: { nodes: {}, executions: 0 },
    },
    document: {
      name: 'orders',
      nodes: [
        {
          id: 'orders',
          type: 'http.get',
          ...(credential !== undefined && { credential }),
          input: { url: '/orders' },
        },
      ],
      output: '{{ nodes.orders.output }}',
    },
  };
}

/** One worker's ctx for that run, keeping what the probe and the connector
 * door were asked. */
function worker(credential: string | undefined) {
  const probes: Array<Record<string, unknown>> = [];
  const calls: Array<Record<string, unknown>> = [];
  const ctx = {
    runQuery: async (ref: unknown, args: Record<string, unknown>) => {
      const name = functionRefName(ref);
      if (name.endsWith(':loadRunForStep')) return liveRead(credential);
      if (name.endsWith(':probeCredentialUsableInternal')) {
        probes.push(args);
        return { usable: true };
      }
      throw new Error(`unexpected query ${name}`);
    },
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      const name = functionRefName(ref);
      if (name.endsWith(':claimRun')) return { claimed: true, epoch: 1 };
      if (name.endsWith(':evaluateApprovalGate')) return { decision: 'allow' };
      if (name.endsWith(':beginNodeAttempt')) return { kind: 'go', attempt: 1 };
      if (name.endsWith(':finishNodeAttempt')) return { recorded: true };
      if (name.endsWith(':finishRun')) return { status: args.status };
      return { status: 'running' };
    },
    runAction: async (_ref: unknown, args: Record<string, unknown>) => {
      calls.push(args);
      return { status: 'ok', output: { status: 200 }, effects: 'read' };
    },
  };
  return { ctx: ctx as never, probes, calls };
}

describe('a connector step and its credential', () => {
  it('acts as the credential the step names [CONN-R19]', async () => {
    const run = worker('Shop API');
    await expect(
      stepRunImpl(run.ctx, { organizationId: 'org-ada', runId: 'run-1' }),
    ).resolves.toEqual({ status: 'success' });
    expect(run.probes).toEqual([
      expect.objectContaining({
        connectorSlug: 'http',
        credentialRef: 'Shop API',
      }),
    ]);
    expect(run.calls).toEqual([
      expect.objectContaining({
        connector: 'http',
        action: 'get',
        credentialRef: 'Shop API',
      }),
    ]);
  });

  it('names no credential when the step names none', async () => {
    const run = worker(undefined);
    await expect(
      stepRunImpl(run.ctx, { organizationId: 'org-ada', runId: 'run-1' }),
    ).resolves.toEqual({ status: 'success' });
    expect(run.probes[0]).not.toHaveProperty('credentialRef');
    expect(run.calls[0]).not.toHaveProperty('credentialRef');
  });
});
