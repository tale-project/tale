import { describe, expect, it } from 'vitest';

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
      ]),
    );
  });
});
