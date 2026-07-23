'use node';

// Tier-2 credential broker for sandbox sessions. Resolves a session's
// explicit integration grants into the env the sandbox needs, decrypting each
// via the existing integration-credentials path. The entry layer calls this at
// session create (and on rotation) and injects the result via
// `sessionEnvPatch`; the in-image `tale-git-credential` helper reads the
// resulting GITHUB_TOKEN per git operation. Alongside the credential helper,
// it also provisions the session owner's git author identity (user.name /
// user.email) so a fresh container can `git commit` without a manual
// `git config` — see `getSessionOwnerIdentity` + `buildGitConfigEnv` below.
//
// Secrets are decrypted in this Node action and returned to the caller (which
// injects them into the session env store via the spawner) — they are NEVER
// baked into the container image / Pod spec / docker inspect, and every fetch
// is audited (sandboxCredentialAccess). This is the deliberate, scoped Tier-2
// relaxation: explicit per-session grant + audit + revoke-on-destroy.

import { v } from 'convex/values';

import { internal } from '../../_generated/api';
import { internalAction } from '../../_generated/server';

// `getDecryptedCredentials`
// (`convex/integrations/get_decrypted_credentials.ts`) moved with the
// integrations rewrite. Resolving a session's explicit integration grants
// (github tokens, etc.) into env is offline — `resolveSessionCredentials`
// below now always returns empty grants (with a debug log) instead of
// decrypting anything, so sandbox sessions still start; only the git
// credential helper activation (gated on a non-empty `git` array) is
// affected. The session owner's git AUTHOR IDENTITY (name/email) is
// unrelated to credential grants and has no AI/integrations dependency, so
// it's kept fully functional.

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

export const resolveSessionCredentials = internalAction({
  args: {
    organizationId: v.string(),
    sessionId: v.string(),
    grants: v.array(v.string()),
    kind: v.union(v.literal('bootstrap'), v.literal('git')),
  },
  returns: v.object({
    env: v.record(v.string(), v.string()),
    git: v.array(
      v.object({
        slug: v.string(),
        hosts: v.array(v.string()),
        username: v.string(),
      }),
    ),
  }),
  handler: async (ctx, args) => {
    const env: Record<string, string> = {};
    // Always empty — see file header. `args.grants` is kept
    // in the args validator (signature unchanged) but is not resolved.
    const git: Array<{ slug: string; hosts: string[]; username: string }> = [];
    if (args.grants.length > 0) {
      console.debug(
        `[sandbox.broker] integration credential grants are offline while the platform AI backend is rewritten; not resolving ${args.grants.length} grant(s) for session ${args.sessionId}`,
      );
    }

    const gitConfigPairs: Array<{ key: string; value: string }> = [];

    // Activate the in-image `tale-git-credential` helper for every git op in the
    // session. The helper is installed in the runtime image but inert until git
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
    // whether the session was granted git access — gating it on git.length
    // would leave that line blank/stale on every non-git session. Injected as
    // env (not an in-session `git config` exec) so it is per-session and
    // survives container recreation deterministically, the same as the
    // helper. A synthetic/system-owned session (no resolvable platform user)
    // or a user with a blank name/email resolves to null and is skipped
    // rather than injecting a placeholder identity.
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
  },
});
