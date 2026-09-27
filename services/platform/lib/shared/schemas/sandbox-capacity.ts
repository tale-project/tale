import { z } from 'zod';

const count = z.number().int().nonnegative();
const measurement = z.number().nonnegative().nullable();

/** Configured admission ceiling, readable even when runtime observation fails. */
export const sandboxDeploymentLimitsSchema = z.object({
  maxSessions: z.number().int().positive(),
  /** Slots the organization's connected devices add (their own machines). */
  deviceSessions: z.number().int().nonnegative().optional(),
});

export type SandboxDeploymentLimits =
  | ({ status: 'available' } & z.infer<typeof sandboxDeploymentLimitsSchema>)
  | { status: 'unavailable'; reason: 'not_configured' | 'unreachable' };

/** Validated at the spawner boundary. Missing measurements stay unknown;
 * organization quota usage is read independently from the platform ledger. */
export const sandboxCapacitySchema = z.object({
  status: z.literal('available'),
  observedAt: z.number().int().nonnegative(),
  backend: z.enum(['docker', 'kubernetes']),
  scope: z.enum(['host', 'namespace']),
  sessions: z.object({
    running: count,
    starting: count,
    limit: z.number().int().positive(),
    organizationRunning: count,
    organizationStarting: count,
    /** Deprecated wire field: new spawners alias the deployment limit here. */
    organizationLimit: z.number().int().positive(),
  }),
  resources: z.object({
    cpu: z.object({ totalCores: measurement, usedCores: measurement }),
    memory: z.object({ totalBytes: measurement, usedBytes: measurement }),
  }),
  runtimeSessions: z.array(
    z.object({
      sessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
      state: z.enum(['running', 'starting', 'stopped']),
      /** Set when the session runs on one of the organization's devices. */
      deviceId: z.string().min(1).max(64).optional(),
    }),
  ),
  /** Where each of the organization's device-placed sessions lives — also
   * while its device is offline. Absent from spawners without a device hub. */
  placements: z
    .array(
      z.object({
        sessionId: z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/),
        deviceId: z.string().min(1).max(64),
      }),
    )
    .optional(),
});

export type SandboxCapacityObservation = z.infer<typeof sandboxCapacitySchema>;
