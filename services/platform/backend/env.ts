import { parseAdditionalSiteUrls } from '@tale/shared/utils/site-urls';
import { z } from 'zod';

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
  WORKER_CONCURRENCY: z.coerce.number().int().min(1).max(64).default(5),
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
