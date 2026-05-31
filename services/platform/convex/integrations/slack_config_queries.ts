import { v } from 'convex/values';

import { isRecord, getString } from '../../lib/utils/type-guards';
import { internalQuery } from '../_generated/server';

/**
 * Per-org Slack config lives on the slug='slack' credential's free-form
 * `connectionConfig` (already `v.any()`, no schema migration):
 *
 *   { slackAgentSlug?: string,
 *     notifyChannels?: string[],
 *     notifyEvents?: Record<string, boolean> }
 *
 * - `slackAgentSlug` — which agent answers inbound Slack messages.
 * - `notifyChannels` — channels that receive outbound system notifications.
 * - `notifyEvents` — per-event on/off overrides (defaults come from the
 *   notification event catalog).
 */

export const getSlackAgentSlug = internalQuery({
  args: { organizationId: v.string() },
  returns: v.union(v.null(), v.string()),
  handler: async (ctx, { organizationId }) => {
    const cred = await ctx.db
      .query('integrationCredentials')
      .withIndex('by_organizationId_and_slug', (q) =>
        q.eq('organizationId', organizationId).eq('slug', 'slack'),
      )
      .first();
    const cfg = cred?.connectionConfig;
    return isRecord(cfg) ? (getString(cfg, 'slackAgentSlug') ?? null) : null;
  },
});

export const getSlackNotifyChannels = internalQuery({
  args: { organizationId: v.string() },
  returns: v.array(v.string()),
  handler: async (ctx, { organizationId }) => {
    const cred = await ctx.db
      .query('integrationCredentials')
      .withIndex('by_organizationId_and_slug', (q) =>
        q.eq('organizationId', organizationId).eq('slug', 'slack'),
      )
      .first();
    const cfg = cred?.connectionConfig;
    if (!isRecord(cfg)) return [];
    const channels = cfg.notifyChannels;
    if (!Array.isArray(channels)) return [];
    return channels.filter((c): c is string => typeof c === 'string');
  },
});
