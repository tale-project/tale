'use node';

/**
 * A sandbox session one piece of the deployment's own work opens, uses and
 * destroys: a batch of pages rendered for a crawl or a chat read
 * (`render_fetch.ts`), a video link's yt-dlp (`core/video_links`). The work
 * differs; the session's life around it does not, and it is here once.
 *
 * - A slot is reserved against the organization's budget for such sessions
 *   first. A spent budget, and a sandbox host with no room for one more, is
 *   a {@link SandboxLaneCapacityError}: not a failure of the lane. Its caller
 *   waits, or comes back later.
 * - The session is created on the server, never on an organization's
 *   device, with the `default` profile: nobody, a read-only root, no
 *   package caches.
 * - Whatever the work does, the session is destroyed after it, and its row
 *   settled only once the spawner has said it is gone. What a failure leaves
 *   behind is the sandbox watchdog's: a create that failed half way, a
 *   destroy that did not answer, an action killed before its `finally`.
 */

import type { ActionCtx } from '../../lib/ctx';
import { internal } from '../../lib/handler_names';
import {
  SessionDuplicateError,
  sessionCreate,
  sessionDestroy,
  sessionDestroyIfIdle,
  sessionIsAlive,
  SpawnerBusyError,
} from './helpers/session_client';

export interface ThrowawaySession {
  readonly organizationId: string;
  /** Deterministic for the work, so a second run of the same work asks for
   * the same session and is told it exists. */
  readonly sessionId: string;
  /**
   * Whose sessions these are to the sandbox's bookkeeping: both count
   * against the organization's render budget
   * (`core/sandbox/quota_policy.ts`), and each has the watchdog pass that
   * releases one left behind, after as long as its work may take
   * (`domains/sandbox/watchdogs.ts`).
   */
  readonly ownerType: 'render' | 'video';
  readonly createdBy: string;
  /** How long the session may sit with nothing running before the spawner
   * reaps it: what bounds an orphan whose work died before its destroy. */
  readonly idleTimeoutMs: number;
  /** The most one file of the session may weigh, for work that writes more
   * than a session's own 100 MiB (`SessionCreateBody.maxFileBytes`). */
  readonly maxFileBytes?: number;
  /** The lane's name in a log line. */
  readonly lane: string;
  /** What one piece of the lane's work is called in a log line. */
  readonly unit: string;
}

/**
 * No session for now: the organization's budget for these sessions is spent
 * (`quota`, with the refusal's own words), or the sandbox host has no room
 * for one more (`host`).
 */
export class SandboxLaneCapacityError extends Error {
  readonly why: 'quota' | 'host';
  /** When to ask again, from a sandbox host that keeps a first-come line
   * and said when this session's place comes up; undefined otherwise. */
  readonly retryAfterMs: number | undefined;
  constructor(why: 'quota' | 'host', message: string, retryAfterMs?: number) {
    super(message);
    this.name = 'SandboxLaneCapacityError';
    this.why = why;
    this.retryAfterMs = retryAfterMs;
  }
}

/** Whether a slot-reservation failure is the quota refusal (the sessions
 * domain's `SandboxQuotaError`, which a ctx shim passes through as-is)
 * rather than a store or transport fault. */
function isSandboxQuotaRefusal(error: unknown): error is Error {
  return (
    error instanceof Error && 'code' in error && error.code === 'QUOTA_EXCEEDED'
  );
}

/**
 * Run `work` in a session of its own and destroy the session afterwards.
 * Throws {@link SandboxLaneCapacityError} when there is no session to be
 * had for now, and whatever the create or the work throws otherwise.
 */
export async function withThrowawaySession<T>(
  ctx: ActionCtx,
  session: ThrowawaySession,
  work: () => Promise<T>,
): Promise<T> {
  const { sessionId, lane } = session;
  let rowId: string;
  try {
    rowId = await ctx.runMutation(
      internal.sandbox.session_mutations.reserveSessionSlotAndInsert,
      {
        organizationId: session.organizationId,
        sessionId,
        profile: 'default',
        ownerType: session.ownerType,
        ownerId: sessionId,
        createdBy: session.createdBy,
      },
    );
  } catch (error) {
    if (isSandboxQuotaRefusal(error)) {
      throw new SandboxLaneCapacityError('quota', error.message);
    }
    throw error;
  }

  let created = false;
  try {
    try {
      await sessionCreate({
        sessionId,
        organizationId: session.organizationId,
        profile: 'default',
        // The deployment's own work never leaves the server for an
        // organization's device.
        placement: 'server',
        idleTimeoutMs: session.idleTimeoutMs,
        ...(session.maxFileBytes === undefined
          ? {}
          : { maxFileBytes: session.maxFileBytes }),
      });
      created = true;
    } catch (error) {
      await settleFailedCreate(ctx, { rowId, session, error });
      // A sandbox host at capacity or short of memory is a wait like a spent
      // budget, not a failure.
      if (error instanceof SpawnerBusyError) {
        throw new SandboxLaneCapacityError(
          'host',
          'the sandbox host is busy',
          error.queue !== undefined ? error.retryAfterMs : undefined,
        );
      }
      throw error;
    }
    await ctx.runMutation(internal.sandbox.session_mutations.setSessionStatus, {
      rowId,
      status: 'active',
    });
    return await work();
  } finally {
    // Only a session this run created is torn down here. A failed create's
    // row already reads `failed`: settling it `destroyed` would hide it from
    // the watchdog's COLLECT pass, the one pass that reaches what the create
    // may have left behind.
    if (created) {
      let destroyed = false;
      try {
        await sessionDestroy(sessionId);
        destroyed = true;
      } catch (error) {
        console.warn(
          `[${lane}] session ${sessionId} destroy failed (the watchdog's release pass reaps it):`,
          error instanceof Error ? error.message : error,
        );
        // A destroy that answered badly (a timed-out request whose removal
        // still finished, a passing 502) may still have taken the session:
        // a definitive "gone" frees the organization's slot now, rather than
        // after the release pass's horizon.
        destroyed = await sessionIsAlive(sessionId).then(
          (alive) => !alive,
          (probeError: unknown) => {
            console.warn(
              `[${lane}] session ${sessionId} liveness after a failed destroy unknown:`,
              probeError instanceof Error ? probeError.message : probeError,
            );
            return false;
          },
        );
      }
      // A session whose destroy failed may still run: its row stays live,
      // the one state the watchdog's release pass reaches. Settled as
      // destroyed, its container outlived every pass, outside the budget.
      if (destroyed) {
        try {
          await ctx.runMutation(
            internal.sandbox.session_mutations.markSessionRowDestroyed,
            { organizationId: session.organizationId, sessionId },
          );
        } catch (error) {
          console.warn(
            `[${lane}] session ${sessionId} row flip failed:`,
            error instanceof Error ? error.message : error,
          );
        }
      }
    }
  }
}

/**
 * Settle the reserved row of a create that failed: it reads `failed` with
 * `destroyed_at_ms` unset, which frees the work's slot and leaves the row to
 * the sandbox watchdog's COLLECT pass — the only pass that reaches a
 * `failed` row. A create the spawner refused for want of room (429) made
 * nothing, so it destroys nothing and its row is settled as collected: a
 * host that stays full refuses each poll of a waiting caller, and each would
 * otherwise cost a destroy round trip now and a COLLECT visit later. A
 * create cut short between Docker's create and start leaves a container in
 * state `created` that the spawner never adopts, and it pins its runtime
 * image through every later deploy until something destroys it.
 *
 * Before the flip, while the still-`creating` row holds the work's one slot
 * (once it reads `failed`, a second run of the same work may reserve the id
 * and create, and a later destroy would hit that run's session):
 *  - a DUPLICATE (409) destroys nothing. This create made nothing: the
 *    spawner already holds the id, or is creating it, for another run. The
 *    session id is deterministic for the work, so work that runs twice (a
 *    job retry, or a continuation enqueued twice) asks for the same id. And
 *    the spawner answers a probe with 404 while it is still creating a
 *    session, so the reconcile pass may already have settled the other
 *    run's row while that run works in the session. Between its create and
 *    its exec that session is idle, so `if_idle` would not spare it. The
 *    COLLECT pass settles this row past its grace: without a spawner call
 *    while a newer or live row carries the id, and otherwise with the same
 *    idle-only destroy.
 *  - any other failure asks the spawner to destroy what it holds under the
 *    id, when idle, as the agent lane does. Best-effort: a busy answer or a
 *    failed destroy is logged and left to the COLLECT pass, and never masks
 *    the create's error.
 */
async function settleFailedCreate(
  ctx: ActionCtx,
  args: { rowId: string; session: ThrowawaySession; error: unknown },
): Promise<void> {
  const { rowId } = args;
  const { sessionId, lane, unit } = args.session;
  if (args.error instanceof SpawnerBusyError) {
    await ctx.runMutation(internal.sandbox.session_mutations.setSessionStatus, {
      rowId,
      status: 'failed',
      collected: true,
    });
    return;
  }
  if (args.error instanceof SessionDuplicateError) {
    console.warn(
      `[${lane}] session ${sessionId} already exists spawner-side; this ${unit} destroys nothing and the watchdog collects its failed row`,
    );
  } else {
    await sessionDestroyIfIdle(sessionId)
      .then(({ busy }) => {
        if (busy)
          console.warn(
            `[${lane}] session ${sessionId} runs an exec after this failed create; the watchdog collects it once idle`,
          );
      })
      .catch((destroyError: unknown) => {
        console.warn(
          `[${lane}] destroy after failed create of ${sessionId} failed (the watchdog collects it):`,
          destroyError instanceof Error ? destroyError.message : destroyError,
        );
      });
  }
  await ctx.runMutation(internal.sandbox.session_mutations.setSessionStatus, {
    rowId,
    status: 'failed',
  });
}
