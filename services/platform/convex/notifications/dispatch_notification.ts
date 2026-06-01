/**
 * Delivery-agnostic notification dispatcher.
 *
 * Source hooks emit `(organizationId, eventType, params)` — they know nothing
 * about Slack. The dispatcher resolves the org's locale, renders the message via
 * the catalog, and fans out to delivery sinks (v1: Slack only; email/Teams/
 * webhook plug in here later, each reading its own config + enabled-state).
 *
 * Best-effort: both callers schedule this fire-and-forget, so a delivery failure
 * cannot fail the workflow/approval that triggered it. The sink isolates its own
 * errors too (see notify_slack).
 */

import { v } from 'convex/values';

import { isRecord } from '../../lib/utils/type-guards';
import { internal } from '../_generated/api';
import type { ActionCtx } from '../_generated/server';
import { internalAction } from '../_generated/server';
import {
  buildNotificationMessage,
  isKnownNotificationEventType,
  NOTIFICATION_EVENT_META,
} from './event_catalog';
import { notifySlack } from './notify_slack';

export async function dispatchNotification(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    eventType: string;
    params: Record<string, unknown>;
  },
): Promise<void> {
  if (!isKnownNotificationEventType(args.eventType)) {
    console.warn('[dispatchNotification] unknown event type:', args.eventType);
    return;
  }

  const meta = NOTIFICATION_EVENT_META[args.eventType];
  const locale = await ctx.runQuery(
    internal.organizations.internal_queries.getOrganizationDefaultLocale,
    { organizationId: args.organizationId },
  );
  const message = buildNotificationMessage(args.eventType, args.params, locale);

  // Fan out to delivery sinks. Add new sinks here.
  await notifySlack(ctx, {
    organizationId: args.organizationId,
    eventType: args.eventType,
    defaultEnabled: meta.defaultEnabled,
    message,
  });
}

export const dispatchNotificationAction = internalAction({
  args: {
    organizationId: v.string(),
    eventType: v.string(),
    params: v.optional(v.any()),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    // args.params is `any` (v.optional(v.any())); normalize to a plain object.
    const params: Record<string, unknown> = isRecord(args.params)
      ? args.params
      : {};
    await dispatchNotification(ctx, {
      organizationId: args.organizationId,
      eventType: args.eventType,
      params,
    });
    return null;
  },
});
