/**
 * Team members management - Convex queries and mutations
 * Works with Better Auth's teamMember table for team-based access control
 */

import { v } from 'convex/values';
import { query, mutation } from './_generated/server';
import { components } from './_generated/api';
import { getAuthenticatedUser } from './lib/rls';

// Type for Better Auth teamMember record
interface BetterAuthTeamMember {
  _id: string;
  teamId: string;
  userId: string;
  createdAt?: number | null;
}

// Type for Better Auth team record
interface BetterAuthTeam {
  _id: string;
  name: string;
  organizationId: string;
  createdAt: number;
  updatedAt?: number | null;
}

// Generic result type from Better Auth adapter
interface BetterAuthFindManyResult<T> {
  page: T[];
  continueCursor?: string;
  isDone?: boolean;
}

/**
 * List all members of a specific team
 */
export const listByTeam = query({
  args: {
    teamId: v.string(),
  },
  handler: async (ctx, args) => {
    // Query the Better Auth teamMember table via component adapter
    const result: BetterAuthFindManyResult<BetterAuthTeamMember> =
      await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'teamMember',
        paginationOpts: { cursor: null, numItems: 1000 },
        where: [{ field: 'teamId', operator: 'eq', value: args.teamId }],
      });

    return result.page;
  },
});

/**
 * Add a member to a team
 */
export const addMember = mutation({
  args: {
    teamId: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    // Authorization: verify caller is authenticated and is a member of the team
    const authUser = await getAuthenticatedUser(ctx);
    if (!authUser) {
      throw new Error('Not authenticated');
    }

    // Check if caller is a member of this team
    const callerMembership: BetterAuthFindManyResult<BetterAuthTeamMember> =
      await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'teamMember',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [
          { field: 'teamId', operator: 'eq', value: args.teamId },
          { field: 'userId', operator: 'eq', value: authUser.userId },
        ],
      });

    if (callerMembership.page.length === 0) {
      throw new Error('You must be a member of the team to add members');
    }

    // Check if member already exists in this team
    const existing: BetterAuthFindManyResult<BetterAuthTeamMember> =
      await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'teamMember',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [
          { field: 'teamId', operator: 'eq', value: args.teamId },
          { field: 'userId', operator: 'eq', value: args.userId },
        ],
      });

    if (existing.page.length > 0) {
      throw new Error('User is already a member of this team');
    }

    // Add the member via Better Auth adapter
    const created = await ctx.runMutation(components.betterAuth.adapter.create, {
      input: {
        model: 'teamMember',
        data: {
          teamId: args.teamId,
          userId: args.userId,
          createdAt: Date.now(),
        },
      },
    });

    return created;
  },
});

/**
 * Remove a member from a team
 */
export const removeMember = mutation({
  args: {
    teamId: v.string(),
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    // Authorization: verify caller is authenticated and is a member of the team
    const authUser = await getAuthenticatedUser(ctx);
    if (!authUser) {
      throw new Error('Not authenticated');
    }

    // Check if caller is a member of this team
    const callerMembership: BetterAuthFindManyResult<BetterAuthTeamMember> =
      await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'teamMember',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [
          { field: 'teamId', operator: 'eq', value: args.teamId },
          { field: 'userId', operator: 'eq', value: authUser.userId },
        ],
      });

    if (callerMembership.page.length === 0) {
      throw new Error('You must be a member of the team to remove members');
    }

    // Find the member record
    const existing: BetterAuthFindManyResult<BetterAuthTeamMember> =
      await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'teamMember',
        paginationOpts: { cursor: null, numItems: 1 },
        where: [
          { field: 'teamId', operator: 'eq', value: args.teamId },
          { field: 'userId', operator: 'eq', value: args.userId },
        ],
      });

    if (existing.page.length === 0) {
      throw new Error('User is not a member of this team');
    }

    // Remove the member via Better Auth adapter
    await ctx.runMutation(components.betterAuth.adapter.deleteMany, {
      input: {
        model: 'teamMember',
        where: [
          { field: 'teamId', operator: 'eq', value: args.teamId },
          { field: 'userId', operator: 'eq', value: args.userId },
        ],
      },
      paginationOpts: { cursor: null, numItems: 1 },
    });

    return { success: true };
  },
});

/**
 * Get all teams a user belongs to
 */
export const listTeamsByUser = query({
  args: {
    userId: v.string(),
  },
  handler: async (ctx, args) => {
    // Get user's team memberships
    const memberships: BetterAuthFindManyResult<BetterAuthTeamMember> =
      await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'teamMember',
        paginationOpts: { cursor: null, numItems: 1000 },
        where: [{ field: 'userId', operator: 'eq', value: args.userId }],
      });

    // Get team details for each membership
    const teams = await Promise.all(
      memberships.page.map(async (m) => {
        const teamResult: BetterAuthFindManyResult<BetterAuthTeam> =
          await ctx.runQuery(components.betterAuth.adapter.findMany, {
            model: 'team',
            paginationOpts: { cursor: null, numItems: 1 },
            where: [{ field: '_id', operator: 'eq', value: m.teamId }],
          });
        return teamResult.page[0];
      })
    );

    return teams.filter(Boolean);
  },
});
