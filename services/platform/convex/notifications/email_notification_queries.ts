import { v } from 'convex/values';

import { internalQuery } from '../_generated/server';
import { getUserById } from '../betterAuth/trusted_headers/get_user_by_id';
import { isActionableEmailEnabled } from '../collab/notify';
import { notificationTypeValidator } from '../collab/schema';
import { jsonRecordValidator } from '../lib/validators/json';
import { ACTIONABLE_EMAIL_CONNECTORS } from './actionable_email_connectors';

const MAIL_CONNECTOR_SLUGS = new Set<string>(ACTIONABLE_EMAIL_CONNECTORS);

/**
 * The bell row an email is about to render, or null when it must not be sent.
 *
 * The email is scheduled with a debounce and re-read here, so this is where
 * "send the latest version, once" is enforced: a row that was rewritten reads
 * back with its NEW copy, a row whose event was undone is gone, and a row the
 * recipient already read in the app needs no email at all.
 */
export const getDeliverableNotificationInternal = internalQuery({
  args: { notificationId: v.id('userNotifications') },
  returns: v.union(
    v.null(),
    v.object({
      userId: v.string(),
      organizationId: v.string(),
      type: notificationTypeValidator,
      titleKey: v.string(),
      bodyKey: v.string(),
      params: v.optional(jsonRecordValidator),
      taskId: v.optional(v.id('tasks')),
    }),
  ),
  handler: async (ctx, args) => {
    const row = await ctx.db.get(args.notificationId);
    if (!row || row.read) return null;
    return {
      userId: row.userId,
      organizationId: row.organizationId,
      type: row.type,
      titleKey: row.titleKey,
      bodyKey: row.bodyKey,
      params: row.params,
      taskId: row.taskId,
    };
  },
});

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
