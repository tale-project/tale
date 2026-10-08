import type { Sql } from 'postgres';
import { describe, expect, it, vi } from 'vitest';

vi.mock('../../jobs/enqueue.ts', () => ({ addJobInTx: vi.fn() }));
vi.mock('../../realtime/outbox.ts', () => ({ emitHintInTx: vi.fn() }));

import { RUN_CLAIM_PROMISE_MS } from '../../core/automations/liveness.ts';
import { addJobInTx } from '../../jobs/enqueue.ts';
import {
  reachableHandlerNames,
  unansweredHandlerNames,
} from '../../lib/ctx-shim-reachability.ts';
import { automationShimHandlers } from './shim.ts';

/**
 * The EXHAUSTIVENESS gate for the automation run surface.
 *
 * The stepper and the agent-node host run on a ctx shim built from
 * `automationShimHandlers`, and the shim fails LOUD on a name it has no
 * handler for — at the call, in production. That is exactly how the agent
 * node's folder mounts shipped broken: `handler_names` declared
 * `documents/internal_queries:listFilesByFolderInternal`, the host
 * dispatched it for every `files:` entry that named a folder, and no map
 * answered it — so inline content worked and a folder never did.
 *
 * The walk itself lives in `lib/ctx-shim-reachability.ts` — shared with the
 * chat and sandbox gates, so every surface is held to one standard.
 */

/** Where a run's dispatch begins: the stepper (every node kind) and the
 * agent-node host it hands the same ctx to. */
const RUN_DISPATCH = {
  entryPoints: [
    'core/automations/stepper.ts',
    'core/automations/agent_host.ts',
  ],
};

/**
 * The refs the host SCHEDULES rather than calls — `ctx.scheduler.runAfter`
 * resolves them through `automationShimScheduler`, not the handler map, so
 * the walk (which reads every `internal.a.b.c` token) lists them as
 * unanswered by design. Each one is mapped onto a pg-boss job there.
 */
const SCHEDULED_REFS = new Set([
  'automations/agent_host:startWorkflowAgentTurn',
  'automations/agent_host:driveWorkflowAgentTurn',
  // The settle's gateway-key settlement retry — mapped to the
  // `sandbox.gateway_key_reconcile` job by `scheduleGatewayKeyReconcile`.
  'sandbox/gateway_reconcile:reconcileSessionOpKey',
]);

describe('automationShimHandlers', () => {
  // The factory only closes over `sql`; no handler runs until it is called,
  // so a stand-in is enough to enumerate the map.
  const handlers = automationShimHandlers({} as never);

  it('answers every internal function a run can reach', () => {
    const unanswered = unansweredHandlerNames(handlers, RUN_DISPATCH).filter(
      (entry) => !SCHEDULED_REFS.has(entry.split(' ')[0] ?? ''),
    );
    expect(unanswered).toEqual([]);
  });

  it('reaches the run contract and the folder-mount listing, not just the loads', () => {
    // A guard on the guard: if the walk ever stops finding the host's
    // imports, the assertion above would pass vacuously.
    const reachable = reachableHandlerNames(RUN_DISPATCH);
    expect([...reachable.keys()]).toEqual(
      expect.arrayContaining([
        'automations/mutations:claimRun',
        'automations/queries:loadRunForStep',
        'documents/internal_queries:listFilesByFolderInternal',
        'automations/human_asks:getPendingAskForExec',
        'sandbox/session_mutations:upsertSessionOp',
        // The llm door's hold, booking and release.
        'automations/mutations:openLlmStepCall',
        'automations/mutations:settleLlmStepCall',
        'automations/mutations:releaseLlmStepCall',
      ]),
    );
  });
});

/**
 * A settled agent turn wakes its parked run with a step job. The run's
 * promise covers that job's claim — it used to be stamped `now`, so every
 * settle read as overdue at once and the next sweep tick queued a second
 * step for the same run.
 */
describe('recordAgentTurnSettled', () => {
  it('wakes the parked run with the claim promise, never overdue', async () => {
    const writes: { text: string; values: unknown[] }[] = [];
    const tag = (strings: TemplateStringsArray, ...values: unknown[]) => {
      const text = strings.join('?');
      if (text.includes('FOR UPDATE')) {
        return Promise.resolve([
          {
            status: 'waiting',
            checkpoints: {
              nodes: {},
              cursor: { node: 'agent', agent: { execId: 'exec_1' } },
              executions: 1,
            },
          },
        ]);
      }
      writes.push({ text, values });
      return Promise.resolve([]);
    };
    const sql = Object.assign(tag, {
      json: (value: unknown) => ({ json: value }),
      begin: (body: (tx: typeof tag) => Promise<unknown>) => body(tag),
    });
    const before = Date.now();
    const handlers = automationShimHandlers(sql as unknown as Sql);
    await expect(
      handlers['automations/mutations:recordAgentTurnSettled']?.({
        organizationId: 'org_1',
        runId: 'run_1',
        nodeId: 'agent',
        execId: 'exec_1',
        result: { text: 'done' },
      }),
    ).resolves.toEqual({ recorded: true });
    const wake = writes.find((write) =>
      write.text.includes('UPDATE app.automation_runs'),
    );
    expect(wake?.values[1]).toBeGreaterThanOrEqual(
      before + RUN_CLAIM_PROMISE_MS,
    );
    expect(addJobInTx).toHaveBeenCalledWith(sql, 'automation.step', {
      organizationId: 'org_1',
      runId: 'run_1',
    });
  });
});
