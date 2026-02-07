/**
 * Helper to get user's team IDs for multi-tenant RAG operations.
 *
 * This module provides utilities to fetch team IDs for a user,
 * which are used to construct dataset names for RAG isolation.
 *
 * In trusted headers mode, team IDs come from JWT claims (trustedTeams).
 * In normal auth mode, team IDs come from the teamMember table.
 */

import type { GenericQueryCtx } from 'convex/server';
import { v } from 'convex/values';
import { components } from '../_generated/api';
import type { DataModel } from '../_generated/dataModel';
import { internalQuery } from '../_generated/server';

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
  ctx: GenericQueryCtx<DataModel>,
  userId: string,
): Promise<string[]> {
  // Check if JWT contains trusted teams (trusted headers mode)
  const identity = await ctx.auth.getUserIdentity();
  const trustedTeamsRaw = (identity as any)?.trustedTeams;

  if (trustedTeamsRaw) {
    // Trusted headers mode: parse team IDs from JWT claim
    // Format: [{id: "...", name: "..."}, ...]
    try {
      const teams = JSON.parse(trustedTeamsRaw) as Array<{ id: string; name: string }>;
      return teams.map((t) => t.id);
    } catch {
      return [];
    }
  }

  // Normal auth mode: query teamMember table with pagination
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
  ctx: GenericQueryCtx<DataModel>,
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
  ctx: GenericQueryCtx<DataModel>,
  userId: string,
): Promise<string[]> {
  const teamDatasets = await getUserDatasetNames(ctx, userId);
  // Include the default dataset for organization-level documents
  return [DEFAULT_DATASET_NAME, ...teamDatasets];
}

/**
 * Internal query to get searchable dataset names for a user.
 * This is exposed as an internalQuery so it can be called from agent tools.
 */
export const getSearchableDatasets = internalQuery({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args): Promise<string[]> => {
    return getSearchableDatasetNames(ctx, args.userId);
  },
});
