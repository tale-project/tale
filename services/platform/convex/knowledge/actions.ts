import { ConvexError, v } from 'convex/values';

import { defineAbilityFor } from '../../lib/permissions/ability';
import { zodErrorMessage } from '../../lib/shared/schemas/format-error';
import {
  knowledgeConnectionSchema,
  knowledgeEmbeddingSchema,
} from '../../lib/shared/schemas/knowledge';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { action, type ActionCtx } from '../_generated/server';
import {
  requireOrgMembershipById,
  type OrgMembershipAuth,
} from '../lib/auth/require_org_membership';
import {
  knowledgeConnectionArgs,
  knowledgeEmbeddingArgs,
  sslmodeValidator,
  type KnowledgeConnectionProbeResult,
  type KnowledgeConnectionView,
  type KnowledgeEmbeddingView,
} from './validators';

/**
 * Admin-gated public actions for the per-org "bring your own Postgres"
 * knowledge DB connection and the org's embedding model config. Each
 * authenticates the caller as an org admin, then delegates the filesystem
 * write / probe to the `'use node'` `file_actions.ts` (kept in a separate file
 * so the generated api types don't collapse to `any`). Both configs live in
 * per-org JSON files — no DB row carries them. Like `object_storage`, the
 * domain is admin-on-demand and deliberately NOT in `CONFIG_DOMAINS` (nothing
 * to scaffold or mirror; all readers resolve the files directly).
 */

/** Gate to an org admin/owner (the `orgSettings` write capability). */
async function requireKnowledgeAdmin(
  ctx: ActionCtx,
  organizationId: string,
): Promise<OrgMembershipAuth> {
  const auth = await requireOrgMembershipById(ctx, organizationId);
  if (defineAbilityFor(auth.member.role).cannot('write', 'orgSettings')) {
    throw new ConvexError({
      code: 'ORG_FORBIDDEN',
      message: `Role "${auth.member.role}" cannot manage the knowledge database connection.`,
    });
  }
  return auth;
}

/** Read the org's knowledge-DB connection (masked — no password returned). */
export const getKnowledgeConnection = action({
  args: { organizationId: v.string() },
  returns: v.object({
    configured: v.boolean(),
    host: v.optional(v.string()),
    port: v.optional(v.number()),
    database: v.optional(v.string()),
    user: v.optional(v.string()),
    sslmode: v.optional(sslmodeValidator),
    hasPassword: v.optional(v.boolean()),
  }),
  handler: async (ctx, args): Promise<KnowledgeConnectionView> => {
    const auth = await requireKnowledgeAdmin(ctx, args.organizationId);
    return ctx.runAction(internal.knowledge.file_actions.readConnection, {
      orgSlug: auth.orgSlug,
    });
  },
});

/**
 * Save (or update) the org's knowledge-DB connection. `password` semantics: a
 * non-empty string sets it, `''` removes the sidecar (passwordless), `null`/
 * absent leaves any existing password untouched.
 */
export const saveKnowledgeConnection = action({
  args: {
    organizationId: v.string(),
    ...knowledgeConnectionArgs,
    password: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const auth = await requireKnowledgeAdmin(ctx, args.organizationId);
    const parsed = knowledgeConnectionSchema.safeParse({
      host: args.host,
      port: args.port,
      database: args.database,
      user: args.user,
      sslmode: args.sslmode,
    });
    if (!parsed.success) {
      throw new ConvexError({
        code: 'INVALID_CONNECTION',
        message: zodErrorMessage('Invalid knowledge connection', parsed.error),
      });
    }
    await ctx.runAction(internal.knowledge.file_actions.writeConnection, {
      orgSlug: auth.orgSlug,
      host: parsed.data.host,
      port: parsed.data.port,
      database: parsed.data.database,
      user: parsed.data.user,
      sslmode: parsed.data.sslmode,
      password: args.password,
    });
    return null;
  },
});

/** Remove the org's knowledge-DB connection (revert to the deployment default). */
export const deleteKnowledgeConnection = action({
  args: { organizationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const auth = await requireKnowledgeAdmin(ctx, args.organizationId);
    await ctx.runAction(internal.knowledge.file_actions.deleteConnection, {
      orgSlug: auth.orgSlug,
    });
    return null;
  },
});

/**
 * Probe a candidate knowledge Postgres before switching to it — reports
 * reachability + `pgvector`/ParadeDB availability (with hints). Tests the
 * values in the form; a blank password reuses the org's stored one (the
 * natural "Save, then Test" flow), so a probe is passwordless only while no
 * password is stored.
 */
export const testKnowledgeConnection = action({
  args: {
    organizationId: v.string(),
    ...knowledgeConnectionArgs,
    password: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<KnowledgeConnectionProbeResult> => {
    const auth = await requireKnowledgeAdmin(ctx, args.organizationId);
    const parsed = knowledgeConnectionSchema.safeParse({
      host: args.host,
      port: args.port,
      database: args.database,
      user: args.user,
      sslmode: args.sslmode,
    });
    if (!parsed.success) {
      return {
        ok: false,
        error: zodErrorMessage('Invalid knowledge connection', parsed.error),
      };
    }
    return ctx.runAction(internal.knowledge.file_actions.probeConnection, {
      host: parsed.data.host,
      port: parsed.data.port,
      database: parsed.data.database,
      user: parsed.data.user,
      sslmode: parsed.data.sslmode,
      password: args.password ?? undefined,
      // Lets the probe reuse the stored secret when the write-only password
      // field is left blank (the natural "Save, then Test" flow).
      orgSlug: auth.orgSlug,
    });
  },
});

/** Read the org's embedding model config (nothing secret in it). */
export const getKnowledgeEmbedding = action({
  args: { organizationId: v.string() },
  returns: v.object({
    configured: v.boolean(),
    providerSlug: v.optional(v.string()),
    credentialId: v.optional(v.string()),
    model: v.optional(v.string()),
    dimensions: v.optional(v.number()),
    baseUrl: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<KnowledgeEmbeddingView> => {
    const auth = await requireKnowledgeAdmin(ctx, args.organizationId);
    return ctx.runAction(internal.knowledge.file_actions.readEmbedding, {
      orgSlug: auth.orgSlug,
    });
  },
});

/**
 * Save (or update) the org's embedding model. When a specific `credentialId`
 * is named, it must exist, belong to this organization, and match the chosen
 * provider — a config pointing at someone else's credential (or the wrong
 * provider's) would only fail later, deep inside a search request.
 */
export const saveKnowledgeEmbedding = action({
  args: {
    organizationId: v.string(),
    ...knowledgeEmbeddingArgs,
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const auth = await requireKnowledgeAdmin(ctx, args.organizationId);
    const parsed = knowledgeEmbeddingSchema.safeParse({
      providerSlug: args.providerSlug,
      credentialId: args.credentialId,
      model: args.model,
      dimensions: args.dimensions,
      baseUrl: args.baseUrl,
    });
    if (!parsed.success) {
      throw new ConvexError({
        code: 'INVALID_EMBEDDING',
        message: zodErrorMessage('Invalid embedding config', parsed.error),
      });
    }

    if (parsed.data.credentialId !== undefined) {
      let credential: {
        organizationId: string;
        providerSlug: string;
        status?: string;
      } | null;
      try {
        credential = await ctx.runQuery(
          internal.provider_credentials.queries.getCredentialInternal,
          {
            // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the arg arrives as text; the internal query's `v.id` validator rejects a non-id at runtime and the catch below maps that to CREDENTIAL_NOT_FOUND
            credentialId: parsed.data.credentialId as Id<'providerCredentials'>,
          },
        );
      } catch (err) {
        // A malformed id fails the internal query's `v.id` validation — treat
        // that exactly like a miss so nothing about id shapes leaks. Anything
        // else is a real failure the admin should see and retry, not a
        // phantom "credential deleted".
        if (
          err instanceof Error &&
          err.message.includes('ArgumentValidationError')
        ) {
          credential = null;
        } else {
          console.warn(
            '[knowledge] credential lookup failed during embedding save',
            err,
          );
          throw err;
        }
      }
      // A foreign org's credential reads as "not found" — same checks as
      // `resolve_credential.ts` — so existence never leaks across tenants.
      if (!credential || credential.organizationId !== args.organizationId) {
        throw new ConvexError({
          code: 'CREDENTIAL_NOT_FOUND',
          message: 'The selected credential no longer exists.',
        });
      }
      if (credential.providerSlug !== parsed.data.providerSlug) {
        throw new ConvexError({
          code: 'CREDENTIAL_PROVIDER_MISMATCH',
          message: `The selected credential belongs to provider "${credential.providerSlug}", not "${parsed.data.providerSlug}".`,
        });
      }
      // Search-time resolution refuses disabled credentials
      // (`resolve_credential.ts`), so accepting one here would only defer the
      // failure deep into a search request — the very thing this check exists
      // to prevent.
      if (credential.status === 'disabled') {
        throw new ConvexError({
          code: 'CREDENTIAL_DISABLED',
          message:
            'The selected credential is disabled — re-enable it or pick another.',
        });
      }
    }

    await ctx.runAction(internal.knowledge.file_actions.writeEmbedding, {
      orgSlug: auth.orgSlug,
      providerSlug: parsed.data.providerSlug,
      credentialId: parsed.data.credentialId,
      model: parsed.data.model,
      dimensions: parsed.data.dimensions,
      baseUrl: parsed.data.baseUrl,
    });
    return null;
  },
});

/** Remove the org's embedding config (knowledge search then refuses again). */
export const deleteKnowledgeEmbedding = action({
  args: { organizationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const auth = await requireKnowledgeAdmin(ctx, args.organizationId);
    await ctx.runAction(internal.knowledge.file_actions.deleteEmbedding, {
      orgSlug: auth.orgSlug,
    });
    return null;
  },
});
