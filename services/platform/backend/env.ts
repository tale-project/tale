import { parseAdditionalSiteUrls } from '@tale/shared/utils/site-urls';
import { z } from 'zod';

import {
  totpClientNameSchema,
  totpEnvironmentSchema,
} from '../lib/shared/authenticator-name.ts';
import { ensureWebdavHmacKey } from '../lib/webdav/hmac-key.ts';

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
  SANDBOX_AGENT_PROFILE: z.enum(['agent', 'agent-light']).default('agent'),
  TALE_SANDBOX_CLAUDE_EFFORT: z.preprocess(
    (value) => (value === '' ? undefined : value),
    z.enum(['low', 'medium', 'high', 'max']).optional(),
  ),
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(5),
  /**
   * Agent turn starts a worker runs at once, per lane (task and automation);
   * unset, WORKER_CONCURRENCY and at least 8 (`jobs/tasks.ts`
   * `agentQueueSlots`).
   */
  AGENT_START_SLOTS: z.coerce.number().int().min(1).max(256).optional(),
  /**
   * Live agent turns' 90 s drive windows a worker runs at once, per lane;
   * unset, WORKER_CONCURRENCY and at least 16. A worker keeps about 2.5 times
   * this many live turns per lane drained before their windows wait past
   * the recovery horizon.
   */
  AGENT_DRIVE_SLOTS: z.coerce.number().int().min(1).max(256).optional(),
  /**
   * Automation steps one organization runs at once across every worker
   * (`jobs/tasks.ts` `queueGroupConcurrency`), so one organization's burst
   * of runs cannot take every step slot; 0 turns the limit off. A single
   * worker at the default WORKER_CONCURRENCY never reaches it.
   */
  AUTOMATION_ORG_CONCURRENCY: z.coerce
    .number()
    .int()
    .min(0)
    .max(256)
    .default(8),
  /**
   * How long a stopping process waits for its jobs before it fails what is
   * left (`shutdown-sequence.ts`); unset, 15 s for the api and 90 s for a
   * worker. Keep the container's stop grace at least 15 s above it.
   */
  SHUTDOWN_DRAIN_MS: z.coerce.number().int().min(1_000).max(600_000).optional(),
  /**
   * Required by the api/all roles (asserted in main.ts); a pure worker can
   * boot without auth configuration.
   */
  BETTER_AUTH_SECRET: z.string().min(16).optional(),
  /**
   * The deployment's field-encryption root: 32 bytes as 64 hex chars. It is
   * the direct AES-256 key of the JWE lanes (`core/lib/crypto/get_secret_key.ts`)
   * and the HKDF input of the secret box (`core/lib/secret_box.ts`), and every
   * role decrypts stored credentials — so a missing or malformed value fails
   * HERE, at boot, instead of at the first credential save or SSO login.
   */
  ENCRYPTION_SECRET_HEX: z
    .string()
    .regex(
      /^[0-9a-f]{64}$/i,
      'ENCRYPTION_SECRET_HEX must be 32 bytes as 64 hex chars (`tale init` generates it; by hand: openssl rand -hex 32)',
    ),
  /** Public origin auth cookies bind to; defaults to the direct dev port. */
  SITE_URL: z.string().url().default('http://localhost:3005'),
  /**
   * The client this deployment serves and its environment, as newly generated
   * authenticator entries name them (`Acme Tale Platform TE`). Unset client:
   * `Tale Platform`; `pr` or unset environment: no environment.
   */
  TOTP_CLIENT_NAME: totpClientNameSchema,
  TOTP_ENVIRONMENT: totpEnvironmentSchema,
  /**
   * The other public origins this deployment is served from, comma- or
   * whitespace-separated (`https://tale.partner.example, https://…`). Each
   * is a first-class entry point next to SITE_URL: Better Auth trusts it, and
   * the doors that build browser-facing URLs answer on the origin the browser
   * is on. Validated here so a typo fails boot instead of silently serving a
   * domain nobody can sign in on — see `@tale/shared/utils/site-urls`.
   */
  ADDITIONAL_SITE_URLS: z
    .string()
    .optional()
    .superRefine((value, ctx) => {
      try {
        parseAdditionalSiteUrls(value);
      } catch (error) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          message: error instanceof Error ? error.message : String(error),
        });
      }
    }),
  /**
   * Sentry-compatible error reporting (Sentry, GlitchTip, Bugsink), opt-in —
   * unset disables it entirely. See `error-reporting.ts`.
   */
  SENTRY_DSN: z.string().optional(),
  /** Manual backend spans only; independent of browser sampling. */
  BACKEND_SENTRY_TRACES_SAMPLE_RATE: z.coerce.number().min(0).max(1).default(0),
});

export type BackendEnv = z.infer<typeof envSchema>;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): BackendEnv {
  // The WebDAV app-password HMAC key derives from INSTANCE_SECRET when not
  // set explicitly — `ensureWebdavHmacKey` (the single derivation, pinned by
  // test to docker-entrypoint.sh's web-lane sha256) caches it onto `source`
  // so every lazy reader (webdav hash + verify, hostcall tokens, sandbox
  // stage tokens) picks it up. The container entrypoint's api/worker branch
  // execs node BEFORE the web lane's shell derivation runs, so without this
  // the backend roles never receive the key and every WebDAV/app-password/
  // stage-token op refuses in split-role deployments. No INSTANCE_SECRET
  // (minimal dev setups) leaves the key unset, exactly as before.
  ensureWebdavHmacKey(source);
  return envSchema.parse(source);
}
