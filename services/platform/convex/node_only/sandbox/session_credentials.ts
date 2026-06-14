'use node';

// Tier-2 credential broker for sandbox sessions. Resolves a session's
// explicit integration grants into the env the sandbox needs, decrypting each
// via the existing integration-credentials path. The entry layer calls this at
// session create (and on rotation) and injects the result via
// `sessionEnvPatch`; the in-image `tale-git-credential` helper reads the
// resulting GITHUB_TOKEN per git operation.
//
// Secrets are decrypted in this Node action and returned to the caller (which
// injects them into the session env store via the spawner) — they are NEVER
// baked into the container image / Pod spec / docker inspect, and every fetch
// is audited (sandboxCredentialAccess). This is the deliberate, scoped Tier-2
// relaxation: explicit per-session grant + audit + revoke-on-destroy.

import { v } from 'convex/values';

import { internal } from '../../_generated/api';
import { internalAction } from '../../_generated/server';
import { getDecryptedCredentials } from '../../integrations/get_decrypted_credentials';

/** Map an integration slug + its decrypted secret to session env. v1 is a
 * small static map (github) + a generic fallback; new integration types add
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
  const envName = `TALE_INTEGRATION_${slug.toUpperCase().replace(/[^A-Z0-9]/g, '_')}_TOKEN`;
  return { env: { [envName]: secret } };
}

/** The single secret string to expose for a credential (prefer OAuth access
 * token, then API key, then basic-auth password). */
function pickSecret(creds: {
  accessToken?: string;
  apiKey?: string;
  password?: string;
}): string | null {
  return creds.accessToken ?? creds.apiKey ?? creds.password ?? null;
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
    const git: Array<{ slug: string; hosts: string[]; username: string }> = [];

    for (const slug of args.grants) {
      const credential = await ctx.runQuery(
        internal.integrations.credential_queries.getBySlugInternal,
        { organizationId: args.organizationId, slug },
      );
      if (!credential) {
        console.warn(
          `[sandbox.broker] grant '${slug}' has no active credential for org ${args.organizationId}`,
        );
        continue;
      }
      let decrypted: Awaited<ReturnType<typeof getDecryptedCredentials>>;
      try {
        decrypted = await getDecryptedCredentials(ctx, {
          credentialId: credential._id,
        });
      } catch (err) {
        // A corrupt secret / missing decryption key must not abort the whole
        // session create — skip this grant like a missing credential does.
        console.warn(
          `[sandbox.broker] grant '${slug}' failed to decrypt:`,
          err instanceof Error ? err.message : String(err),
        );
        continue;
      }
      const secret = pickSecret(decrypted);
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

    return { env, git };
  },
});
