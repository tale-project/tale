'use node';

/**
 * `host_lease_acquire` and `host_lease_release` — the heavy-phase lease pair
 * of a project agent's task run. Before a phase that presses the sandbox
 * host every organization shares (a dependency install, an image build, a
 * check of a whole workspace, a full test suite) the agent asks the host for
 * a lease and runs the phase only once it is granted; it releases the lease
 * when the phase ends, and every lease its run still holds ends with the
 * run (`domains/sandbox/heavy-leases.ts`).
 *
 * The answers are written for the model: a grant names the lease and when
 * it ends; a refusal says why and in how many seconds to ask again; a host
 * that has no leases (it cannot be judged from here) tells the agent to run
 * the phase without one, so no agent ever waits for a lease that cannot
 * come. The run, its session and its organization come from the turn's
 * token, never from the call.
 */

import { z } from 'zod';

import { modelTimestamp } from '../../../../lib/shared/model-timestamp';
import type { ActionCtx } from '../../lib/ctx';
import { internal } from '../../lib/handler_names';
import {
  HOST_LEASE_ACQUIRE_TOOL,
  HOST_LEASE_RELEASE_TOOL,
} from '../../sandbox/tool_names';
import {
  isRecord,
  type BridgeBlocker,
  type ToolResult,
} from './workspace_tool_shared';

const GIB = 1024 ** 3;
const LABEL_MAX = 120;
const GROWTH_GIB_MAX = 1024;
const MEMORY_GIB_MAX = 256;
const MINUTES_MIN = 1;
const MINUTES_MAX = 120;

export const HOST_LEASE_ACQUIRE_DESCRIPTION =
  'Ask the sandbox host for a heavy-phase lease before a phase that presses ' +
  'it: installing dependencies, building an image, type-checking or linting ' +
  'a whole workspace, running a full test suite. Args: {label: string (what ' +
  `the phase is, e.g. "npm ci"; ≤ ${LABEL_MAX} characters), ` +
  'predictedGrowthGiB?: number (what it will write to disk; default 2, ' +
  `≤ ${GROWTH_GIB_MAX}), memoryGiB?: number (what it will hold in memory ` +
  `beyond your sandbox's own; default 1, ≤ ${MEMORY_GIB_MAX}), minutes?: ` +
  `number (how long it may take; ${MINUTES_MIN}–${MINUTES_MAX}, default ` +
  '30)}. Answers {granted: true, leaseId, expiresAt}: run the phase, then ' +
  'call host_lease_release. Or {granted: false, reason, retryAfterSeconds, ' +
  'guidance}: do not run the phase; wait retryAfterSeconds and ask again. ' +
  'reason pressure: the host is under load; limit: as many heavy phases as ' +
  'it runs at once already run; disk or memory: too little room beside ' +
  'them; stale or pacing: the host cannot judge right now; unreachable: the ' +
  'host did not answer; held: your run already holds a lease (one at a ' +
  'time). reason "unavailable" means this host has no leases (Kubernetes, ' +
  'Incus, a remote Docker daemon, an older sandbox service): run the phase ' +
  'without one. A lease ends at expiresAt and when your run ends.';

export const HOST_LEASE_RELEASE_DESCRIPTION =
  'Release a heavy-phase lease of your run as soon as its phase ends, so ' +
  'the next heavy phase on the host can start. Args: {leaseId: string} — ' +
  'the leaseId host_lease_acquire answered. Answers {released: true, ' +
  'leaseId}, also for a lease that had ended already. A lease of another ' +
  'run is not found.';

const leaseViewSchema = z.object({
  leaseId: z.string().min(1),
  label: z.string().nullable(),
  expiresAtMs: z.number(),
});

/** What the lease seam answers an acquire (`heavy-leases.ts`). */
const acquisitionSchema = z.discriminatedUnion('outcome', [
  z.object({ outcome: z.literal('granted'), lease: leaseViewSchema }),
  z.object({ outcome: z.literal('already_held'), lease: leaseViewSchema }),
  z.object({
    outcome: z.literal('refused'),
    reason: z.string().min(1),
    retryAfterMs: z.number(),
  }),
  z.object({ outcome: z.literal('unreachable'), retryAfterMs: z.number() }),
  z.object({ outcome: z.literal('unavailable') }),
  z.object({ outcome: z.literal('not_a_project_agent_run') }),
  z.object({ outcome: z.literal('run_ended') }),
]);

/** What the lease seam answers a release. */
const releaseSchema = z.discriminatedUnion('outcome', [
  z.object({
    outcome: z.literal('released'),
    leaseId: z.string(),
    alreadyReleased: z.boolean(),
  }),
  z.object({ outcome: z.literal('not_found') }),
  z.object({
    outcome: z.literal('deferred'),
    leaseId: z.string(),
    expiresAtMs: z.number(),
  }),
  z.object({ outcome: z.literal('not_a_project_agent_run') }),
  z.object({ outcome: z.literal('run_ended') }),
]);

/** Why the host holds a phase back, in a few words, by its reason. */
const HOLD_REASONS: Record<string, string> = {
  pressure: 'the host is under load',
  pacing: 'the host is pacing new work',
  stale: 'the host cannot read its load right now',
  limit: 'as many heavy phases as the host runs at once are already running',
  disk: 'the host would run short of disk beside the heavy phases already running',
  memory:
    'the host would run short of memory beside the heavy phases already running',
  unreachable: 'the sandbox host did not answer',
};

const RUN_ENDED: BridgeBlocker = {
  code: 'run_ended',
  guidance:
    'The task run this session served has ended, so its workspace tools ' +
    'act for nobody any more. Stop; do not retry.',
};

/** The arguments of an acquire, read and bounded. */
export interface HostLeaseArgs {
  label: string;
  predictedGrowthBytes?: number;
  memoryBytes?: number;
  ttlMs?: number;
}

/** A size in GiB as bytes, when it is a number within its bound. */
function gibToBytes(raw: unknown, max: number): number | null | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== 'number' || !Number.isFinite(raw) || raw < 0 || raw > max)
    return null;
  return Math.round(raw * GIB);
}

/** Read an acquire's arguments; null when one is missing or out of bounds. */
export function readHostLeaseArgs(
  callArgs: Record<string, unknown>,
): HostLeaseArgs | null {
  const label =
    typeof callArgs.label === 'string'
      ? callArgs.label.replace(/\s+/g, ' ').trim()
      : '';
  if (label === '' || label.length > LABEL_MAX) return null;
  const predictedGrowthBytes = gibToBytes(
    callArgs.predictedGrowthGiB,
    GROWTH_GIB_MAX,
  );
  const memoryBytes = gibToBytes(callArgs.memoryGiB, MEMORY_GIB_MAX);
  if (predictedGrowthBytes === null || memoryBytes === null) return null;
  const minutes = callArgs.minutes;
  if (
    minutes !== undefined &&
    minutes !== null &&
    (typeof minutes !== 'number' ||
      !Number.isFinite(minutes) ||
      minutes < MINUTES_MIN ||
      minutes > MINUTES_MAX)
  ) {
    return null;
  }
  return {
    label,
    ...(predictedGrowthBytes !== undefined ? { predictedGrowthBytes } : {}),
    ...(memoryBytes !== undefined ? { memoryBytes } : {}),
    ...(typeof minutes === 'number'
      ? { ttlMs: Math.round(minutes * 60_000) }
      : {}),
  };
}

/** Seconds to wait before asking again: whole seconds, at least one. */
function retryAfterSeconds(retryAfterMs: number): number {
  return Math.max(1, Math.ceil(retryAfterMs / 1000));
}

/** A refusal the agent waits out, with the words that say why. */
function holdAnswer(reason: string, retryAfterMs: number): ToolResult {
  const seconds = retryAfterSeconds(retryAfterMs);
  const why = HOLD_REASONS[reason] ?? `the host refused it (${reason})`;
  return {
    status: 'ok',
    output: {
      granted: false,
      reason,
      retryAfterSeconds: seconds,
      guidance:
        `The host holds this phase back: ${why}. Do not run the phase yet: ` +
        `wait ${seconds} seconds (sleep ${seconds}), then call ` +
        `${HOST_LEASE_ACQUIRE_TOOL} again. Meanwhile you may do work that ` +
        'does not press the host.',
    },
  };
}

async function acquire(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    sessionId: string;
    taskRunExecId?: string;
    callArgs: Record<string, unknown>;
  },
): Promise<ToolResult> {
  const request = readHostLeaseArgs(args.callArgs);
  if (request === null) {
    return {
      status: 'invalid_args',
      message:
        `${HOST_LEASE_ACQUIRE_TOOL} needs {label: string (1–${LABEL_MAX} ` +
        `characters), predictedGrowthGiB?: number (0–${GROWTH_GIB_MAX}), ` +
        `memoryGiB?: number (0–${MEMORY_GIB_MAX}), minutes?: number ` +
        `(${MINUTES_MIN}–${MINUTES_MAX})}.`,
    };
  }
  const parsed = acquisitionSchema.safeParse(
    await ctx.runMutation(internal.sandbox.heavy_leases.acquireRunLease, {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      ...(args.taskRunExecId !== undefined
        ? { taskRunExecId: args.taskRunExecId }
        : {}),
      ...request,
    }),
  );
  if (!parsed.success) {
    return { status: 'error', message: 'The lease answered nothing usable.' };
  }
  const answer = parsed.data;
  switch (answer.outcome) {
    case 'granted': {
      const { leaseId } = answer.lease;
      return {
        status: 'ok',
        output: {
          granted: true,
          leaseId,
          expiresAt: modelTimestamp(answer.lease.expiresAtMs),
          guidance:
            'Run the phase now, then call ' +
            `${HOST_LEASE_RELEASE_TOOL} {leaseId: "${leaseId}"} as soon as ` +
            'it ends: another agent may be waiting for it. The lease ends ' +
            'by itself at expiresAt and when your run ends.',
        },
      };
    }
    case 'already_held': {
      const { leaseId, label } = answer.lease;
      const expiresAt = modelTimestamp(answer.lease.expiresAtMs);
      return {
        status: 'ok',
        output: {
          granted: false,
          reason: 'held',
          heldLease: { leaseId, label, expiresAt },
          guidance:
            `Your run already holds lease ${leaseId}` +
            (label !== null ? ` for "${label}"` : '') +
            ` until ${expiresAt ?? 'its expiry'}; a run holds one at a time. ` +
            'If that phase has ended, release the lease with ' +
            `${HOST_LEASE_RELEASE_TOOL} and ask again; otherwise wait for ` +
            'that phase to end first.',
        },
      };
    }
    case 'refused':
      return holdAnswer(answer.reason, answer.retryAfterMs);
    case 'unreachable':
      return holdAnswer('unreachable', answer.retryAfterMs);
    case 'unavailable':
      return {
        status: 'ok',
        output: {
          granted: false,
          reason: 'unavailable',
          guidance:
            'This host has no heavy-phase leases: it cannot be judged from ' +
            'here (Kubernetes, Incus, a remote Docker daemon, or an older ' +
            'sandbox service). Run the phase without a lease; do not wait ' +
            'for one.',
        },
      };
    case 'not_a_project_agent_run':
      return {
        status: 'unavailable',
        blockers: [
          {
            code: 'not_a_project_agent_run',
            guidance:
              "Only a project agent's task run holds heavy-phase leases, on " +
              'its own sandbox. Run the phase without a lease.',
          },
        ],
      };
  }
  // What is left is a run that has ended.
  return { status: 'unavailable', blockers: [RUN_ENDED] };
}

async function release(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    sessionId: string;
    taskRunExecId?: string;
    callArgs: Record<string, unknown>;
  },
): Promise<ToolResult> {
  const leaseId =
    typeof args.callArgs.leaseId === 'string'
      ? args.callArgs.leaseId.trim()
      : '';
  if (!/^[a-zA-Z0-9_-]{1,64}$/.test(leaseId)) {
    return {
      status: 'invalid_args',
      message:
        `${HOST_LEASE_RELEASE_TOOL} needs {leaseId: string}, the leaseId ` +
        `${HOST_LEASE_ACQUIRE_TOOL} answered.`,
    };
  }
  const parsed = releaseSchema.safeParse(
    await ctx.runMutation(internal.sandbox.heavy_leases.releaseRunLease, {
      organizationId: args.organizationId,
      sessionId: args.sessionId,
      ...(args.taskRunExecId !== undefined
        ? { taskRunExecId: args.taskRunExecId }
        : {}),
      leaseId,
    }),
  );
  if (!parsed.success) {
    return { status: 'error', message: 'The release answered nothing usable.' };
  }
  const answer = parsed.data;
  switch (answer.outcome) {
    case 'released':
      return {
        status: 'ok',
        output: {
          released: true,
          leaseId: answer.leaseId,
          ...(answer.alreadyReleased ? { alreadyReleased: true } : {}),
        },
      };
    case 'deferred':
      return {
        status: 'ok',
        output: {
          released: false,
          leaseId: answer.leaseId,
          guidance:
            'The host could not be asked now. Go on with your work: the ' +
            `lease ends by itself at ${modelTimestamp(answer.expiresAtMs) ?? 'its expiry'} ` +
            'and when your run ends.',
        },
      };
    case 'not_found':
      return {
        status: 'not_found',
        message:
          `Your run holds no lease ${leaseId}. Release only a leaseId ` +
          `${HOST_LEASE_ACQUIRE_TOOL} answered your run.`,
      };
    case 'not_a_project_agent_run':
      return {
        status: 'unavailable',
        blockers: [
          {
            code: 'not_a_project_agent_run',
            guidance:
              "Only a project agent's task run holds heavy-phase leases; " +
              'there is nothing to release here.',
          },
        ],
      };
  }
  // What is left is a run that has ended.
  return { status: 'unavailable', blockers: [RUN_ENDED] };
}

/** Whether a tool name is one of the lease pair. */
export function isHostLeaseTool(tool: string): boolean {
  return tool === HOST_LEASE_ACQUIRE_TOOL || tool === HOST_LEASE_RELEASE_TOOL;
}

/** Run one call of the lease pair for the turn the token names. */
export async function runHostLeaseTool(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    sessionId: string;
    taskRunExecId?: string;
    tool: string;
    callArgs: unknown;
  },
): Promise<ToolResult> {
  const call = {
    organizationId: args.organizationId,
    sessionId: args.sessionId,
    ...(args.taskRunExecId !== undefined
      ? { taskRunExecId: args.taskRunExecId }
      : {}),
    callArgs: isRecord(args.callArgs) ? args.callArgs : {},
  };
  return args.tool === HOST_LEASE_ACQUIRE_TOOL
    ? acquire(ctx, call)
    : release(ctx, call);
}
