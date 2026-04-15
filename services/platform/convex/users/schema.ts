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
}).index('by_userId', ['userId']);
