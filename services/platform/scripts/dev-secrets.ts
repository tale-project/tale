/**
 * Deterministic dev-secret derivation, extracted from the orchestrator so the
 * crypto is in one tested place — and so the WebDAV HMAC key reuses the SAME
 * `ensureWebdavHmacKey` the platform verifies with (it used to be re-derived
 * inline here, a load-bearing formula maintained in two places).
 *
 * Order matters: the HMAC and encryption keys derive from `INSTANCE_SECRET`, so
 * they must run AFTER the instance-secret fallback is installed. An explicit
 * value in the environment always wins — we only fill gaps.
 *
 * node-only (dev orchestrator); mutates the passed `env` in place.
 */

import { createHash } from 'node:crypto';

import { warnLine } from '@tale/shared/tux';

import { ensureWebdavHmacKey } from '../lib/webdav/hmac-key';

/** The tag fed to sha256 alongside INSTANCE_SECRET to derive ENCRYPTION_SECRET_HEX. */
export const ENCRYPTION_SECRET_TAG = ':encryption-secret:v1';

/** Insecure local fallback for INSTANCE_SECRET — production must set a real one. */
export function ensureInstanceSecret(env: NodeJS.ProcessEnv): void {
  if (env.INSTANCE_SECRET) return;
  warnLine(
    'INSTANCE_SECRET not set; using an insecure local default. Set INSTANCE_SECRET in .env for production.',
  );
  env.INSTANCE_SECRET = 'local-dev-insecure-secret';
}

/**
 * Better Auth's "default secret in production" guard fires inside Convex (which
 * runs as production), so a non-default secret must exist or every `/api/auth/*`
 * returns 500. Long + non-default but NOT cryptographically random — production
 * must set a real one.
 */
export function ensureBetterAuthSecret(env: NodeJS.ProcessEnv): void {
  if (env.BETTER_AUTH_SECRET) return;
  warnLine(
    'BETTER_AUTH_SECRET not set; using an insecure local default. Set BETTER_AUTH_SECRET in .env for production.',
  );
  env.BETTER_AUTH_SECRET =
    'local-dev-better-auth-secret-do-not-use-in-prod-0123456789abcdef';
}

/**
 * Project-secret / guardrails encryption key. `secret_box.ts` requires a 32-byte
 * hex key on the Convex deployment; derive a stable one from INSTANCE_SECRET so
 * dev + E2E exercise secrets with zero setup and already-encrypted rows still
 * decrypt across restarts. Explicit value wins. Runs after ensureInstanceSecret.
 */
export function ensureEncryptionSecret(env: NodeJS.ProcessEnv): void {
  if (env.ENCRYPTION_SECRET_HEX) return;
  const secret = env.INSTANCE_SECRET ?? '';
  env.ENCRYPTION_SECRET_HEX = createHash('sha256')
    .update(`${secret}${ENCRYPTION_SECRET_TAG}`)
    .digest('hex');
}

/**
 * knowledge-db (ParadeDB) connection for the RAG / knowledge-base Convex node
 * actions. A containerized Convex run resolves the compose hostname
 * `knowledge-db`, but the host `bun dev` backend can't — point it at the port
 * compose publishes to localhost (the `knowledge-db` service maps 5433:5432) so
 * RAG works with zero setup. Pushed into Convex via ORCHESTRATOR_MANAGED_KEYS. An
 * explicit KNOWLEDGE_DATABASE_URL / RAG_DATABASE_URL wins; needs DB_PASSWORD.
 */
export function ensureKnowledgeDatabaseUrl(env: NodeJS.ProcessEnv): void {
  if (env.KNOWLEDGE_DATABASE_URL || env.RAG_DATABASE_URL) return;
  const password = env.DB_PASSWORD;
  if (!password) {
    warnLine(
      'DB_PASSWORD not set; cannot derive KNOWLEDGE_DATABASE_URL — knowledge base / RAG search will fail. Set DB_PASSWORD in .env.',
    );
    return;
  }
  const KNOWLEDGE_DB_HOST_PORT = 5433;
  env.KNOWLEDGE_DATABASE_URL = `postgresql://tale:${encodeURIComponent(
    password,
  )}@localhost:${KNOWLEDGE_DB_HOST_PORT}/tale_knowledge`;
}

/**
 * The ordered secret-derivation chain: instance secret → better-auth secret →
 * WebDAV HMAC key (reused) → encryption key → knowledge-db URL. Each fills a gap
 * only; the HMAC and encryption keys necessarily derive from whatever
 * INSTANCE_SECRET resolved to.
 */
export function deriveDevSecrets(env: NodeJS.ProcessEnv): void {
  ensureInstanceSecret(env);
  ensureBetterAuthSecret(env);
  ensureWebdavHmacKey(env);
  ensureEncryptionSecret(env);
  ensureKnowledgeDatabaseUrl(env);
}

export { ensureWebdavHmacKey };
