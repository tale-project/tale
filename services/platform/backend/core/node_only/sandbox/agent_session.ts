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
  SpawnerBusyError,
  sessionAcquire,
  sessionCreate,
  sessionDestroyIfIdle,
  sessionInfo,
} from './helpers/session_client';

type SessionContext = Pick<ActionCtx, 'runQuery' | 'runMutation'>;

/** Project agents retain their workspace across tasks — the standing one,
 * and one per member who starts their runs; a workflow's agent and script
 * nodes share one workspace for that execution. Admission and recovery are
 * identical, but quota release must keep the owner's policy. */
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
 * A new row whose create fails first asks the spawner to destroy whatever it
 * holds under the id unless a sibling turn is executing in it, then reads
 * `failed`; the sandbox watchdog collects what that best-effort destroy could
 * not.
 */
export async function ensureAgentSession(
  ctx: SessionContext,
  args: {
    organizationId: string;
    sessionId: string;
    owner: AgentSessionOwner;
    /** The harness the session runs (`claude-code`, `codex`, …) — the
     * row's `agent_kind`, which names the session in the harness-turn
     * metrics; absent for a session no harness turn opens. */
    agentKind?: string;
    /** Explicit per-session build capability; absent uses the deployment default. */
    dockerInContainer?: boolean;
  },
): Promise<{ liveCreatedAt: number | undefined }> {
  const { organizationId, sessionId } = args;
  const policy = ownerPolicy(ctx, organizationId, args.owner);
  // A project agent owns more than one workspace — its standing one and one
  // per member who starts its runs — so its row is found by session id too.
  const existing: { status: string; createdAt: number } | null =
    await ctx.runQuery(
      internal.sandbox.session_queries.getActiveSessionByOwner,
      {
        ownerType: policy.ownerType,
        ownerId: policy.ownerId,
        ...(args.owner.type === 'project_agent' ? { sessionId } : {}),
      },
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
        await createOrAcquireSession(
          sessionId,
          organizationId,
          args.dockerInContainer,
        );
      } else {
        await assertBuildCapability(sessionId, args.dockerInContainer);
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
      ...(args.agentKind !== undefined ? { agentKind: args.agentKind } : {}),
    },
  );
  try {
    await createOrAcquireSession(
      sessionId,
      organizationId,
      args.dockerInContainer,
    );
  } catch (error) {
    // The spawner may already hold what this create made (one cut short
    // between Docker's create and start stays `created`), and a `failed` row
    // is never reconciled, resumed or listed. Destroy while this row still
    // holds the owner's slot: once it reads `failed`, a fresh create of the
    // same deterministic id may start, and a later destroy would hit that one.
    // Only an idle session goes: a sibling turn of the same owner can resume
    // this still-`creating` row and create or adopt the session itself, and
    // its running exec must never die for this turn's failure. A container
    // that never started runs no exec, so it is idle. A spawner that refused
    // the create for want of room (429) made nothing to destroy — and a
    // destroy of an id with no compute deletes its preserved workspace, which
    // a stopped standing session's id still names. Its row is settled as
    // collected, too: the watchdog's COLLECT pass would otherwise run that
    // very destroy once the row's grace had passed.
    if (
      error instanceof SpawnerBusyError ||
      error instanceof SessionCapabilityMismatchError
    ) {
      await ctx.runMutation(
        internal.sandbox.session_mutations.setSessionStatus,
        { rowId, status: 'failed', collected: true },
      );
      throw error;
    }
    await sessionDestroyIfIdle(sessionId)
      .then(({ busy }) => {
        if (busy)
          console.warn(
            `[sandbox.session] ${sessionId} runs a sibling turn's exec after this failed create; the watchdog collects it once idle`,
          );
      })
      .catch((destroyError: unknown) => {
        console.warn(
          `[sandbox.session] destroy after failed create of ${sessionId} failed (the watchdog collects it):`,
          destroyError,
        );
      });
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
  dockerInContainer?: boolean,
): Promise<void> {
  try {
    // Agent and automation workspaces may start on one of the organization's
    // connected devices; once started, a workspace keeps its machine.
    await sessionCreate({
      sessionId,
      organizationId,
      profile: 'agent',
      placement: 'device',
      ...(dockerInContainer !== undefined ? { dockerInContainer } : {}),
    });
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
  await assertBuildCapability(sessionId, dockerInContainer);
}

class SessionCapabilityMismatchError extends Error {}

async function assertBuildCapability(
  sessionId: string,
  requested?: boolean,
): Promise<void> {
  if (requested === undefined) return;
  const info = await sessionInfo(sessionId);
  if (info === null) throw new SessionNotFoundError(sessionId);
  if (info.dockerInContainer !== requested) {
    // Never destroy an adopted orphan or a standing workspace merely to
    // change its capability. Refuse reuse; the caller may choose a fresh id.
    throw new SessionCapabilityMismatchError(
      `Sandbox ${sessionId} cannot satisfy the requested build capability; choose a new session.`,
    );
  }
}
