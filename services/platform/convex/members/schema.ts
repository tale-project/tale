import { defineTable } from 'convex/server';
import { v } from 'convex/values';

/**
 * App-native mirror of Better Auth's `member` table.
 *
 * WHY: every RLS-wrapped query resolves the caller's org memberships via
 * `getUserOrganizations`, and `canAccessThread` resolves `isOrgMember` — both
 * historically cross-component Better Auth `adapter.findMany` round-trips. On
 * the self-hosted local backend that cross-component cost is amplified ~5–10×
 * and, on the 4-vCPU CI runner, blows the backend's hard ~1s
 * function-execution timeout (the dominant E2E flake). This mirror lets those
 * two hot-path readers serve from a local indexed table instead.
 *
 * AUTHORITY: the mirror is a PERFORMANCE CACHE, never the security boundary.
 * `getOrganizationMember` (the authoritative RLS gate, with its email-fallback
 * and trusted-role override) keeps reading Better Auth directly. The two
 * mirror-backed readers fall back to Better Auth on a miss, and the trusted
 * headers `trustedRole` override is still applied at read time. Every member
 * write path syncs the mirror inline (or via the auth after-middleware), and an
 * hourly reconciliation cron repairs any drift from a partial failure. See
 * `lib/rls/MEMBERSHIP_MIRROR_DESIGN.md`.
 */
export const memberMirrorTable = defineTable({
  // Better Auth's member._id — the stable foreign key used for point
  // upserts/deletes and reconciliation dedup.
  memberId: v.string(),
  // Better Auth's member.userId — the primary lookup key (getUserOrganizations).
  userId: v.string(),
  // Better Auth's member.organizationId.
  organizationId: v.string(),
  // Better Auth's member.role, normalized lowercase (owner/admin/member/
  // editor/developer/disabled). Disabled rows are mirrored unchanged so the
  // reader's disabled-filter semantics are preserved.
  role: v.string(),
  // Better Auth's member.createdAt.
  createdAt: v.number(),
  // Last mirror write — drift detection / observability.
  updatedAt: v.optional(v.number()),
})
  .index('by_userId', ['userId'])
  .index('by_org_user', ['organizationId', 'userId'])
  .index('by_organizationId', ['organizationId'])
  .index('by_memberId', ['memberId']);

/**
 * Resume cursor for the hourly member-mirror reconciliation cron. Singleton
 * keyed by `job`; persists the Better Auth organization-pagination cursor so a
 * run resumes where the last left off and bounds work per tick.
 */
export const memberMirrorReconcileCursorTable = defineTable({
  // Singleton key, e.g. 'memberMirrorReconcile'.
  job: v.string(),
  // Opaque Better Auth `organization` pagination cursor; null = start over.
  cursor: v.optional(v.string()),
  updatedAt: v.number(),
}).index('by_job', ['job']);
