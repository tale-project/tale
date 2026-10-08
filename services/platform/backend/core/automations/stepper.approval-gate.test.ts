import { afterEach, describe, expect, it } from 'vitest';

import { functionRefName } from '../../../lib/shared/handlers/function-refs';
import {
  setAutomationApprovalGate,
  stepRunImpl,
  type AutomationApprovalGate,
} from './stepper.ts';

/** A live run whose one step writes a file — a write the approval policy of
 * its organization decides. */
function liveWrite(organizationId: string) {
  return {
    run: {
      name: `${organizationId}-export`,
      mode: 'live',
      input: {},
      checkpoints: { nodes: {}, executions: 0 },
    },
    document: {
      name: `${organizationId}-export`,
      nodes: [
        {
          id: 'save',
          type: 'webdav.write',
          input: { path: `/${organizationId}/report.txt`, content: 'done' },
        },
      ],
      output: '{{ nodes.save.output }}',
    },
  };
}

/**
 * One worker's ctx stepping runs of several organizations, the way the
 * shim's single handler table serves them. `beforeGate` lets a run's step
 * wait — after its turn began, before it asks its gate — for another run's
 * turn to begin.
 */
function sharedWorker(beforeGate: (organizationId: string) => Promise<void>) {
  const gateCalls: Array<Record<string, unknown>> = [];
  const finished: Array<Record<string, unknown>> = [];
  const ctx = {
    runQuery: async (ref: unknown, args: Record<string, unknown>) => {
      const name = functionRefName(ref);
      const organizationId = String(args.organizationId);
      if (name.endsWith(':loadRunForStep')) return liveWrite(organizationId);
      if (name.endsWith(':probeCredentialUsableInternal')) {
        await beforeGate(organizationId);
        return { usable: true };
      }
      throw new Error(`unexpected query ${name}`);
    },
    runMutation: async (ref: unknown, args: Record<string, unknown>) => {
      const name = functionRefName(ref);
      if (name.endsWith(':claimRun')) return { claimed: true, epoch: 1 };
      if (name.endsWith(':evaluateApprovalGate')) {
        gateCalls.push(args);
        return { decision: 'allow' };
      }
      if (name.endsWith(':beginNodeAttempt')) return { kind: 'go', attempt: 1 };
      if (name.endsWith(':finishNodeAttempt')) return { recorded: true };
      if (name.endsWith(':finishRun')) {
        finished.push(args);
        return { status: args.status };
      }
      return { status: 'running' };
    },
    runAction: async () => ({
      status: 'ok',
      output: { written: true },
      effects: 'write',
    }),
  };
  return { ctx: ctx as never, gateCalls, finished };
}

afterEach(() => {
  setAutomationApprovalGate(null);
});

describe('the approval gate of a run [AUTO-R21]', () => {
  // The gate used to be one slot for the whole process, refilled by every
  // turn: a run of Ada's organization asking it after a turn of Noah's had
  // begun reached Noah's gate, which refused with "a different
  // organization" — even for steps no policy would have stopped.
  it("asks each run's own organization when two organizations' runs are stepped at once", async () => {
    let noahStarted!: () => void;
    const noahTurnBegan = new Promise<void>((resolve) => {
      noahStarted = resolve;
    });
    const worker = sharedWorker(async (organizationId) => {
      if (organizationId === 'org-ada') await noahTurnBegan;
      else noahStarted();
    });

    const ada = stepRunImpl(worker.ctx, {
      organizationId: 'org-ada',
      runId: 'run-ada',
    });
    const noah = stepRunImpl(worker.ctx, {
      organizationId: 'org-noah',
      runId: 'run-noah',
    });

    await expect(Promise.all([ada, noah])).resolves.toEqual([
      { status: 'success' },
      { status: 'success' },
    ]);
    expect(
      worker.gateCalls.map((call) => [call.organizationId, call.runId]),
    ).toEqual([
      ['org-noah', 'run-noah'],
      ['org-ada', 'run-ada'],
    ]);
  });

  it('lets an installed gate decide for every run until it is taken out', async () => {
    const asked: string[] = [];
    const override: AutomationApprovalGate = {
      check: async (request) => {
        asked.push(request.organizationId);
        return { status: 'allowed' };
      },
    };
    setAutomationApprovalGate(override);
    const worker = sharedWorker(async () => undefined);

    await stepRunImpl(worker.ctx, {
      organizationId: 'org-ada',
      runId: 'run-ada',
    });
    await stepRunImpl(worker.ctx, {
      organizationId: 'org-noah',
      runId: 'run-noah',
    });
    expect(asked).toEqual(['org-ada', 'org-noah']);
    expect(worker.gateCalls).toEqual([]);

    setAutomationApprovalGate(null);
    await stepRunImpl(worker.ctx, {
      organizationId: 'org-ada',
      runId: 'run-ada',
    });
    expect(asked).toEqual(['org-ada', 'org-noah']);
    expect(worker.gateCalls.map((call) => call.organizationId)).toEqual([
      'org-ada',
    ]);
  });
});
