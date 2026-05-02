import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * Per-user, per-org "Custom Instructions" — a free-form text the user authors
 * that gets prepended to every chat's system prompt, plus the per-user
 * personalization toggles.
 *
 * Scope is `(userId, organizationId)`: the same human gets a separate row for
 * every org they belong to (mirrors Microsoft Copilot's mailbox-per-tenant
 * pattern; aligns with the existing Better Auth `member` table). This is the
 * user-private scoping pattern, orthogonal to org roles — admins cannot read
 * another user's row regardless of role.
 *
 * `enabled` is the user-level kill switch. `consentedAt` records the moment an
 * EU user clicked through the just-in-time consent modal; absence means we
 * have not yet established a lawful basis on the EU path, so
 * `buildUserPersonalization` short-circuits.
 *
 * `language` is captured at write time (BCP-47, e.g. "en-US", "de-DE") so we
 * can later render section headers in the user's locale without re-detecting.
 */
export const userPreferencesTable = defineTable({
  userId: v.string(),
  organizationId: v.string(),
  customInstructions: v.string(),
  enabled: v.boolean(),
  consentedAt: v.optional(v.number()),
  language: v.optional(v.string()),
  updatedAt: v.number(),
}).index('by_userId_organizationId', ['userId', 'organizationId']);
