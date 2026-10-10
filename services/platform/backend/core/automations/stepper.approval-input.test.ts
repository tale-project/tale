import { expect, it } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs';
import { stepRunImpl } from './stepper.ts';

const loaded = {
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
};

// The pending card used to show only the operation and the node: the gate
// was asked before the connector body resolved `node.input`, so the approver
// could not read the path a `webdav.delete` was about to remove (APV-F1).
it('hands the gate the node input resolved against the run scope', async () => {
  const gateCalls: Record<string, unknown>[] = [];
  const connectorCalls: Record<string, unknown>[] = [];
  const probeCalls: Record<string, unknown>[] = [];
  const ctx = {
    runQuery: async (ref: unknown, args: Record<string, unknown>) => {
      if (functionRefName(ref).endsWith(':probeCredentialUsableInternal')) {
        probeCalls.push(args);
        return { usable: true };
      }
      return loaded;
    },
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      const name = functionRefName(ref);
      if (name.endsWith(':claimRun')) return { claimed: true, epoch: 1 };
      if (name.endsWith(':evaluateApprovalGate')) {
        gateCalls.push(args);
        return { decision: 'allow' };
      }
      // A live write goes through the effect ledger first.
      if (name.endsWith(':beginNodeAttempt')) return { kind: 'go', attempt: 1 };
      if (name.endsWith(':finishNodeAttempt')) return { recorded: true };
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
  // The credential was probed for the node's connector before the gate.
  expect(probeCalls).toEqual([
    { organizationId: 'org-1', connectorSlug: 'webdav' },
  ]);
});

// A connector with no usable credential used to park the run on an approval
// card; only the approver's "yes" surfaced the missing credential, as a raw
// JSON blob (2026-09-26 evaluation, D-09). The run now fails before the gate
// is asked, in the dispatcher's own words.
it('fails the node before asking for approval when no credential can resolve', async () => {
  const gateCalls: Record<string, unknown>[] = [];
  let finished: Record<string, unknown> | undefined;
  const ctx = {
    runQuery: async (ref: unknown) =>
      functionRefName(ref).endsWith(':probeCredentialUsableInternal')
        ? {
            usable: false,
            message:
              'no usable credential for webdav: No default credential is configured for "webdav" — add one in Settings → Connectors, or name a credential explicitly.',
            hint: 'connect the connector, or mark one of its credentials as the default',
          }
        : loaded,
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      const name = functionRefName(ref);
      if (name.endsWith(':claimRun')) return { claimed: true, epoch: 1 };
      if (name.endsWith(':evaluateApprovalGate')) {
        gateCalls.push(args);
        return { decision: 'require', approvalId: 'appr-1' };
      }
      if (name.endsWith(':finishRun')) {
        finished = args;
        return { status: args.status };
      }
      return { status: 'running' };
    },
    runAction: async () => {
      throw new Error('the connector must not be called');
    },
  };

  await expect(
    stepRunImpl(ctx as never, { organizationId: 'org-1', runId: 'run-1' }),
  ).resolves.toEqual({ status: 'failed' });
  expect(gateCalls).toEqual([]);
  expect(finished).toMatchObject({
    status: 'failed',
    failureCode: 'connector_error',
    detail:
      'remove: no usable credential for webdav: No default credential is configured for "webdav" — add one in Settings → Connectors, or name a credential explicitly. — connect the connector, or mark one of its credentials as the default',
  });
  expect(finished?.detail).not.toContain('{"code"');
});

// The decision wakes the parked run in its own transaction, and a park that
// lands after the decision wakes the run itself, so the park's poll is only a
// backstop — ten minutes out, not the thirty seconds that once carried every
// approval's resume.
it('parks behind the approval card with a ten-minute backstop poll', async () => {
  const parks: Record<string, unknown>[] = [];
  const ctx = {
    runQuery: async (ref: unknown) =>
      functionRefName(ref).endsWith(':probeCredentialUsableInternal')
        ? { usable: true }
        : loaded,
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      const name = functionRefName(ref);
      if (name.endsWith(':claimRun')) return { claimed: true, epoch: 1 };
      if (name.endsWith(':evaluateApprovalGate')) {
        return { decision: 'needs-approval', approvalId: 'appr-1' };
      }
      if (name.endsWith(':suspendRun')) {
        parks.push(args);
        return { suspended: true };
      }
      return { status: 'running' };
    },
    runAction: async () => {
      throw new Error('the connector must not be called before the approval');
    },
  };

  await stepRunImpl(ctx as never, { organizationId: 'org-1', runId: 'run-1' });
  expect(parks).toHaveLength(1);
  expect(parks[0]).toMatchObject({
    detail: 'approval:appr-1',
    resumeInMs: 600_000,
  });
});
