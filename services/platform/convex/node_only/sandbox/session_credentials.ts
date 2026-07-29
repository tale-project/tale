'use node';

// Tier-2 credential broker for sandbox sessions. Resolves an external turn's
// brokerable connector grants into the env its exec needs, decrypting each
// via the connector-credentials path (`resolveConnectorCredential`). The
// external-turn lane calls this per turn and merges the result into the
// exec's PER-EXEC env overlay — never the session env store: the agent
// session is per-user and long-lived while a grant is per-turn, so a
// session-level patch would leak a granted turn's token into every later
// ungranted turn, would need an explicit unset to revoke, and is lost on
// container recreation anyway. The per-exec overlay dies with the exec. The
// in-image `tale-git-credential` helper reads the resulting GITHUB_TOKEN per
// git operation. Alongside the credential helper, this also provisions the
// session owner's git author identity (user.name / user.email) so a fresh
// container can `git commit` without a manual `git config` — see
// `getSessionOwnerIdentity` + `buildGitConfigEnv` below.
//
// Secrets are decrypted in this Node module and returned to the caller (which
// carries them in the exec body) — they are NEVER baked into the container
// image / Pod spec / docker inspect, and every fetch is audited
// (sandboxCredentialAccess). This is the deliberate, scoped Tier-2
// relaxation: explicit per-turn grant + audit + per-exec lifetime.

import { internal } from '../../_generated/api';
import type { ActionCtx } from '../../_generated/server';
import { resolveConnectorCredential } from '../../connector_credentials/resolve_credential';

/**
 * The connector grants the broker may resolve into in-container env — an
 * explicit allowlist, extended one deliberate entry at a time. Every other
 * granted connector stays dispatch-only behind the MCP bridge (its secret
 * never enters the box); an entry here is the exception, made because the
 * capability lives in a CLI the agent drives directly (git).
 */
export const BROKERABLE_GRANTS: readonly string[] = ['github'];

/** Map an connector slug + its decrypted secret to session env. v1 is a
 * small static map (github) + a generic fallback; new connector types add
 * one case here, the pipeline is unchanged. */
function toSessionEnv(
  slug: string,
  secret: string,
): {
  env: Record<string, string>;
  git?: { hosts: string[]; username: string };
} {
  if (slug === 'github') {
    return {
      env: { GITHUB_TOKEN: secret, GH_TOKEN: secret },
      git: { hosts: ['github.com'], username: 'x-access-token' },
    };
  }
  const envName = `TALE_CONNECTOR_${slug.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_TOKEN`;
  return { env: { [envName]: secret } };
}

/** The single secret string to expose for a credential, from the named
 * bindings `resolveConnectorCredential` returns (prefer an OAuth access
 * token, then a bearer token, then an API key, then a basic-auth password). */
function pickSecret(secrets: Record<string, string>): string | null {
  return (
    secrets.accessToken ??
    secrets.token ??
    secrets.apiKey ??
    secrets.password ??
    null
  );
}

/** Assemble contiguous `GIT_CONFIG_COUNT`/`KEY_i`/`VALUE_i` env pairs
 * (equivalent to repeated `-c key=value`) from an ordered list — git requires
 * the KEY_i/VALUE_i indices to be contiguous from 0, so this is the single
 * place that numbers them. Empty input yields no GIT_CONFIG_* env at all. */
export function buildGitConfigEnv(
  pairs: Array<{ key: string; value: string }>,
): Record<string, string> {
  if (pairs.length === 0) return {};
  const env: Record<string, string> = {
    GIT_CONFIG_COUNT: String(pairs.length),
  };
  pairs.forEach((pair, i) => {
    env[`GIT_CONFIG_KEY_${i}`] = pair.key;
    env[`GIT_CONFIG_VALUE_${i}`] = pair.value;
  });
  return env;
}

/**
 * Resolve a turn's brokerable grants (plus the session owner's git identity)
 * into exec env. Best-effort per grant: a missing/disabled/undecryptable
 * credential is skipped with a warning — the turn runs without it and git
 * reports the absence loudly — never thrown, so a broker gap can only ever
 * downgrade a turn, not kill it.
 */
export async function resolveSessionCredentialEnv(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    sessionId: string;
    grants: readonly string[];
    kind: 'bootstrap' | 'git';
  },
): Promise<{
  env: Record<string, string>;
  git: Array<{ slug: string; hosts: string[]; username: string }>;
}> {
  const env: Record<string, string> = {};
  const git: Array<{ slug: string; hosts: string[]; username: string }> = [];

  for (const slug of args.grants) {
    let secret: string | null;
    try {
      const credential = await resolveConnectorCredential(ctx, {
        organizationId: args.organizationId,
        connectorSlug: slug,
      });
      secret = pickSecret(credential.secrets);
    } catch (err) {
      // No credential, disabled, needs-reauth, or an undecryptable envelope —
      // each already a typed refusal with no secret material. Skip the grant
      // like a missing credential; the message says which case it was.
      console.warn(
        `[sandbox.broker] grant '${slug}' is not resolvable:`,
        err instanceof Error ? err.message : String(err),
      );
      continue;
    }
    if (secret === null) {
      console.warn(`[sandbox.broker] grant '${slug}' has no usable secret`);
      continue;
    }
    const mapped = toSessionEnv(slug, secret);
    Object.assign(env, mapped.env);
    if (mapped.git) git.push({ slug, ...mapped.git });

    // Audit every fetch (the Tier-2 traceability requirement).
    await ctx.runMutation(
      internal.sandbox.session_mutations.recordCredentialAccess,
      {
        organizationId: args.organizationId,
        sessionId: args.sessionId,
        slug,
        kind: args.kind,
      },
    );
  }

  const gitConfigPairs: Array<{ key: string; value: string }> = [];

  // Activate the in-image `tale-git-credential` helper for every git op in the
  // exec. The helper is installed in the runtime image but inert until git
  // is told to use it — without this, `git push` to https finds no credentials
  // and aborts ("could not read Username"), even though GITHUB_TOKEN is set.
  // Injected via GIT_CONFIG_* env (equivalent to `-c credential.helper=…`) so
  // it needs no in-session `git config` exec and covers clone/fetch/push. The
  // helper answers only for hosts it has a token for and emits nothing
  // otherwise, so this is safe to set whenever any git grant is present.
  if (git.length > 0) {
    gitConfigPairs.push({
      key: 'credential.helper',
      value: '/usr/local/bin/tale-git-credential',
    });
  }

  // Provision the session owner's git AUTHOR IDENTITY beside the credential
  // helper, resolved from the platform user who owns the session (never
  // gated on git.length, unlike the helper above): name/email are non-secret
  // metadata, not a credential, and Claude Code's `Git user:` context line
  // reads `git config user.name` at conversation start regardless of
  // whether the turn was granted git access — gating it on git.length
  // would leave that line blank/stale on every non-git turn. A
  // synthetic/system-owned session (no resolvable platform user) or a user
  // with a blank name/email resolves to null and is skipped rather than
  // injecting a placeholder identity.
  const identity = await ctx.runQuery(
    internal.sandbox.session_queries.getSessionOwnerIdentity,
    { sessionId: args.sessionId },
  );
  if (identity) {
    gitConfigPairs.push(
      { key: 'user.name', value: identity.name },
      { key: 'user.email', value: identity.email },
    );
  }

  Object.assign(env, buildGitConfigEnv(gitConfigPairs));

  return { env, git };
}
