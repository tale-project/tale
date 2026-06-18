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
 * AUTHORITY: the mirror backs the org-level RLS reads — `getUserOrganizations`,
 * `isOrgMember`, AND `getOrganizationMember` (the gate behind
 * `assertSelfAndOrgMember` / raw-query callers like `getMyPreferences`, whose
 * cold cross-component read here was the dominant white-screen timeout). All
 * three read the mirror and fall back to Better Auth on a miss; the trusted
 * headers `trustedRole` override is still applied at read time and the
 * email-fallback / account-linking branch still resolves against Better Auth.
 * This makes the mirror authoritative for org membership under BOUNDED EVENTUAL
 * CONSISTENCY: every member write path syncs inline (same transaction) or via
 * the auth hooks / after-middleware, and an hourly reconciliation cron converges
 * any drift from a partial failure. See `lib/rls/MEMBERSHIP_MIRROR_DESIGN.md`.
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
 * App-native mirror of Better Auth's `teamMember` table — the team-level
 * counterpart of `memberMirror`. `getUserTeamIds` is the OTHER half of the RLS
 * request-context prime (run in parallel with `getUserOrganizations`); it used
 * to paginate Better Auth's `teamMember` by `userId` cross-component on every
 * `queryWithRLS` request, so on the self-hosted backend it kept queries
 * (listConversations, listDocuments, …) over the 1s budget even after the member
 * mirror landed. Reading this local indexed table removes that round-trip too.
 *
 * Same bounded-eventual-consistency model + sync machinery as `memberMirror`.
 * The JWT `trustedTeams` short-circuit in `get_user_teams.ts` still wins when
 * present. Unlike memberships, a user commonly has ZERO teams, so the reader
 * treats an empty mirror as authoritative (no teams) rather than falling back.
 */
export const teamMemberMirrorTable = defineTable({
  // Better Auth's teamMember._id.
  teamMemberId: v.string(),
  // Better Auth's teamMember.userId — primary lookup key (getUserTeamIds).
  userId: v.string(),
  // Better Auth's teamMember.teamId.
  teamId: v.string(),
  // Better Auth's teamMember.createdAt.
  createdAt: v.optional(v.number()),
  updatedAt: v.optional(v.number()),
})
  .index('by_userId', ['userId'])
  .index('by_team_user', ['teamId', 'userId'])
  .index('by_teamId', ['teamId'])
  .index('by_teamMemberId', ['teamMemberId']);

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
