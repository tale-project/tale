import { defineTable } from 'convex/server';
import { v } from 'convex/values';

// Per-user password rotation metadata.
// Tracks when the user's credential password was most recently set, for
// the configurable password-rotation policy. Stored separately from the
// Better Auth `account` row because `account.updatedAt` is patched by
// non-password events (e.g., Microsoft OAuth token refresh) and so isn't
// a trustworthy password-change proxy.
export const userPasswordMetadataTable = defineTable({
  userId: v.string(),
  passwordChangedAt: v.number(),
  forceChangeOnNextLogin: v.optional(v.boolean()),
}).index('by_userId', ['userId']);

// Per-user notification acknowledgment state.
// `lastSeenChangelogVersion` is set when the user explicitly views the
// release notes (clicks "What's new"); the red dot stays until then.
// `lastToastedVersion` advances whenever the toast is displayed, so the
// toast never fires twice for the same version even if the user closes
// it without viewing.
export const userNotificationStateTable = defineTable({
  userId: v.string(),
  lastSeenChangelogVersion: v.optional(v.string()),
  lastToastedVersion: v.optional(v.string()),
  updatedAt: v.number(),
}).index('by_userId', ['userId']);
