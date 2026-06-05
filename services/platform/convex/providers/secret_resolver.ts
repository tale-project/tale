/**
 * Provider API-key resolution with an opt-in environment-variable source
 * (issue #1711).
 *
 * A provider/model may declare a `secretsEnv` (an env-var NAME) in its public
 * config. When set — and the name carries the reserved prefix — the API key is
 * read from `process.env[name]` in preference to the `*.secrets.json` file.
 * This lets operators inject keys from Kubernetes Secrets / Vault / cloud secret
 * managers without round-tripping through a SOPS file.
 *
 * Security: `secretsEnv` is operator-authored public config, and a Node action
 * reads the full Convex deployment env (which includes `SOPS_AGE_KEY`,
 * `BETTER_AUTH_SECRET`, etc.). To stop a config-write actor from naming a
 * deployment secret and exfiltrating it via a provider `baseUrl`, env reads are
 * gated by a hardcoded reserved prefix — `SECRETS_ENV_PREFIX`. Operators name
 * their provider key vars under that namespace (e.g. `TALE_PROVIDER_KEY_OPENAI`);
 * any name outside the prefix is rejected (fail-closed). This gate is enforced
 * here regardless of the save-time schema check, since config JSON is
 * hand-editable.
 *
 * This module is pure (no `'use node'`, no IO) so it can be unit-tested without
 * the convexTest harness.
 */

import {
  SECRETS_ENV_PREFIX,
  type EnvSecretStatus,
} from '../../lib/shared/schemas/providers';

let unresolvedWarnEmitted = false;

/**
 * Warn once (process-lifetime) when a provider declares a `secretsEnv` that
 * cannot be resolved — either the name is not prefixed or the env var is
 * empty/unset. Mirrors `sops.ts`'s `emitPlaintextWarnOnce` so a misconfigured
 * env-key source is diagnosable instead of silently falling through to "no
 * provider available". Never logs the value, only the name.
 */
function warnUnresolvedSecretsEnv(name: string): void {
  if (unresolvedWarnEmitted) return;
  unresolvedWarnEmitted = true;
  const prefixed = name.startsWith(SECRETS_ENV_PREFIX);
  const reason = prefixed
    ? `env var "${name}" is empty or unset`
    : `"${name}" does not start with the reserved prefix ${SECRETS_ENV_PREFIX}`;
  console.warn(
    `[providers] secretsEnv configured but unresolved — ${reason}. ` +
      `Falling back to the secrets file. Name the var with the ${SECRETS_ENV_PREFIX} ` +
      `prefix and inject it to use the environment-variable key source.`,
  );
}

/**
 * Resolve a single env-var name to its trimmed value, honoring the reserved
 * prefix. Returns null when the name is missing, not prefixed, or the env var is
 * empty/whitespace. Trailing-newline normalization (a common Vault/k8s
 * injection footgun) is applied here, on env values only.
 */
export function envSecret(name: string | undefined): string | null {
  if (!name) return null;
  if (!name.startsWith(SECRETS_ENV_PREFIX)) {
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
 * prefixed". Never returns the value itself.
 */
export function envSecretStatus(name: string | undefined): EnvSecretStatus {
  if (!name) return { allowed: false, resolved: false };
  const allowed = name.startsWith(SECRETS_ENV_PREFIX);
  const resolved = allowed && Boolean(process.env[name]?.trim());
  return { name, allowed, resolved };
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
