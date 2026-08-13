/**
 * Write side of org agent secrets — the V8 mutations. Encryption happens in
 * the Node action (`actions.ts`) before `upsertAgentSecretInternal` stores the
 * envelope; the public delete is a plain V8 mutation (no crypto needed).
 */

import { ConvexError, v } from 'convex/values';

import { internalMutation, mutation } from '../_generated/server';
import { createAuditLog } from '../audit_logs/helpers';
import { encryptedSecretValidator } from '../connector_credentials/schema';
import { requireOrgAdminOrDeveloper } from '../lib/auth/require_org_admin_or_developer';
import { MAX_AGENT_SECRETS_PER_ORG } from './constants';

/** Audit action ids for the agent-secret lifecycle (data category). */
const AGENT_SECRET_AUDIT = {
  created: 'agent_secret.created',
  updated: 'agent_secret.updated',
  deleted: 'agent_secret.deleted',
} as const;
const AGENT_SECRET_RESOURCE_TYPE = 'agent_secret';

/**
 * Store (create or replace) one org secret's encrypted envelope, keyed by
 * name. Internal — the public entry is the Node action, which encrypts first.
 * Returns whether a new secret was created (for the audit action id).
 */
export const upsertAgentSecretInternal = internalMutation({
  args: {
    organizationId: v.string(),
    name: v.string(),
    description: v.optional(v.string()),
    encryptedValue: encryptedSecretValidator,
    maskedPreview: v.optional(v.string()),
    actorId: v.string(),
    actorEmail: v.optional(v.string()),
  },
  returns: v.object({ created: v.boolean() }),
  handler: async (ctx, args): Promise<{ created: boolean }> => {
    const existing = await ctx.db
      .query('agentSecrets')
      .withIndex('by_org_name', (q) =>
        q.eq('organizationId', args.organizationId).eq('name', args.name),
      )
      .first();
    const now = Date.now();
    const description =
      args.description !== undefined && args.description.trim() !== ''
        ? args.description.trim()
        : undefined;

    if (existing !== null) {
      await ctx.db.patch(existing._id, {
        encryptedValue: args.encryptedValue,
        description,
        ...(args.maskedPreview !== undefined
          ? { maskedPreview: args.maskedPreview }
          : { maskedPreview: undefined }),
        updatedAt: now,
        updatedBy: args.actorId,
      });
    } else {
      const count = (
        await ctx.db
          .query('agentSecrets')
          .withIndex('by_org', (q) =>
            q.eq('organizationId', args.organizationId),
          )
          .collect()
      ).length;
      if (count >= MAX_AGENT_SECRETS_PER_ORG) {
        throw new ConvexError({
          code: 'AGENT_SECRET_LIMIT',
          message: `An organization may store at most ${MAX_AGENT_SECRETS_PER_ORG} agent secrets.`,
        });
      }
      await ctx.db.insert('agentSecrets', {
        organizationId: args.organizationId,
        name: args.name,
        ...(description !== undefined ? { description } : {}),
        encryptedValue: args.encryptedValue,
        ...(args.maskedPreview !== undefined
          ? { maskedPreview: args.maskedPreview }
          : {}),
        createdBy: args.actorId,
        createdAt: now,
        updatedAt: now,
        updatedBy: args.actorId,
      });
    }

    // The audit row records the name + description length only — never the
    // value, the preview, or the ciphertext.
    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: args.actorId,
      ...(args.actorEmail !== undefined ? { actorEmail: args.actorEmail } : {}),
      actorType: 'user',
      action:
        existing !== null
          ? AGENT_SECRET_AUDIT.updated
          : AGENT_SECRET_AUDIT.created,
      category: 'data',
      resourceType: AGENT_SECRET_RESOURCE_TYPE,
      resourceId: args.name,
      resourceName: args.name,
      metadata: { descriptionLength: description?.length ?? 0 },
      status: 'success',
    });
    return { created: existing === null };
  },
});

/**
 * Delete an org secret by name. Any agent still referencing it simply stops
 * receiving that env var on its next turn — a dangling name is inert, never
 * an error, so deletion never has to rewrite agent equipment.
 */
export const deleteAgentSecret = mutation({
  args: { organizationId: v.string(), name: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const auth = await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    const existing = await ctx.db
      .query('agentSecrets')
      .withIndex('by_org_name', (q) =>
        q.eq('organizationId', args.organizationId).eq('name', args.name),
      )
      .first();
    if (existing === null) {
      throw new ConvexError({ code: 'AGENT_SECRET_NOT_FOUND' });
    }
    await ctx.db.delete(existing._id);
    await createAuditLog(ctx, {
      organizationId: args.organizationId,
      actorId: auth.userId,
      actorEmail: auth.email,
      actorType: 'user',
      action: AGENT_SECRET_AUDIT.deleted,
      category: 'data',
      resourceType: AGENT_SECRET_RESOURCE_TYPE,
      resourceId: args.name,
      resourceName: args.name,
      status: 'success',
    });
    return null;
  },
});
