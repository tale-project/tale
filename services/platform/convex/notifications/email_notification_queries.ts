import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';
import { getUserById } from '../betterAuth/trusted_headers/get_user_by_id';
import { isActionableEmailEnabled } from '../collab/notify';
import { ACTIONABLE_EMAIL_CONNECTORS } from './actionable_email_connectors';

const MAIL_CONNECTOR_SLUGS = new Set<string>(ACTIONABLE_EMAIL_CONNECTORS);

export const getRecipientEmailInternal = internalQuery({
  args: { userId: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args) => {
    const user = await getUserById(ctx, args.userId);
    const email = user?.email?.trim();
    return email || null;
  },
});

export const isActionableEmailEnabledInternal = internalQuery({
  args: {
    userId: v.string(),
    organizationId: v.string(),
  },
  returns: v.boolean(),
  handler: async (ctx, args) =>
    isActionableEmailEnabled(ctx, args.userId, args.organizationId),
});

/**
 * Active mail credentials the org can send actionable notification email
 * through. Metadata only — ciphertext never leaves the credential table.
 */
export const listActiveMailCredentialsInternal = internalQuery({
  args: { organizationId: v.string() },
  returns: v.array(
    v.object({
      credentialId: v.id('connectorCredentials'),
      connectorSlug: v.string(),
      isDefault: v.boolean(),
    }),
  ),
  handler: async (ctx, args) => {
    const rows = await ctx.db
      .query('connectorCredentials')
      .withIndex('by_org', (q) => q.eq('organizationId', args.organizationId))
      .collect();
    return rows
      .filter(
        (row) =>
          MAIL_CONNECTOR_SLUGS.has(row.connectorSlug) &&
          row.status === 'active',
      )
      .map((row) => ({
        credentialId: row._id,
        connectorSlug: row.connectorSlug,
        isDefault: row.isDefault,
      }));
  },
});
