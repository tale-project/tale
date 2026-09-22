import { expect, it } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs';
import { stepRunImpl } from './stepper.ts';

// The pending card used to show only the operation and the node: the gate
// was asked before the connector body resolved `node.input`, so the approver
// could not read the path a `webdav.delete` was about to remove (APV-F1).
it('hands the gate the node input resolved against the run scope', async () => {
  const gateCalls: Record<string, unknown>[] = [];
  const connectorCalls: Record<string, unknown>[] = [];
  const ctx = {
    runQuery: async () => ({
      run: {
        name: 'clean-up',
        mode: 'live',
        input: { path: '/inbox/2026-09/empty' },
        checkpoints: null,
      },
      document: {
        name: 'clean-up',
        nodes: [
          {
            id: 'remove',
            type: 'webdav.delete',
            input: { path: '{{ input.path }}', recursive: false },
          },
        ],
        output: '{{ nodes.remove.output }}',
      },
    }),
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      const name = functionRefName(ref);
      if (name.endsWith(':claimRun')) return { claimed: true, epoch: 1 };
      if (name.endsWith(':evaluateApprovalGate')) {
        gateCalls.push(args);
        return { decision: 'allow' };
      }
      if (name.endsWith(':finishRun')) return { status: args.status };
      return { status: 'running' };
    },
    runAction: async (_ref: unknown, args: Record<string, unknown>) => {
      connectorCalls.push(args);
      return { status: 'ok', output: { deleted: true }, effects: 'write' };
    },
  };

  await expect(
    stepRunImpl(ctx as never, { organizationId: 'org-1', runId: 'run-1' }),
  ).resolves.toEqual({ status: 'success' });

  expect(gateCalls).toHaveLength(1);
  expect(gateCalls[0]).toMatchObject({
    connector: 'webdav',
    action: 'delete',
    nodeId: 'remove',
    input: { path: '/inbox/2026-09/empty', recursive: false },
  });
  // The card's preview is the call the step then makes, byte for byte.
  expect(connectorCalls[0]?.input).toEqual(gateCalls[0]?.input);
});
