// @vitest-environment node

/**
 * The session slot verbs refuse a session an administrator's Destroy is
 * removing with a `QUOTA_EXCEEDED` of their own. The shim flattened it into
 * the payload a spent budget throws, so the automation lane read it as a
 * wait for room: the step waited up to two hours, then started over in the
 * fresh, empty workspace the Destroy left (#4122). The marker it carries now
 * reaches the lanes' readers.
 */

import type { Sql } from 'postgres';
import { describe, expect, it } from 'vitest';

import { AppError } from '../../../lib/shared/errors/app-error';
import { classifyWorkflowStartFailure } from '../../core/automations/agent_host.ts';
import {
  isDestroyPendingRefusal,
  sandboxCapacityRefusal,
} from '../../core/node_only/sandbox/capacity_refusal.ts';
import { SANDBOX_DESTROY_PENDING_MESSAGE } from '../../core/sandbox/session_constants.ts';
import { agentTurnShimHandlers } from './agent-turn-shim.ts';

/** A database where the session's live row has a Destroy pending: every
 * read answers that row, stopped, and the pending-Destroy probe true. */
function destroyPendingSql(): Sql {
  const tx = async () => [
    {
      id: 'row-1',
      status: 'stopped',
      ownerType: 'workflow_run',
      pinned: false,
      pending: true,
    },
  ];
  return {
    begin: async (work: (t: typeof tx) => Promise<unknown>) => work(tx),
  } as unknown as Sql;
}

async function refusalOf(call: Promise<unknown>): Promise<unknown> {
  return call.then(
    () => {
      throw new Error('the verb admitted a session whose Destroy is pending');
    },
    (error: unknown) => error,
  );
}

describe('the session slot verbs on a session whose Destroy is pending', () => {
  const handlers = agentTurnShimHandlers(destroyPendingSql());
  const verbs = [
    {
      verb: 'resume',
      call: () =>
        handlers['sandbox/session_mutations:resumeSessionSlotWithCapCheck']?.({
          organizationId: 'org-1',
          sessionId: 'wf-run-1',
        }),
    },
    {
      verb: 'reserve',
      call: () =>
        handlers['sandbox/session_mutations:reserveSessionSlotAndInsert']?.({
          organizationId: 'org-1',
          sessionId: 'wf-run-1',
          profile: 'agent',
          ownerType: 'workflow_run',
          ownerId: 'wf:run-1',
          createdBy: 'system:automation',
        }),
    },
  ];

  it.each(verbs)(
    'the $verb refuses with the marked quota payload',
    async ({ call }) => {
      const error = await refusalOf(Promise.resolve(call()));

      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).data).toEqual({
        code: 'QUOTA_EXCEEDED',
        message: SANDBOX_DESTROY_PENDING_MESSAGE,
        reason: 'destroy_pending',
      });
    },
  );

  it.each(verbs)(
    'the $verb’s refusal is read as no want of room: the task lane parks on it, an automation step fails with it',
    async ({ call }) => {
      const error = await refusalOf(Promise.resolve(call()));

      expect(sandboxCapacityRefusal(error)).toBeNull();
      expect(isDestroyPendingRefusal(error)).toBe(true);
      expect(classifyWorkflowStartFailure(error, Date.now())).toEqual({
        reason: `the agent turn could not start: ${SANDBOX_DESTROY_PENDING_MESSAGE}`,
        failureCode: 'sandbox_destroying',
      });
    },
  );
});
