import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Backend-wide control flags, keyed by a single `'singleton'` row.
 *
 * Today it carries the deploy DRAIN flag: before `tale deploy` recreates the
 * convex container in-place (which restarts the backend process and kills every
 * in-flight action, including non-durable chat generation), the CLI sets
 * `draining: true` so new chat turns are refused (the client retries) while
 * in-flight generations finish. The CLI polls the in-flight count, then
 * recreates and clears the flag once the backend is healthy again.
 *
 * Why a DB row and not a module variable or a Convex env var:
 *  - A module variable lives in the very process being restarted — it can't be
 *    set by the CLI and survive.
 *  - A Convex env var change forces a function re-push/restart — the wrong tool
 *    for a transient runtime flag.
 *  - The `convex-data` volume persists this row across the recreate, so the
 *    CLI's `endDrain` after the restart is what clears it (with `drainExpiresAt`
 *    as the self-healing backstop if a deploy dies mid-flight).
 */
export const backendControlTable = defineTable({
  key: v.literal('singleton'),
  draining: v.boolean(),
  /** When the current drain began (telemetry / TTL anchor). */
  drainStartedAt: v.optional(v.number()),
  /**
   * Hard expiry: `isDrainingNow` treats the flag as off past this instant so a
   * crashed deploy can never strand the backend refusing chats forever. Set
   * well above the CLI's drain budget so it never fires during a healthy deploy.
   */
  drainExpiresAt: v.optional(v.number()),
}).index('by_key', ['key']);
