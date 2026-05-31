import { createHash } from 'node:crypto';

// The WebDAV app-password HMAC key is 64 hex chars (sha256). The platform
// (verify) and Convex (hash-at-create) sides MUST use the identical key, so
// any explicit override has to clear this bar too. Shared by the boot gate
// (server.ts), the create mutation's validation, and the per-request auth gate
// so the three never drift (see findings P0.2 / P3-Auth).
export const WEBDAV_HMAC_KEY_MIN_LENGTH = 64;

// Deterministically resolve the WebDAV app-password HMAC key and cache it onto
// `env` so downstream readers (handler.ts getHmacSecret) pick it up. Returns
// the resolved key, or undefined when neither an explicit key nor
// INSTANCE_SECRET is set.
//
// MUST stay byte-identical to docker-entrypoint.sh's derivation
//   sha256("<INSTANCE_SECRET>:webdav-hmac:v1")
// so the key the platform uses to VERIFY an app-password equals the key the
// Convex side used to HASH it at creation time. An explicit
// WEBDAV_APP_PASSWORD_HMAC_KEY always wins (operator rotation / managed
// deployments where INSTANCE_SECRET isn't the source of truth).
export function ensureWebdavHmacKey(
  env: NodeJS.ProcessEnv = process.env,
): string | undefined {
  if (env.WEBDAV_APP_PASSWORD_HMAC_KEY) {
    return env.WEBDAV_APP_PASSWORD_HMAC_KEY;
  }
  if (!env.INSTANCE_SECRET) return undefined;
  const key = createHash('sha256')
    .update(`${env.INSTANCE_SECRET}:webdav-hmac:v1`)
    .digest('hex');
  env.WEBDAV_APP_PASSWORD_HMAC_KEY = key;
  return key;
}
