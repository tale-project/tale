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
 * Better Auth refuses its built-in default secret outside development, so a
 * non-default secret must exist or every `/api/auth/*` returns 500. Long +
 * non-default but NOT cryptographically random — production must set a real
 * one.
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
 * Project-secret / guardrails encryption key. The secret box requires a
 * 32-byte hex key; derive a stable one from INSTANCE_SECRET so dev + E2E
 * exercise secrets with zero setup and already-encrypted rows still decrypt
 * across restarts. Explicit value wins. Runs after ensureInstanceSecret.
 */
export function ensureEncryptionSecret(env: NodeJS.ProcessEnv): void {
  if (env.ENCRYPTION_SECRET_HEX) return;
  const secret = env.INSTANCE_SECRET ?? '';
  env.ENCRYPTION_SECRET_HEX = createHash('sha256')
    .update(`${secret}${ENCRYPTION_SECRET_TAG}`)
    .digest('hex');
}

/**
 * knowledge-db (ParadeDB) connection for the RAG / knowledge-base lanes. A
 * containerized backend resolves the compose hostname `knowledge-db`, but the
 * host `bun dev` backend can't — point it at the port compose publishes to
 * localhost (the `knowledge-db` service maps 5433:5432) so RAG works with zero
 * setup. Inherited by the host backend through its spawn env. An explicit
 * KNOWLEDGE_DATABASE_URL wins (the retired RAG_DATABASE_URL alias is ignored —
 * nothing reads it any more); needs DB_PASSWORD.
 */
export function ensureKnowledgeDatabaseUrl(env: NodeJS.ProcessEnv): void {
  if (env.KNOWLEDGE_DATABASE_URL) return;
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
 * LLM-gateway MANAGEMENT-plane URL for the host `bun dev` backend. The gateway
 * runs in Docker; the backend mints/revokes session virtual keys and
 * provisions providers against it. A containerized backend resolves the
 * compose hostname `sandbox-llm-gateway`, but the host can't — point it at the
 * loopback port `compose.sandbox-llm-gateway.dev.yml` publishes
 * (`127.0.0.1:8080`) so external-agent turns work with zero setup. Inherited by
 * the host backend through its spawn env. An explicit SANDBOX_LLM_GATEWAY_URL
 * (or the pre-rename LLM_GATEWAY_URL) wins.
 *
 * This is the management plane only; the in-container DATA-plane URL
 * (EXTERNAL_AGENT_GATEWAY_URL) stays the `sandbox-llm-gateway` alias — the agent
 * container reaches the gateway over the sandbox network, not loopback.
 */
export function ensureSandboxLlmGatewayUrl(env: NodeJS.ProcessEnv): void {
  if (env.SANDBOX_LLM_GATEWAY_URL || env.LLM_GATEWAY_URL) return;
  env.SANDBOX_LLM_GATEWAY_URL = 'http://127.0.0.1:8080';
}

/**
 * Insecure local fallbacks for the two sandbox control-plane secrets. Both
 * sides fail closed without them — the spawner refuses to boot without
 * SANDBOX_TOKEN, the backend refuses every LLM-gateway management call
 * without the admin password — and each value MUST agree between the host
 * `bun dev` backend and the dockerized spawner / gateway. So these literals
 * are the SAME values `compose.dev.yml`'s `x-dev-secrets` anchor defaults to
 * (dev-secrets.test.ts pins the lockstep). The root `bun run dev` normally
 * mints random values into .env first; these only fill the gap when the
 * platform orchestrator runs on its own. Production must set real ones.
 */
export const DEV_SANDBOX_TOKEN =
  'local-dev-insecure-sandbox-token-do-not-use-in-prod-0123456789abcdef';
export const DEV_SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD =
  'local-dev-insecure-gateway-admin-password';

/** Shared HMAC key for backend → sandbox spawner request signing. */
export function ensureSandboxToken(env: NodeJS.ProcessEnv): void {
  if (env.SANDBOX_TOKEN?.trim()) return;
  warnLine(
    'SANDBOX_TOKEN not set; using an insecure local default. Set SANDBOX_TOKEN in .env for production.',
  );
  env.SANDBOX_TOKEN = DEV_SANDBOX_TOKEN;
}

/** Admin credential for the sandbox LLM gateway's management API. The
 * pre-rename LLM_GATEWAY_ADMIN_PASSWORD still counts as set (the backend reads
 * it as a fallback for one release). */
export function ensureSandboxLlmGatewayAdminPassword(
  env: NodeJS.ProcessEnv,
): void {
  if (
    env.SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD?.trim() ||
    env.LLM_GATEWAY_ADMIN_PASSWORD?.trim()
  ) {
    return;
  }
  warnLine(
    'SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD not set; using an insecure local default. Set it in .env for production.',
  );
  env.SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD =
    DEV_SANDBOX_LLM_GATEWAY_ADMIN_PASSWORD;
}

/**
 * The ordered secret-derivation chain: instance secret → better-auth secret →
 * WebDAV HMAC key (reused) → encryption key → knowledge-db URL → gateway URL →
 * the sandbox control-plane pair (spawner token, gateway admin password).
 * Each fills a gap only; the HMAC and encryption keys necessarily derive from
 * whatever INSTANCE_SECRET resolved to.
 */
export function deriveDevSecrets(env: NodeJS.ProcessEnv): void {
  ensureInstanceSecret(env);
  ensureBetterAuthSecret(env);
  ensureWebdavHmacKey(env);
  ensureEncryptionSecret(env);
  ensureKnowledgeDatabaseUrl(env);
  ensureSandboxLlmGatewayUrl(env);
  ensureSandboxToken(env);
  ensureSandboxLlmGatewayAdminPassword(env);
  ensureAppDatabaseUrl(env);
  ensureObjectStoreEnv(env);
}

export { ensureWebdavHmacKey };

/**
 * The application database for the host-run backend. Compose publishes the
 * `db` service on localhost:5432, and the app's own database (`tale_app`) is
 * created idempotently by the db image's init scripts — so `bun dev` needs no
 * setup beyond DB_PASSWORD. An explicit DATABASE_URL always wins.
 */
export function ensureAppDatabaseUrl(env: NodeJS.ProcessEnv): void {
  if (env.DATABASE_URL) return;
  const password = env.DB_PASSWORD;
  if (!password) {
    warnLine(
      'DB_PASSWORD not set; cannot derive DATABASE_URL — the backend cannot boot. Set DB_PASSWORD in .env.',
    );
    return;
  }
  const port = env.DB_HOST_PORT ?? '5432';
  const database = env.APP_DB_NAME ?? 'tale_app';
  env.DATABASE_URL = `postgresql://${env.POSTGRES_USER ?? 'tale'}:${encodeURIComponent(
    password,
  )}@localhost:${port}/${database}`;
}

/**
 * The blob store for the host-run backend. Compose publishes the
 * `object-store` service on localhost (compose.dev.yml) precisely because
 * `bun dev` runs the backend OUTSIDE the docker network and cannot reach the
 * internal `object-store:9000` address the containerized tiers use.
 *
 * The credentials mirror compose.yml's dev defaults so the two local modes
 * address the same bucket with the same keys — insecure by design, same
 * threat model as the rest of `x-dev-secrets`. An explicit value always wins.
 */
export function ensureObjectStoreEnv(env: NodeJS.ProcessEnv): void {
  env.OBJECT_STORE_ENDPOINT ??= `http://127.0.0.1:${env.OBJECT_STORE_HOST_PORT ?? '59000'}`;
  env.OBJECT_STORE_BUCKET ??= 'tale-blobs';
  env.OBJECT_STORE_ACCESS_KEY ??= 'tale';
  env.OBJECT_STORE_SECRET_KEY ??= 'tale_dev_object_store';
}
