import { z } from 'zod';

import { timeZoneSchema } from './automation-trigger';

/**
 * A project's dispatch — the one zod source of its shape. Dispatch keeps a
 * project's ready work moving without anyone starting each run: which of the
 * project's agents take that work, how many runs they may hold at once,
 * which tasks count as ready, how carefully a start is admitted on the
 * shared sandbox host, and the standing roles started on a schedule. The
 * app, REST and managed configuration write it; the platform parses it again
 * for every reader and checks what needs the database (that the agents and
 * tasks belong to the project, that a cron expression reads).
 *
 * Every field a reader can default is optional, and readers apply
 * {@link DISPATCH_DEFAULTS}: nothing is written that the caller did not
 * send, so a declaration that leaves a field out keeps reading as declared.
 *
 * Imports only `zod` and its siblings: the browser and the server both load
 * it.
 */

const identity = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[^/\\\x00-\x20\x7f]+$/);

/** The columns dispatch takes ready work from. */
export const DISPATCH_STATUSES = ['todo', 'backlog'] as const;
export type DispatchStatus = (typeof DISPATCH_STATUSES)[number];

/** Which tasks an agent of the pool may take: only those assigned to it, or
 * also unassigned ones, which it is then assigned. */
export const DISPATCH_ASSIGNMENTS = ['assigned', 'pool'] as const;
export type DispatchAssignment = (typeof DISPATCH_ASSIGNMENTS)[number];

/** How carefully a start is admitted on the sandbox host: the deployment's
 * own thresholds, or the stricter ones a busy shared host needs (load per
 * CPU, CPU, memory and I/O pressure). A project can only tighten what the
 * deployment allows, never loosen it. */
export const DISPATCH_ADMISSION_PRESETS = ['default', 'conservative'] as const;
export type DispatchAdmissionPreset =
  (typeof DISPATCH_ADMISSION_PRESETS)[number];

/** As many agents as a project may have. */
export const DISPATCH_POOL_MAX = 50;
export const DISPATCH_STANDING_ROLES_MAX = 20;
export const DISPATCH_ROLE_BRIEF_MAX = 4_000;
export const DISPATCH_LABELS_MAX = 20;
export const DISPATCH_GATES_MAX = 10;
export const DISPATCH_GATE_REASON_MAX = 500;

/** What a gate does while nobody has reported on it for its
 * `staleAfterSeconds`: let its work go, or hold it. */
export const DISPATCH_GATE_WHEN_STALE = ['open', 'hold'] as const;
export type DispatchGateWhenStale = (typeof DISPATCH_GATE_WHEN_STALE)[number];

/** What readers assume for a field the dispatch leaves out. */
export const DISPATCH_DEFAULTS = {
  perAgentConcurrency: 1,
  rebalance: false,
  startSpacingSeconds: 30,
  recheckSeconds: [60, 120, 240],
  gateStaleAfterSeconds: 600,
  gateWhenStale: 'open',
} as const;

const unique = (values: readonly string[]) =>
  new Set(values).size === values.length;

const labelName = z.string().trim().min(1).max(50);

/** A role key: lower-case letters, digits and inner hyphens, 1 to 64
 * characters. It names the role in occurrence labels and readbacks. */
export const dispatchRoleKeySchema = z
  .string()
  .regex(
    /^[a-z0-9](?:[a-z0-9-]{0,62}[a-z0-9])?$/,
    'A role key uses lower-case letters, digits and inner hyphens, up to 64 characters.',
  );

/**
 * A standing role's time zone: any zone `timeZoneSchema` takes (an IANA name
 * in any case, or a fixed offset), kept as the document spells it, trimmed.
 * It is not rewritten into `Intl`'s spelling the way a trigger's zone is,
 * because the engines that parse a dispatch disagree on that spelling: Node
 * stores `Etc/UTC` as `UTC` and `Europe/Kyiv` as `Europe/Kiev`, where Bun,
 * which runs the CLI, keeps both. A rewritten zone would never match the
 * declaration a CLI planned, so the dispatch would never read as applied; a
 * managed schedule keeps its zone as spelled for the same reason.
 */
const roleTimeZoneSchema = z
  .string()
  .trim()
  .max(100)
  .superRefine((zone, ctx) => {
    const checked = timeZoneSchema.safeParse(zone);
    if (checked.success) return;
    for (const issue of checked.error.issues) {
      // A zone that is too long is refused once, by the `max` above.
      if (issue.code !== 'custom') continue;
      ctx.addIssue({
        code: 'custom',
        message: issue.message,
        path: issue.path,
        ...(issue.params !== undefined ? { params: issue.params } : {}),
      });
    }
  });

/**
 * A standing role: an agent started on its own task on a schedule. Each
 * occurrence moves the task to In progress and hands the agent its brief,
 * labelled with the occurrence in the schedule's time zone. An occurrence
 * that finds the task still worked on is coalesced, never queued behind it.
 */
export const projectDispatchRoleSchema = z.strictObject({
  key: dispatchRoleKeySchema,
  taskId: identity,
  agentId: identity,
  /** A five-field cron expression, read in `timezone`. */
  cron: z.string().trim().min(1).max(200),
  timezone: roleTimeZoneSchema,
  /** A short name for what this schedule's runs do, such as `full` or
   * `light`: given to the agent with every occurrence. */
  mode: z.string().trim().min(1).max(40).optional(),
  /** What the agent addresses first on every occurrence. */
  brief: z.string().trim().min(1).max(DISPATCH_ROLE_BRIEF_MAX).optional(),
});
export type ProjectDispatchRole = z.infer<typeof projectDispatchRoleSchema>;

/**
 * A gate: a signal from outside the platform that holds the ready work it
 * governs — a CI system whose runner queue is full, a deploy freeze, a
 * vendor's outage. Something outside reports on it (`POST
 * .../dispatch/by-project/:projectId/gates/:key`), either a state or a value
 * the gate judges with hysteresis: at or above `holdAt` it holds, and once
 * held it opens again only below `recoverBelow` (half of `holdAt` unless
 * said), so a signal hovering at the threshold does not flap. A gate governs
 * the ready work carrying one of its `labels`, or all ready work without
 * them; standing roles are never held by a gate. A report older than
 * `staleAfterSeconds` is stale: the gate then does what `whenStale` says.
 * With `startSpacingSeconds`, two starts of the work it governs are at least
 * that far apart.
 */
export const projectDispatchGateSchema = z
  .strictObject({
    key: dispatchRoleKeySchema,
    labels: z.array(labelName).min(1).max(DISPATCH_LABELS_MAX).optional(),
    holdAt: z.number().finite().optional(),
    recoverBelow: z.number().finite().optional(),
    staleAfterSeconds: z.number().int().min(60).max(86_400).optional(),
    whenStale: z.enum(DISPATCH_GATE_WHEN_STALE).optional(),
    startSpacingSeconds: z.number().int().min(0).max(86_400).optional(),
  })
  .superRefine((gate, ctx) => {
    if (gate.recoverBelow !== undefined && gate.holdAt === undefined) {
      ctx.addIssue({
        code: 'custom',
        path: ['recoverBelow'],
        message: 'A gate recovers below a value only when it holds at one.',
      });
    }
    if (
      gate.recoverBelow !== undefined &&
      gate.holdAt !== undefined &&
      gate.recoverBelow > gate.holdAt
    ) {
      ctx.addIssue({
        code: 'custom',
        path: ['recoverBelow'],
        message: 'A gate recovers below its hold value, not above it.',
      });
    }
  });
export type ProjectDispatchGate = z.infer<typeof projectDispatchGateSchema>;

/** A report on a gate: its state, or a value the gate judges by `holdAt`. */
export const dispatchGateReportSchema = z.union([
  z.strictObject({
    state: z.enum(['open', 'hold']),
    reason: z.string().trim().min(1).max(DISPATCH_GATE_REASON_MAX).optional(),
  }),
  z.strictObject({
    value: z.number().finite(),
    reason: z.string().trim().min(1).max(DISPATCH_GATE_REASON_MAX).optional(),
  }),
]);
export type DispatchGateReport = z.infer<typeof dispatchGateReportSchema>;

export const projectDispatchAdmissionSchema = z.strictObject({
  preset: z.enum(DISPATCH_ADMISSION_PRESETS),
  /** The least time between two starts dispatch makes, in seconds. */
  startSpacingSeconds: z.number().int().min(0).max(3_600).optional(),
  /** When the sandbox host holds a start, dispatch asks again after these
   * delays in turn, then keeps the last. */
  recheckSeconds: z
    .array(z.number().int().min(10).max(3_600))
    .min(1)
    .max(10)
    .optional(),
});

export const projectDispatchSchema = z
  .strictObject({
    enabled: z.boolean(),
    /** The pool: the project's agents dispatch starts on ready work. */
    agents: z
      .array(identity)
      .max(DISPATCH_POOL_MAX)
      .refine(unique, 'An agent appears in the pool once.'),
    /** The most runs the pool's agents hold at once, whoever started them;
     * a standing role still starts on its schedule when the pool is full. */
    maxConcurrentRuns: z.number().int().min(1).max(100),
    /** The most runs one agent of the pool holds at once (default 1). */
    perAgentConcurrency: z.number().int().min(1).max(5).optional(),
    /** The columns ready work is taken from, in this order of preference. */
    statuses: z
      .array(z.enum(DISPATCH_STATUSES))
      .min(1)
      .max(DISPATCH_STATUSES.length)
      .refine(unique, 'A column appears once.'),
    assignment: z.enum(DISPATCH_ASSIGNMENTS),
    /** Move a task that never started from a busy agent of the pool to an
     * idle one (default off). */
    rebalance: z.boolean().optional(),
    /** Take only tasks with one of `include`, and none with one of
     * `exclude`, matched by label name, case-insensitively. */
    labels: z
      .strictObject({
        include: z.array(labelName).max(DISPATCH_LABELS_MAX).optional(),
        exclude: z.array(labelName).max(DISPATCH_LABELS_MAX).optional(),
      })
      .optional(),
    admission: projectDispatchAdmissionSchema.optional(),
    standingRoles: z
      .array(projectDispatchRoleSchema)
      .max(DISPATCH_STANDING_ROLES_MAX)
      .optional(),
    /** Signals from outside that hold the ready work they govern. */
    gates: z
      .array(projectDispatchGateSchema)
      .max(DISPATCH_GATES_MAX)
      .optional(),
  })
  .superRefine((value, ctx) => {
    const keys = new Set<string>();
    for (const [index, role] of (value.standingRoles ?? []).entries()) {
      if (keys.has(role.key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['standingRoles', index, 'key'],
          message: `The role key "${role.key}" is used twice.`,
        });
      }
      keys.add(role.key);
    }
    const gates = new Set<string>();
    for (const [index, gate] of (value.gates ?? []).entries()) {
      if (gates.has(gate.key)) {
        ctx.addIssue({
          code: 'custom',
          path: ['gates', index, 'key'],
          message: `The gate key "${gate.key}" is used twice.`,
        });
      }
      gates.add(gate.key);
    }
  });
export type ProjectDispatch = z.infer<typeof projectDispatchSchema>;

/** The admission settings a reader works with: the declared ones, and the
 * defaults for what the dispatch leaves out. */
export function dispatchAdmission(dispatch: ProjectDispatch): {
  preset: DispatchAdmissionPreset;
  startSpacingSeconds: number;
  recheckSeconds: readonly number[];
} {
  return {
    preset: dispatch.admission?.preset ?? 'default',
    startSpacingSeconds:
      dispatch.admission?.startSpacingSeconds ??
      DISPATCH_DEFAULTS.startSpacingSeconds,
    recheckSeconds:
      dispatch.admission?.recheckSeconds ?? DISPATCH_DEFAULTS.recheckSeconds,
  };
}

/** Why an agent of the pool works on nothing now: ready work waits only for
 * agents whose model is at capacity, the sandbox host held the last start,
 * the organization's agent workers are all in use, the last pass started a
 * run and waits before the next, the ready work waits for a gate, nothing is
 * ready, dispatch (or the organization's task automation) is off, or no pass
 * has run since the agent joined the pool. */
export const DISPATCH_IDLE_REASONS = [
  'model_capacity',
  'host_pressure',
  'org_limit',
  'pacing',
  'gated',
  'no_ready_work',
  'disabled',
  'unknown',
] as const;
export type DispatchIdleReason = (typeof DISPATCH_IDLE_REASONS)[number];

/**
 * What a project's dispatch is doing, as the app's Dispatch page, the REST
 * door (`GET /api/v1/projects/{id}/dispatch`) and an operator's watcher
 * read it: every agent of the pool with what it works on or why it is idle,
 * the standing roles with their next and last occurrence, the models it
 * waits on, its gates, the organization's agent workers against the pool,
 * and its recent passes.
 */
export const projectDispatchStatusSchema = z.object({
  configured: z.boolean(),
  config: projectDispatchSchema.nullable(),
  /** The managed configuration hash of the stored document. */
  hash: z.string().nullable(),
  /** The reader may change the dispatch. */
  canEdit: z.boolean(),
  state: z
    .object({
      lastPassAt: z.number().nullable(),
      lastStartAt: z.number().nullable(),
      nextPassAt: z.number().nullable(),
      lastStopReason: z.string().nullable(),
    })
    .nullable(),
  pool: z.array(
    z.object({
      agentId: z.string(),
      name: z.string(),
      model: z.string(),
      modelProvider: z.string().nullable(),
      runs: z.array(
        z.object({
          runId: z.string(),
          taskId: z.string(),
          taskNumber: z.number().nullable(),
          taskTitle: z.string(),
          status: z.enum(['queued', 'running']),
          /** Why the run waits instead of working, while it does. */
          waitingReason: z.string().nullable(),
        }),
      ),
      /** Runs it may hold at once. */
      capacity: z.number(),
      /** Its model is at capacity until then. */
      modelHeldUntil: z.number().nullable(),
      idle: z.enum(DISPATCH_IDLE_REASONS).nullable(),
    }),
  ),
  standingRoles: z.array(
    z.object({
      key: z.string(),
      agentId: z.string(),
      taskId: z.string(),
      taskTitle: z.string().nullable(),
      mode: z.string().nullable(),
      cron: z.string(),
      timezone: z.string(),
      nextAt: z.number().nullable(),
      last: z
        .object({
          label: z.string(),
          outcome: z.string(),
          runId: z.string().nullable(),
          reason: z.string().nullable(),
          at: z.number(),
        })
        .nullable(),
    }),
  ),
  holds: z.array(
    z.object({
      modelProvider: z.string(),
      model: z.string(),
      heldUntil: z.number(),
      consecutive: z.number(),
      firstRefusedAt: z.number(),
    }),
  ),
  gates: z.array(
    z.object({
      key: z.string(),
      labels: z.array(z.string()).nullable(),
      held: z.boolean(),
      /** No report within its stale window, or none yet. */
      stale: z.boolean(),
      holdAt: z.number().nullable(),
      recoverBelow: z.number().nullable(),
      whenStale: z.enum(DISPATCH_GATE_WHEN_STALE),
      value: z.number().nullable(),
      reason: z.string().nullable(),
      reportedAt: z.number().nullable(),
      reportedBy: z.string().nullable(),
      /** Starts of the work it governs wait until then for its spacing. */
      spacedUntil: z.number().nullable(),
    }),
  ),
  workers: z.object({ limit: z.number(), inUse: z.number() }),
  /** The pool can hold more runs at once than the organization has agent
   * workers: the rest of its runs would wait for one. */
  poolExceedsWorkers: z.boolean(),
  passes: z.array(
    z.object({
      id: z.string(),
      trigger: z.string(),
      startedAt: z.number(),
      stopReason: z.string(),
      started: z.number(),
      held: z.number(),
      nextPassAt: z.number().nullable(),
    }),
  ),
});
export type ProjectDispatchStatus = z.infer<typeof projectDispatchStatusSchema>;

/** What a report on a gate answers: the state it left the gate in, and
 * whether that changed. */
export const dispatchGateReportResultSchema = z.object({
  held: z.boolean(),
  changed: z.boolean(),
});
