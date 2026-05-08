import { defineTable } from 'convex/server';
import { v } from 'convex/values';

export const loginAttemptsTable = defineTable({
  email: v.string(),
  consecutiveFailures: v.number(),
  lastFailureAt: v.number(),
  lockedUntil: v.union(v.number(), v.null()),
})
  .index('by_email', ['email'])
  // Retention sweep: list rows with `lastFailureAt < cutoff` via index
  // range so the global pass scales linearly with expired rows rather
  // than total table size (round-2 v11 / M11).
  .index('by_lastFailureAt', ['lastFailureAt']);

// Coalesced counter for sign-in requests the before-hook rejected (lockout
// or per-IP flood guard). Writing one audit log per rejected request under
// DDoS would flood the audit table (up to ~1M rows/day for a single hot
// account, see `/home/larry/.claude/plans/foamy-kindling-papert.md`), so
// we bucket by hour instead. Admins get a bounded row count they can
// query / dashboard for attack visibility.
export const loginBlockCountersTable = defineTable({
  email: v.string(),
  // Epoch ms at the start of the hour bucket this row counts
  // (Math.floor(now / 3_600_000) * 3_600_000).
  windowStart: v.number(),
  lockoutCount: v.number(),
  ipLimitCount: v.number(),
  // Most recent IP seen in this bucket (informational, for triage).
  lastIp: v.optional(v.string()),
  updatedAt: v.number(),
})
  .index('by_email_window', ['email', 'windowStart'])
  .index('by_window', ['windowStart']);
