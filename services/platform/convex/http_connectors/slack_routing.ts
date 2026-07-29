/**
 * Which organization a Slack workspace belongs to, and where its events go
 * next.
 *
 * Slack delivers every workspace's events to one deployment-wide URL, so the
 * `team_id` → organization mapping IS the tenant boundary for inbound Slack
 * traffic. Two rules follow, and both are enforced here rather than at the call
 * site:
 *
 *  - an unmapped workspace resolves to NOTHING. It is never broadcast, never
 *    matched against "the only org", never guessed from the event's contents;
 *  - a workspace maps to exactly ONE organization. If the table ever holds two
 *    rows for a team, resolution refuses instead of picking one — an ambiguous
 *    mapping is a tenant-isolation failure, and answering it arbitrarily would
 *    hand one org's messages to another.
 */

import { v } from 'convex/values';

import {
  internalAction,
  internalMutation,
  internalQuery,
} from '../_generated/server';

/** Resolve the organization + credential for a Slack workspace. */
export const resolveTeamRoute = internalQuery({
  args: { teamId: v.string() },
  returns: v.union(
    v.object({ organizationId: v.string(), credentialId: v.string() }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    // Take two: one row is the answer, two is a defect we must refuse.
    const rows = await ctx.db
      .query('slackTeamRoutes')
      .withIndex('by_team', (q) => q.eq('teamId', args.teamId))
      .take(2);
    if (rows.length === 0) return null;
    if (rows.length > 1) {
      console.error(
        `[connectors:slack] refusing an ambiguous workspace route: team ${args.teamId} maps to ${rows.length} organizations`,
      );
      return null;
    }
    return {
      organizationId: rows[0].organizationId,
      credentialId: rows[0].credentialId,
    };
  },
});

/**
 * Point a workspace at an organization after a successful install.
 *
 * Re-installing into the same organization refreshes the credential the route
 * points at. A workspace already held by ANOTHER organization is refused: the
 * install that would silently re-point it is exactly how one tenant would
 * capture another tenant's inbound messages, so it fails loudly and the user is
 * told to disconnect it where it lives.
 */
export const claimTeamRoute = internalMutation({
  args: {
    teamId: v.string(),
    organizationId: v.string(),
    credentialId: v.string(),
  },
  returns: v.union(
    v.object({ ok: v.literal(true) }),
    v.object({
      ok: v.literal(false),
      reason: v.literal('claimed_by_other_org'),
    }),
  ),
  handler: async (ctx, args) => {
    const existing = await ctx.db
      .query('slackTeamRoutes')
      .withIndex('by_team', (q) => q.eq('teamId', args.teamId))
      .collect();

    const foreign = existing.filter(
      (row) => row.organizationId !== args.organizationId,
    );
    if (foreign.length > 0) {
      console.warn(
        `[connectors:slack] refusing to re-point workspace ${args.teamId}: already connected to another organization`,
      );
      return { ok: false as const, reason: 'claimed_by_other_org' as const };
    }

    const [own, ...duplicates] = existing;
    if (own) {
      await ctx.db.patch(own._id, { credentialId: args.credentialId });
      // Belt and braces: collapse any duplicate rows for this org so the
      // "exactly one route per workspace" invariant repairs itself.
      for (const duplicate of duplicates) await ctx.db.delete(duplicate._id);
      return { ok: true as const };
    }

    await ctx.db.insert('slackTeamRoutes', {
      teamId: args.teamId,
      organizationId: args.organizationId,
      credentialId: args.credentialId,
      createdAt: Date.now(),
    });
    return { ok: true as const };
  },
});

/**
 * Hand a verified, org-resolved Slack event to whatever answers messages.
 *
 * Scheduled, never awaited: Slack disables an endpoint that misses its
 * three-second acknowledgement, so the HTTP handler's last act is to queue this
 * and return 200. Everything expensive belongs on this side of that line.
 *
 * The conversational surface that consumes these is offline while the platform
 * AI backend is rewritten, so delivery currently degrades to a logged handoff —
 * the routing, the signature check and the org resolution all still run, which
 * is what keeps the endpoint honest in the meantime.
 */
export const deliverInboundEvent = internalAction({
  args: {
    organizationId: v.string(),
    credentialId: v.string(),
    teamId: v.string(),
    /** Slack's per-delivery id — the dedup key for at-least-once retries. */
    eventId: v.optional(v.string()),
    eventType: v.optional(v.string()),
    /** The verified `event` object, exactly as Slack sent it. */
    event: v.any(),
  },
  returns: v.null(),
  handler: async (_ctx, args) => {
    console.info('[connectors:slack] inbound event accepted', {
      organizationId: args.organizationId,
      teamId: args.teamId,
      eventId: args.eventId,
      eventType: args.eventType,
    });
    return null;
  },
});
