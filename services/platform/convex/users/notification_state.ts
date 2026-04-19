/**
 * Per-user notification acknowledgment state.
 *
 * Tracks which changelog version the user has explicitly seen (clicked
 * "What's new") and which version has already triggered the upgrade
 * toast. Keeping these separate lets the toast fire exactly once per
 * version while the red-dot indicator persists until the user actually
 * views the release notes.
 */

import { v } from 'convex/values';

import { mutation, query } from '../_generated/server';
import { getAuthUserIdentity } from '../lib/rls';

const notificationStateShape = v.object({
  userId: v.string(),
  lastSeenChangelogVersion: v.optional(v.string()),
  lastToastedVersion: v.optional(v.string()),
  updatedAt: v.number(),
});

export const getUserNotificationState = query({
  args: {},
  returns: v.union(notificationStateShape, v.null()),
  handler: async (ctx) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) return null;

    const row = await ctx.db
      .query('userNotificationState')
      .withIndex('by_userId', (q) => q.eq('userId', authUser.userId))
      .first();

    if (!row) return null;
    return {
      userId: row.userId,
      lastSeenChangelogVersion: row.lastSeenChangelogVersion,
      lastToastedVersion: row.lastToastedVersion,
      updatedAt: row.updatedAt,
    };
  },
});

export const markToastShown = mutation({
  args: { version: v.string() },
  returns: v.null(),
  handler: async (ctx, { version }) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const existing = await ctx.db
      .query('userNotificationState')
      .withIndex('by_userId', (q) => q.eq('userId', authUser.userId))
      .first();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        lastToastedVersion: version,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert('userNotificationState', {
        userId: authUser.userId,
        lastToastedVersion: version,
        updatedAt: now,
      });
    }
    return null;
  },
});

export const markChangelogSeen = mutation({
  args: { version: v.string() },
  returns: v.null(),
  handler: async (ctx, { version }) => {
    const authUser = await getAuthUserIdentity(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const existing = await ctx.db
      .query('userNotificationState')
      .withIndex('by_userId', (q) => q.eq('userId', authUser.userId))
      .first();

    const now = Date.now();
    if (existing) {
      await ctx.db.patch(existing._id, {
        lastSeenChangelogVersion: version,
        lastToastedVersion: version,
        updatedAt: now,
      });
    } else {
      await ctx.db.insert('userNotificationState', {
        userId: authUser.userId,
        lastSeenChangelogVersion: version,
        lastToastedVersion: version,
        updatedAt: now,
      });
    }
    return null;
  },
});
