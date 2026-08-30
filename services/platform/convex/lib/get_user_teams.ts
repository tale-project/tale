import { getString, isRecord, parseJson } from '../../lib/utils/type-utils';
import { components } from '../_generated/api';
import type { QueryCtx } from '../_generated/server';

// Type for Better Auth teamMember record
interface BetterAuthTeamMember {
  _id: string;
  teamId: string;
  userId: string;
  createdAt?: number | null;
}

// Generic result type from Better Auth adapter
interface BetterAuthFindManyResult<T> {
  page: T[];
  continueCursor?: string;
  isDone?: boolean;
}

/**
 * Dataset name prefix for team-scoped data.
 * Format: tale_team_{teamId}
 */
export const TEAM_DATASET_PREFIX = 'tale_team_';

/**
 * Default dataset name for organization-level data (no team).
 */
export const DEFAULT_DATASET_NAME = 'tale_documents';

/**
 * Get all team IDs that a user belongs to.
 *
 * In trusted headers mode, returns team IDs from JWT claims (trustedTeams).
 * In normal auth mode, queries the teamMember table.
 *
 * @param ctx - Convex query context
 * @param userId - User ID to look up
 * @returns Array of team IDs
 */
export async function getUserTeamIds(
  ctx: QueryCtx,
  userId: string,
): Promise<string[]> {
  // Check if JWT contains trusted teams (trusted headers mode)
  const identity = await ctx.auth.getUserIdentity();
  if (isRecord(identity)) {
    const trustedTeamsRaw = getString(identity, 'trustedTeams');
    if (trustedTeamsRaw) {
      // Trusted headers mode: parse team IDs from JWT claim
      // Format: [{id: "...", name: "..."}, ...]
      try {
        const teams =
          parseJson<Array<{ id: string; name: string }>>(trustedTeamsRaw);
        return Array.isArray(teams)
          ? teams
              .filter(
                (t): t is { id: string; name: string } =>
                  isRecord(t) &&
                  typeof t.id === 'string' &&
                  typeof t.name === 'string',
              )
              .map((t) => t.id)
          : [];
      } catch {
        return [];
      }
    }
  }

  // Local mirror: a single indexed db read instead of a cross-component
  // teamMember round-trip. This is the other half of the RLS request-context
  // prime (parallel with getUserOrganizations); on the self-hosted backend the
  // old cross-component read here pushed queryWithRLS queries (listConversations,
  // listDocuments, …) over the 1s budget. Synced inline on every teamMember
  // write path + an hourly reconcile (see members/mirror_sync.ts).
  //
  // Unlike memberships, a user commonly has ZERO teams, so an empty mirror is
  // the normal team-less case — we treat the mirror as authoritative (empty ⇒
  // no teams) rather than falling back, which would re-introduce the round-trip
  // for the common case. A not-yet-backfilled team member therefore fails CLOSED
  // (no team access) until the hourly reconcile lands — a safe, bounded
  // direction. Better Auth is the error fallback only (mirror read threw).
  try {
    const teamIds: string[] = [];
    for await (const row of ctx.db
      .query('teamMemberMirror')
      .withIndex('by_userId', (q) => q.eq('userId', userId))) {
      teamIds.push(row.teamId);
    }
    return teamIds;
  } catch (err) {
    console.warn(
      '[getUserTeamIds] team mirror read failed; falling back to Better Auth',
      err instanceof Error ? err.message : err,
    );
  }

  // Error fallback: query teamMember table with pagination
  const allTeamIds: string[] = [];
  let cursor: string | null = null;
  let isDone = false;

  while (!isDone) {
    const memberships: BetterAuthFindManyResult<BetterAuthTeamMember> =
      await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'teamMember',
        paginationOpts: { cursor, numItems: 1000 },
        where: [{ field: 'userId', operator: 'eq', value: userId }],
      });

    allTeamIds.push(...memberships.page.map((m) => m.teamId));
    isDone = memberships.isDone ?? true;
    cursor = memberships.continueCursor ?? null;
  }

  return allTeamIds;
}

/**
 * Convert a team ID to a dataset name.
 *
 * @param teamId - Team ID
 * @returns Dataset name in format 'tale_team_{teamId}'
 */
export function teamIdToDatasetName(teamId: string): string {
  return `${TEAM_DATASET_PREFIX}${teamId}`;
}

/**
 * Get all dataset names for a user's teams.
 * Used for searching across all team datasets.
 *
 * @param ctx - Convex query context
 * @param userId - User ID to look up
 * @returns Array of dataset names (e.g., ['tale_team_abc123', 'tale_team_def456'])
 */
export async function getUserDatasetNames(
  ctx: QueryCtx,
  userId: string,
): Promise<string[]> {
  const teamIds = await getUserTeamIds(ctx, userId);
  return teamIds.map(teamIdToDatasetName);
}

/**
 * Get dataset names for search, including team datasets and the default dataset.
 * This allows users to search across:
 * 1. All their team-specific datasets
 * 2. The organization-level default dataset
 *
 * @param ctx - Convex query context
 * @param userId - User ID to look up
 * @returns Array of all dataset names the user can access
 */
export async function getSearchableDatasetNames(
  ctx: QueryCtx,
  userId: string,
): Promise<string[]> {
  const teamDatasets = await getUserDatasetNames(ctx, userId);
  // Include the default dataset for organization-level documents
  return [DEFAULT_DATASET_NAME, ...teamDatasets];
}
