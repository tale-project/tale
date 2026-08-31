import { z } from 'zod';

/**
 * Process roles: `api` serves HTTP/SSE, `worker` runs pg-boss task queues,
 * `all` runs both in one process (local-dev convenience). Deployment starts
 * one `api` and one `worker` container from the same image (compose profile
 * `backend`), each horizontally scalable.
 */
const envSchema = z.object({
  DATABASE_URL: z.string().min(1),
  PORT: z.coerce.number().int().min(1).max(65535).default(3005),
  ROLE: z.enum(['api', 'worker', 'all']).default('all'),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(5),
  /**
   * Required by the api/all roles (asserted in main.ts); a pure worker can
   * boot without auth configuration.
   */
  BETTER_AUTH_SECRET: z.string().min(16).optional(),
  /** Public origin auth cookies bind to; defaults to the direct dev port. */
  SITE_URL: z.string().url().default('http://localhost:3005'),
  /**
   * Sentry-compatible error reporting (Sentry, GlitchTip, Bugsink), opt-in —
   * unset disables it entirely. See `error-reporting.ts`.
   */
  SENTRY_DSN: z.string().optional(),
});

export type BackendEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): BackendEnv {
  return envSchema.parse(source);
}
