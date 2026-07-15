import { ConvexError, v } from 'convex/values';

import { defineAbilityFor } from '../../lib/permissions/ability';
import { zodErrorMessage } from '../../lib/shared/schemas/format-error';
import { knowledgeConnectionFileSchema } from '../../lib/shared/schemas/knowledge';
import { internal } from '../_generated/api';
import { action, type ActionCtx } from '../_generated/server';
import {
  requireOrgMembershipById,
  type OrgMembershipAuth,
} from '../lib/auth/require_org_membership';
import {
  knowledgeConnectionArgs,
  sslmodeValidator,
  type KnowledgeConnectionProbeResult,
} from './validators';

/**
 * Admin-gated public actions for the per-org "bring your own Postgres" knowledge
 * DB connection. Each authenticates the caller as an org admin, then delegates
 * the filesystem write / probe to the `'use node'` `file_actions.ts` (kept in a
 * separate file so the generated api types don't collapse to `any`). The
 * connection lives in per-org JSON files — no DB row carries it.
 */

/** Masked connection view — never carries the password itself. */
interface KnowledgeConnectionView {
  configured: boolean;
  host?: string;
  port?: number;
  database?: string;
  user?: string;
  sslmode?: 'disable' | 'prefer' | 'require' | 'verify-ca' | 'verify-full';
  hasPassword?: boolean;
}

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
    const parsed = knowledgeConnectionFileSchema.safeParse({
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
 * reachability + `pgvector`/ParadeDB availability (with hints). Tests the values
 * in the form; the password is optional (empty ⇒ passwordless probe).
 */
export const testKnowledgeConnection = action({
  args: {
    organizationId: v.string(),
    ...knowledgeConnectionArgs,
    password: v.optional(v.union(v.string(), v.null())),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<KnowledgeConnectionProbeResult> => {
    await requireKnowledgeAdmin(ctx, args.organizationId);
    const parsed = knowledgeConnectionFileSchema.safeParse({
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
    });
  },
});
