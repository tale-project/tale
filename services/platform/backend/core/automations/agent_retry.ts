/**
 * Pure auto-retry gating for the automation `agent` node. Isolated like
 * `tasks/task_auto_retry.ts` so the logic is unit-testable without a
 * database; the orchestration (consume the errored settle → decide → re-kick
 * in place) lives in `stepper.ts` (`stepAgentNode`).
 *
 * Semantics (2026-08-23, parity with the task lane): a failed turn re-kicks
 * immediately — no backoff, the harness already backed off per-request —
 * under a fixed in-node budget. Unlike the task lane there is no run-history
 * walk: the attempt counter — and the streak of credential rotations — lives
 * on the agent cursor and dies with the node execution, so only the progress
 * reset survives from the streak semantics.
 */

import {
  AUTO_RETRY_MAX_ATTEMPTS,
  AUTO_RETRY_PROGRESS_MS,
  CREDENTIAL_ROTATION_FREE_RETRIES,
} from '../tasks/task_auto_retry';

/** Producer-side failure classification, stamped where each failure is
 * PRODUCED (the `agent_host.ts` settle sites) — never regex-derived from the
 * free-text reason. */
export type WorkflowAgentFailureCode =
  | 'harness_error'
  | 'turn_crashed'
  | 'session_gone'
  | 'start_failed'
  | 'harvest_failed'
  | 'resume_failed'
  | 'deadline'
  | 'ask_expired'
  /** The org's spend cap refused the start — the cap only moves with the
   * period or an admin, so a retry would only be refused again. */
  | 'budget_exceeded'
  /** The vendor answered 401 to a turn the subscription broker served: the
   * broker refreshed the account under it, revoking the turn's token. The
   * re-kick vends again and resumes, outside the budget
   * ({@link planWorkflowAgentRetry}). */
  | 'credential_rotated'
  /** The start met a subscription broker whose every account was cooling
   * down after a rate limit, so nothing ran. The re-kick's start waits until
   * the first account is back — for free when the refused attempt retried
   * one that ended on a 429, the rate limit that cooled the pool
   * ({@link planWorkflowAgentRetry}). */
  | 'credential_cooldown'
  /** The start found no sandbox room: the organization's session budget was
   * spent, or the sandbox host was at capacity or short of memory. Nothing
   * ran, and the room frees as other work settles: the re-kick waits out the
   * refusal's retry hint and spends no attempt and no execution of the run's
   * guard, for at most {@link SANDBOX_ROOM_MAX_WAIT_MS} in a row
   * ({@link planWorkflowAgentRetry}). */
  | 'sandbox_capacity'
  /** The start found the run's workspace being deleted: an administrator's
   * Destroy of its session was queued, retrying or running. No wait for
   * room and no retry: once the Destroy settles, a re-kick would continue
   * the run in a fresh, empty workspace, without what its earlier steps
   * left there. */
  | 'sandbox_destroying';

/** The longest an agent node waits for sandbox room before its run fails:
 * room frees as other work settles, but a deployment whose capacity is
 * wedged must still end the run with a reason a person can act on. */
export const SANDBOX_ROOM_MAX_WAIT_MS = 2 * 60 * 60_000;

/** The longest one start of a node waiting for sandbox room is held back:
 * past it, a node still waiting asks about once a minute on average. */
export const SANDBOX_ROOM_RETRY_CEILING_MS = 2 * 60_000;

/** The most a start that holds a place in the spawner's line comes back
 * after its hint: enough to keep waiters refused together apart. */
const QUEUED_RETRY_JITTER_MS = 1_000;

/**
 * When the next start of a node waiting for sandbox room may run. Never
 * before the refusal's retry hint. A spawner that keeps a first-come line
 * for host room gives the place's own hint (`queued`): the start comes back
 * then, within a second — later, and the waiters behind it take the room.
 * Otherwise, past the hint, at a moment drawn at random from a window that
 * doubles with each refusal in a row, up to
 * {@link SANDBOX_ROOM_RETRY_CEILING_MS}: such a host answers every waiter
 * with the same hint, so a fixed delay kept the waiters in lockstep — a
 * burst of creates the spawner refused together, every ten seconds for as
 * long as the wait lasted; the doubling thins a long wait's attempts, and
 * the draw spreads waiters refused together across the window.
 */
export function sandboxRoomRetryAtMs(args: {
  now: number;
  /** The refusal's retry hint. */
  retryAfterMs: number;
  /** Refusals in a row of this wait, the one being answered included. */
  refusals: number;
  /** The refusal named the start's place in the spawner's line. */
  queued?: boolean;
  random?: () => number;
}): number {
  const hint = Math.min(
    Math.max(args.retryAfterMs, 0),
    SANDBOX_ROOM_RETRY_CEILING_MS,
  );
  if (args.queued === true) {
    const jitter = (args.random ?? Math.random)() * QUEUED_RETRY_JITTER_MS;
    return args.now + hint + Math.round(jitter);
  }
  const window = Math.min(
    SANDBOX_ROOM_RETRY_CEILING_MS,
    hint * 2 ** Math.max(1, args.refusals),
  );
  const draw = (args.random ?? Math.random)();
  return args.now + hint + Math.round(draw * (window - hint));
}

/** Failures where a retry is pure waste: the turn burned its 12h window, or
 * the operator ignored the agent's question for the whole ask TTL — a fresh
 * turn would only ask again — or worse than waste: the run's workspace is
 * being destroyed, and a retry after the Destroy would start over an empty
 * one. Everything else — provider errors, crashes, vanished sessions,
 * harvest hiccups — retries by DEFAULT, including an absent code, so a
 * future failure producer inherits the retry posture without opting in. */
const NO_RETRY_FAILURE_CODES: ReadonlySet<string> = new Set([
  'deadline',
  'ask_expired',
  'budget_exceeded',
  'sandbox_destroying',
] satisfies WorkflowAgentFailureCode[]);

export function isWorkflowAgentRetryable(code: string | undefined): boolean {
  return code === undefined || !NO_RETRY_FAILURE_CODES.has(code);
}

/** What a re-kick continues: the failed turn's conversation, and why it
 * ended — the words the resumed agent is told. */
export interface WorkflowAgentRetryResume {
  agentSessionId: string;
  reason: string;
  /** An answered question the conversation has not seen: the resume opens
   * with its answer instead of the retry prompt. */
  askId?: string;
}

/** Failures that leave no conversation to continue: the sandbox session is
 * gone with its transcript, or the turn never launched at all. Everything
 * else — a provider error mid-answer, a truncated stream, a harness crash —
 * cut a conversation that is still on disk, so the retry picks it up. */
const NO_RESUME_FAILURE_CODES: ReadonlySet<string> = new Set([
  'session_gone',
  'start_failed',
  'credential_cooldown',
  'sandbox_capacity',
] satisfies WorkflowAgentFailureCode[]);

/** Starts refused before anything launched: the conversation the refused
 * attempt was to resume still stands, with the cut that ended it. */
const NEVER_LAUNCHED_FAILURE_CODES: ReadonlySet<string> = new Set([
  'credential_cooldown',
  'sandbox_capacity',
] satisfies WorkflowAgentFailureCode[]);

/**
 * The resume a retry of this settle should carry, or undefined when the
 * re-kick must be a fresh conversation: no handle announced (a harness that
 * died before its init line), a failure class with nothing to resume, or a
 * harness the platform never resumes (`capabilities.resume: false` in its
 * YAML — the exec builder refuses a handle on it). A start refused while
 * the broker pool cooled down never launched, so the conversation it was to
 * resume (`parked.resumedFrom`) still stands, with the cut that ended it —
 * and so does the asking conversation an answered question's delivery was
 * refused for (`settled.undeliveredAskId`), which the re-kick resumes with
 * that answer; without a handle to it, the fresh start folds every answer
 * into its prompt.
 */
export function workflowAgentRetryResume(
  settled: {
    failureCode?: string;
    agentSessionId?: string;
    undeliveredAskId?: string;
  },
  reason: string,
  parked: Pick<
    WorkflowAgentAttempt,
    'resumedFrom' | 'resumeReason' | 'resumeAskId'
  >,
  harness: { resumable: boolean },
): WorkflowAgentRetryResume | undefined {
  if (!harness.resumable) return undefined;
  if (settled.undeliveredAskId !== undefined) {
    return settled.agentSessionId !== undefined
      ? {
          agentSessionId: settled.agentSessionId,
          reason,
          askId: settled.undeliveredAskId,
        }
      : undefined;
  }
  if (
    settled.failureCode !== undefined &&
    NEVER_LAUNCHED_FAILURE_CODES.has(settled.failureCode) &&
    parked.resumedFrom !== undefined
  ) {
    return {
      agentSessionId: parked.resumedFrom,
      reason: parked.resumeReason ?? reason,
      ...(parked.resumeAskId !== undefined
        ? { askId: parked.resumeAskId }
        : {}),
    };
  }
  if (settled.agentSessionId === undefined) return undefined;
  if (
    settled.failureCode !== undefined &&
    NO_RESUME_FAILURE_CODES.has(settled.failureCode)
  ) {
    return undefined;
  }
  return { agentSessionId: settled.agentSessionId, reason };
}

/** The message a resumed conversation opens with: the cut was the
 * platform's, the work stands, carry on — never a second copy of the node
 * prompt, which the conversation already holds. */
export function retryResumePrompt(reason: string): string {
  return [
    `Your previous turn on this task was cut short by an infrastructure failure, not by anything you did: ${reason}.`,
    '',
    'Continue the task from where you left off. The workspace and /agent/output are exactly as you left them — do not redo work that is already done, and do not ask the operator again what they have already answered.',
  ].join('\n');
}

/** Execution time of the settled attempt — 0 when it never launched.
 * `launchedAt` is stamped only after the start action's mint succeeds, so a
 * turn that died before actually running reads as ZERO duration, never as
 * progress (the stamp racing the kick-side cursor commit loses the same
 * way, deliberately: a missing stamp must undercount, not reset). */
function executedMsOf(launchedAt: number | undefined, now: number): number {
  if (launchedAt === undefined) return 0;
  return Math.max(0, now - launchedAt);
}

/** The attempt number the re-kick parks under: an attempt that executed past
 * the progress threshold proved the failure is not a rapid crash loop, so
 * the budget refreshes instead of counting toward exhaustion. */
function nextAttempt(prev: number, executedMs: number): number {
  return executedMs >= AUTO_RETRY_PROGRESS_MS ? 1 : prev + 1;
}

/** The burned-hash list is bounded because progress resets can stretch one
 * node execution past the nominal 4 attempts; the exclusion is soft (the
 * credential resolve falls back to the full pool when it would empty it),
 * so dropping the oldest entries only widens rotation, never starves it. */
const MAX_BURNED_BROKER_HASHES = 8;

/** Fold the settled attempt's broker-token hash into the carried exclusion
 * list: deduped, most recent last, oldest dropped past the cap. */
function mergeBurnedHashes(
  prev: readonly string[] | undefined,
  current: string | undefined,
): string[] {
  const merged: string[] = [];
  for (const hash of [
    ...(prev ?? []),
    ...(current === undefined ? [] : [current]),
  ]) {
    const existing = merged.indexOf(hash);
    if (existing !== -1) merged.splice(existing, 1);
    merged.push(hash);
  }
  return merged.slice(-MAX_BURNED_BROKER_HASHES);
}

/** The parked attempt's retry state, as its cursor carries it. */
export interface WorkflowAgentAttempt {
  attempt?: number;
  launchedAt?: number;
  brokerTokenHash?: string;
  burnedBrokerTokenHashes?: string[];
  credentialRotations?: number;
  retriedRateLimit?: boolean;
  resumedFrom?: string;
  resumeReason?: string;
  resumeAskId?: string;
  waitingForRoomSince?: number;
  roomRefusals?: number;
}

/**
 * When the attempt's wait for sandbox room began, or undefined when it is
 * not waiting for room. A start that launched after the wait began ended
 * that wait: a later refusal — the resume of an answered question, hours
 * on — begins a new one instead of inheriting the old one's clock.
 */
export function roomWaitSince(
  parked: Pick<WorkflowAgentAttempt, 'waitingForRoomSince' | 'launchedAt'>,
): number | undefined {
  return parked.waitingForRoomSince !== undefined &&
    (parked.launchedAt === undefined ||
      parked.waitingForRoomSince >= parked.launchedAt)
    ? parked.waitingForRoomSince
    : undefined;
}

/** What a re-kick of a failed attempt carries, and whether it may happen. */
export interface WorkflowAgentRetryPlan {
  /** Whether the budget admits the re-kick (the failure code's own gate,
   * `isWorkflowAgentRetryable`, is the caller's). */
  retry: boolean;
  /** The attempt number the re-kick parks under. */
  attempt: number;
  /** The broker hashes the re-kick's vend steps past. */
  burnedBrokerTokenHashes: string[];
  /** Credential rotations in a row, the failed attempt's included (0 when
   * it failed any other way) — carried so the next one can tell. */
  credentialRotations: number;
  /** Set while the node waits for sandbox room: when the wait began. */
  waitingForRoomSince?: number;
  /** Set while the node waits for sandbox room: the refusals in a row, the
   * failed attempt's included, which the re-kick's delay grows with
   * ({@link sandboxRoomRetryAtMs}). */
  roomRefusals?: number;
}

/**
 * Plan the re-kick of a failed attempt (task-lane parity with
 * `resolveAutoRetryBudget`). An ordinary failure counts toward the budget —
 * unless the attempt executed past the progress threshold — and burns its
 * broker account. A credential rotation — the broker refreshed the account
 * under the turn — is free up to `CREDENTIAL_ROTATION_FREE_RETRIES` in a row:
 * the attempt number stays unless progress resets the budget, and the
 * account stays in the pool, since it holds a fresh token. A rotation after
 * a quarter of an hour of work also starts a new rotation streak; the third
 * short one in a row takes the ordinary path, so a grant that is truly dead
 * cannot loop. A start refused while the broker pool cooled down is free
 * when the refused attempt retried a 429 — the failure that cooled the pool
 * already counted, and the wait is the same event — and ordinary otherwise,
 * so a pool that other work keeps cooling cannot hold the node in a loop.
 */
export function planWorkflowAgentRetry(
  parked: WorkflowAgentAttempt,
  failureCode: string | undefined,
  now: number,
): WorkflowAgentRetryPlan {
  const attempt = parked.attempt ?? 0;
  if (failureCode === 'sandbox_capacity') {
    const waitingSince = roomWaitSince(parked);
    const since = waitingSince ?? now;
    return {
      retry: now - since < SANDBOX_ROOM_MAX_WAIT_MS,
      attempt,
      burnedBrokerTokenHashes: [...(parked.burnedBrokerTokenHashes ?? [])],
      credentialRotations: 0,
      waitingForRoomSince: since,
      roomRefusals:
        (waitingSince !== undefined ? (parked.roomRefusals ?? 0) : 0) + 1,
    };
  }
  if (
    failureCode === 'credential_cooldown' &&
    parked.retriedRateLimit === true
  ) {
    return {
      retry: true,
      attempt,
      burnedBrokerTokenHashes: [...(parked.burnedBrokerTokenHashes ?? [])],
      credentialRotations: 0,
    };
  }
  const executedMs = executedMsOf(parked.launchedAt, now);
  const credentialRotations =
    failureCode === 'credential_rotated'
      ? executedMs >= AUTO_RETRY_PROGRESS_MS
        ? 1
        : (parked.credentialRotations ?? 0) + 1
      : 0;
  if (
    credentialRotations > 0 &&
    credentialRotations <= CREDENTIAL_ROTATION_FREE_RETRIES
  ) {
    return {
      retry: true,
      // Work past the progress threshold refreshes the budget, as it does
      // for any failure — and the free re-kick then spends none of it.
      attempt: executedMs >= AUTO_RETRY_PROGRESS_MS ? 0 : attempt,
      burnedBrokerTokenHashes: [...(parked.burnedBrokerTokenHashes ?? [])],
      credentialRotations,
    };
  }
  const retryAttempt = nextAttempt(attempt, executedMs);
  return {
    retry: retryAttempt <= AUTO_RETRY_MAX_ATTEMPTS,
    attempt: retryAttempt,
    burnedBrokerTokenHashes: mergeBurnedHashes(
      parked.burnedBrokerTokenHashes,
      parked.brokerTokenHash,
    ),
    credentialRotations,
  };
}
