/**
 * Provider API-key resolution with an opt-in environment-variable source
 * (issue #1711).
 *
 * A provider/model may declare a `secretsEnv` (an env-var NAME) in its public
 * config. When set — and the name is allowlisted — the API key is read from
 * `process.env[name]` in preference to the `*.secrets.json` file. This lets
 * operators inject keys from Kubernetes Secrets / Vault / cloud secret managers
 * without round-tripping through a SOPS file.
 *
 * Security: `secretsEnv` is operator-authored public config, and a Node action
 * reads the full Convex deployment env (which includes `SOPS_AGE_KEY`,
 * `BETTER_AUTH_SECRET`, etc.). To stop a config-write actor from naming a
 * deployment secret and exfiltrating it via a provider `baseUrl`, env reads are
 * gated by an operator allowlist — `TALE_PROVIDER_SECRET_ENV_ALLOWLIST`
 * (comma-separated names). Empty/unset ⇒ the env source is off entirely.
 *
 * This module is pure (no `'use node'`, no IO) so it can be unit-tested without
 * the convexTest harness.
 */

import type { EnvSecretStatus } from '../../lib/shared/schemas/providers';

const ALLOWLIST_ENV = 'TALE_PROVIDER_SECRET_ENV_ALLOWLIST';

/**
 * Parse the allowlist fresh on each read. It is a tiny comma-split and tests
 * mutate `process.env` between cases, so caching would only add staleness for
 * no measurable benefit.
 */
function allowlistedNames(): Set<string> {
  const raw = process.env[ALLOWLIST_ENV];
  if (!raw) return new Set();
  return new Set(
    raw
      .split(',')
      .map((n) => n.trim())
      .filter((n) => n.length > 0),
  );
}

let unresolvedWarnEmitted = false;

/**
 * Warn once (process-lifetime) when a provider declares a `secretsEnv` that
 * cannot be resolved — either the name is not allowlisted or the env var is
 * empty/unset. Mirrors `sops.ts`'s `emitPlaintextWarnOnce` so a misconfigured
 * env-key source is diagnosable instead of silently falling through to "no
 * provider available". Never logs the value, only the name.
 */
function warnUnresolvedSecretsEnv(name: string): void {
  if (unresolvedWarnEmitted) return;
  unresolvedWarnEmitted = true;
  const allowlisted = allowlistedNames().has(name);
  const reason = allowlisted
    ? `env var "${name}" is empty or unset`
    : `"${name}" is not in ${ALLOWLIST_ENV} (empty allowlist ⇒ env source disabled)`;
  console.warn(
    `[providers] secretsEnv configured but unresolved — ${reason}. ` +
      `Falling back to the secrets file. Set ${ALLOWLIST_ENV} and inject the ` +
      `env var to use the environment-variable key source.`,
  );
}

/**
 * Resolve a single env-var name to its trimmed value, honoring the allowlist.
 * Returns null when the name is missing, not allowlisted, or the env var is
 * empty/whitespace. Trailing-newline normalization (a common Vault/k8s
 * injection footgun) is applied here, on env values only.
 */
export function envSecret(name: string | undefined): string | null {
  if (!name) return null;
  if (!allowlistedNames().has(name)) {
    warnUnresolvedSecretsEnv(name);
    return null;
  }
  const value = process.env[name]?.trim();
  if (!value) {
    warnUnresolvedSecretsEnv(name);
    return null;
  }
  return value;
}

/**
 * Inspect a `secretsEnv` name for the settings UI without resolving the value
 * (and without the warn-once side effect of `envSecret`). Lets the provider
 * page distinguish "not configured" from "configured but empty" from "not
 * allowlisted". Never returns the value itself.
 */
export function envSecretStatus(name: string | undefined): EnvSecretStatus {
  if (!name) return { allowlisted: false, resolved: false };
  const allowlisted = allowlistedNames().has(name);
  const resolved = allowlisted && Boolean(process.env[name]?.trim());
  return { name, allowlisted, resolved };
}

export interface ResolveApiKeyInput {
  /** `model.secretsEnv` — highest precedence. */
  modelSecretsEnv?: string;
  /** `provider.secretsEnv` — used when the model-level env yields nothing. */
  providerSecretsEnv?: string;
  /** File `secrets.modelKeys[modelId]` — passed through raw (no trim). */
  fileModelKey?: string;
  /** File `secrets.apiKey` — passed through raw (no trim). */
  fileApiKey?: string;
}

/**
 * Resolve the effective API key for a model. Order: model env → provider env →
 * file model key → file provider key. Env tiers are trimmed (see `envSecret`);
 * file tiers are returned verbatim so existing file-only deployments keep
 * byte-identical behavior and stay consistent with the Python loader.
 */
export function resolveApiKey(input: ResolveApiKeyInput): string | null {
  return (
    envSecret(input.modelSecretsEnv) ??
    envSecret(input.providerSecretsEnv) ??
    input.fileModelKey ??
    input.fileApiKey ??
    null
  );
}

/**
 * Whether a provider config can resolve an API key from the environment at the
 * PROVIDER granularity — provider-level env OR any model-level env. Used by
 * `loadAllProviders` to decide whether to keep a provider that has no secrets
 * file. (Per-provider UI/composer flags must NOT use the model-OR form; see
 * `listProviders`.)
 */
export function providerHasEnvKey(config: {
  secretsEnv?: string;
  models: Array<{ secretsEnv?: string }>;
}): boolean {
  return (
    envSecret(config.secretsEnv) !== null ||
    config.models.some((m) => envSecret(m.secretsEnv) !== null)
  );
}
