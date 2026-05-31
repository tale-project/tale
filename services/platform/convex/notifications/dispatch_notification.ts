/**
 * Delivery-agnostic notification dispatcher.
 *
 * Source hooks emit `(organizationId, eventType, params)` — they know nothing
 * about Slack. The dispatcher renders the message via the catalog and fans out
 * to delivery sinks (v1: Slack only; email/Teams/webhook plug in here later,
 * each reading its own config + enabled-state).
 */

import { v } from 'convex/values';

import type { ActionCtx } from '../_generated/server';
import { internalAction } from '../_generated/server';
import {
  NOTIFICATION_EVENTS,
  isKnownNotificationEventType,
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

  const entry = NOTIFICATION_EVENTS[args.eventType];
  const message = entry.buildMessage(args.params);

  // Fan out to delivery sinks. Add new sinks here.
  await notifySlack(ctx, {
    organizationId: args.organizationId,
    eventType: args.eventType,
    defaultEnabled: entry.defaultEnabled,
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
    const params: Record<string, unknown> =
      args.params && typeof args.params === 'object' ? args.params : {};
    await dispatchNotification(ctx, {
      organizationId: args.organizationId,
      eventType: args.eventType,
      params,
    });
    return null;
  },
});
