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

/** What readers assume for a field the dispatch leaves out. */
export const DISPATCH_DEFAULTS = {
  perAgentConcurrency: 1,
  rebalance: false,
  startSpacingSeconds: 30,
  recheckSeconds: [60, 120, 240],
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
  timezone: timeZoneSchema,
  /** A short name for what this schedule's runs do, such as `full` or
   * `light`: given to the agent with every occurrence. */
  mode: z.string().trim().min(1).max(40).optional(),
  /** What the agent addresses first on every occurrence. */
  brief: z.string().trim().min(1).max(DISPATCH_ROLE_BRIEF_MAX).optional(),
});
export type ProjectDispatchRole = z.infer<typeof projectDispatchRoleSchema>;

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
    /** The most runs the pool holds at once, its standing roles included. */
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
