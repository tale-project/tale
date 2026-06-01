import { v } from 'convex/values';

import type { Id } from '../_generated/dataModel';
import type { MutationCtx } from '../_generated/server';
import { internalMutation, internalQuery } from '../_generated/server';

/**
 * Routing + identity bookkeeping for the shared Slack App. See
 * `slack_installations_schema.ts` for the table contract.
 */

/**
 * Upsert the workspace → org routing row from an OAuth install.
 *
 * Conflict rule: a Slack `team_id` belongs to exactly one org. The same org
 * re-authorizing (re-install / scope upgrade / new bot user) patches in place;
 * a *different* org claiming a team already mapped elsewhere is rejected, so a
 * second tenant can never silently capture another tenant's inbound traffic.
 */
export const upsertInstallation = internalMutation({
  args: {
    teamId: v.string(),
    teamName: v.optional(v.string()),
    enterpriseId: v.optional(v.string()),
    organizationId: v.string(),
    slug: v.string(),
    botUserId: v.optional(v.string()),
    appId: v.optional(v.string()),
    credentialId: v.id('integrationCredentials'),
  },
  returns: v.id('slackInstallations'),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('slackInstallations')
      .withIndex('by_team', (q) => q.eq('teamId', args.teamId))
      .first();

    const now = Date.now();

    if (existing) {
      if (existing.organizationId !== args.organizationId) {
        throw new Error(
          `Slack workspace ${args.teamId} is already connected to another organization. ` +
            'Disconnect it there before connecting it here.',
        );
      }
      await ctx.db.patch(existing._id, {
        teamName: args.teamName ?? existing.teamName,
        enterpriseId: args.enterpriseId ?? existing.enterpriseId,
        botUserId: args.botUserId ?? existing.botUserId,
        appId: args.appId ?? existing.appId,
        credentialId: args.credentialId,
        updatedAt: now,
      });
      return existing._id;
    }

    return await ctx.db.insert('slackInstallations', {
      ...args,
      installedAt: now,
      updatedAt: now,
    });
  },
});

/**
 * Resolve the org that installed the Slack App for a given workspace. The
 * single point inbound events use to route to a tenant. Returns null for an
 * unknown / uninstalled workspace (the caller drops the event).
 */
export const resolveOrgBySlackTeamId = internalQuery({
  args: { teamId: v.string() },
  returns: v.union(
    v.null(),
    v.object({
      organizationId: v.string(),
      slug: v.string(),
      botUserId: v.optional(v.string()),
      credentialId: v.id('integrationCredentials'),
    }),
  ),
  handler: async (ctx, { teamId }) => {
    const row = await ctx.db
      .query('slackInstallations')
      .withIndex('by_team', (q) => q.eq('teamId', teamId))
      .first();
    if (!row) return null;
    return {
      organizationId: row.organizationId,
      slug: row.slug,
      botUserId: row.botUserId,
      credentialId: row.credentialId,
    };
  },
});

/**
 * Resolve the (encrypted) signing secret of the Slack app that owns a workspace,
 * so the inbound events endpoint can verify the request HMAC against the per-org
 * secret. Returns null when the workspace is not installed or the credential has
 * no signing secret stored.
 *
 * Deliberately NOT gated on `isActive`: a deactivated integration's signed
 * deliveries must still verify and ACK 200 (then get dropped by
 * processSlackEvent) — returning null here would make the handler 401, which
 * Slack counts toward disabling the endpoint.
 */
export const resolveSlackSigningSecretByTeamId = internalQuery({
  args: { teamId: v.string() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { teamId }) => {
    const row = await ctx.db
      .query('slackInstallations')
      .withIndex('by_team', (q) => q.eq('teamId', teamId))
      .first();
    if (!row) return null;
    const cred = await ctx.db.get(row.credentialId);
    return cred?.oauth2Config?.signingSecretEncrypted ?? null;
  },
});

/**
 * Cascade helper: delete every routing row owned by a credential. Called inline
 * from the credential delete mutations when a Slack integration is disconnected
 * so the workspace stops routing.
 */
export async function deleteSlackInstallationsForCredential(
  ctx: MutationCtx,
  credentialId: Id<'integrationCredentials'>,
): Promise<void> {
  for await (const row of ctx.db
    .query('slackInstallations')
    .withIndex('by_credentialId', (q) => q.eq('credentialId', credentialId))) {
    await ctx.db.delete(row._id);
  }
}

export const deleteInstallationByCredentialId = internalMutation({
  args: { credentialId: v.id('integrationCredentials') },
  returns: v.null(),
  handler: async (ctx, args) => {
    await deleteSlackInstallationsForCredential(ctx, args.credentialId);
    return null;
  },
});
