'use node';

import type { ActionCtx } from '../../lib/ctx';
import { internal } from '../../lib/handler_names';
import {
  projectAgentOwnerId,
  workflowExecutionOwnerId,
} from '../../sandbox/session_naming';
import {
  SessionDuplicateError,
  SessionNotFoundError,
  sessionAcquire,
  sessionCreate,
} from './helpers/session_client';

type SessionContext = Pick<ActionCtx, 'runQuery' | 'runMutation'>;

/** Project agents retain their workspace across tasks; a workflow's agent
 * and script nodes share one workspace for that execution. Admission and
 * recovery are identical, but quota release must keep the owner's policy. */
export type AgentSessionOwner =
  | { type: 'project_agent'; agentId: string }
  | { type: 'workflow_run'; runId: string };

function ownerPolicy(
  ctx: SessionContext,
  organizationId: string,
  owner: AgentSessionOwner,
) {
  if (owner.type === 'project_agent') {
    return {
      ownerType: owner.type,
      ownerId: projectAgentOwnerId(owner.agentId),
      createdBy: 'system:task-agent',
      releaseSlot: () =>
        ctx.runMutation(
          internal.sandbox.session_mutations.releaseProjectAgentSessionSlot,
          { organizationId, agentId: owner.agentId },
        ),
    };
  }
  return {
    ownerType: owner.type,
    ownerId: workflowExecutionOwnerId(owner.runId),
    createdBy: 'system:automation',
    releaseSlot: () =>
      ctx.runMutation(
        internal.sandbox.session_mutations.hibernateAutomationScopedSession,
        { executionId: owner.runId },
      ),
  };
}

/**
 * Ensure an agent-profile session only AFTER reserving its organization slot.
 * A duplicate create adopts the existing runtime without deleting workspace
 * data. Recreating compute under an existing row preserves its incarnation:
 * /agent, including the harness conversation store, survives a stop on both
 * backends. A new row returns no previous stamp, even when adopting an orphan,
 * so a caller cannot resume a conversation from an unproven incarnation.
 */
export async function ensureAgentSession(
  ctx: SessionContext,
  args: {
    organizationId: string;
    sessionId: string;
    owner: AgentSessionOwner;
  },
): Promise<{ liveCreatedAt: number | undefined }> {
  const { organizationId, sessionId } = args;
  const policy = ownerPolicy(ctx, organizationId, args.owner);
  const existing: { status: string; createdAt: number } | null =
    await ctx.runQuery(
      internal.sandbox.session_queries.getActiveSessionByOwner,
      { ownerType: policy.ownerType, ownerId: policy.ownerId },
    );

  if (existing !== null) {
    // Re-read and re-admit even when the query saw an active row: a previous
    // turn may have released it since. This happens before acquiring warm
    // compute, staging files or provisioning keys.
    const admitted = await ctx.runMutation(
      internal.sandbox.session_mutations.resumeSessionSlotWithCapCheck,
      { organizationId, sessionId },
    );
    if (admitted === false)
      throw new Error(`Sandbox allocation for ${sessionId} no longer exists`);
    try {
      if (!(await sessionAcquire(sessionId))) {
        await createOrAcquireSession(sessionId, organizationId);
      }
    } catch (error) {
      await policy.releaseSlot().catch((releaseError: unknown) => {
        console.warn(
          '[sandbox.session] slot release after failed resume failed:',
          releaseError,
        );
      });
      throw error;
    }
    return { liveCreatedAt: existing.createdAt };
  }

  const rowId: string = await ctx.runMutation(
    internal.sandbox.session_mutations.reserveSessionSlotAndInsert,
    {
      organizationId,
      sessionId,
      profile: 'agent',
      ownerType: policy.ownerType,
      ownerId: policy.ownerId,
      createdBy: policy.createdBy,
    },
  );
  try {
    await createOrAcquireSession(sessionId, organizationId);
  } catch (error) {
    await ctx.runMutation(internal.sandbox.session_mutations.setSessionStatus, {
      rowId,
      status: 'failed',
    });
    throw error;
  }
  await ctx.runMutation(internal.sandbox.session_mutations.setSessionStatus, {
    rowId,
    status: 'active',
  });
  return { liveCreatedAt: undefined };
}

async function createOrAcquireSession(
  sessionId: string,
  organizationId: string,
): Promise<void> {
  try {
    await sessionCreate({ sessionId, organizationId, profile: 'agent' });
  } catch (error) {
    if (!(error instanceof SessionDuplicateError)) throw error;
    // An orphan or concurrent create may already be released. Adopting its
    // existence alone would leave the new turn eligible for an idle stop.
    if (!(await sessionAcquire(sessionId)))
      throw new SessionNotFoundError(sessionId);
    console.warn(
      `[sandbox.session] adopting existing runtime for ${sessionId}`,
    );
  }
}
