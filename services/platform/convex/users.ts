/**
 * Users API - Thin wrappers around model functions
 */

import { v } from 'convex/values';
import { query, mutation } from './_generated/server';
import { authComponent } from './auth';
import * as UsersModel from './model/users';

// =============================================================================
// PUBLIC QUERIES
// =============================================================================

/**
 * Check if any users exist in the system.
 * Used to determine if this is a fresh installation that should redirect to sign-up.
 */
export const hasAnyUsers = query({
  args: {},
  returns: v.boolean(),
  handler: async (ctx) => {
    return await UsersModel.hasAnyUsers(ctx);
  },
});

/**
 * Get the current authenticated user
 */
export const getCurrentUser = query({
  args: {},
  returns: v.union(
    v.object({
      _id: v.string(),
      _creationTime: v.number(),
      name: v.string(),
      email: v.string(),
      emailVerified: v.boolean(),
      image: v.optional(v.union(v.null(), v.string())),
      createdAt: v.number(),
      updatedAt: v.number(),
    }),
    v.null(),
  ),
  handler: async (ctx) => {
    try {
      return await authComponent.getAuthUser(ctx);
    } catch (error) {
      // Silently return null when user is not authenticated
      // This is expected behavior when the user is not logged in
      if (error instanceof Error && error.message.includes('Unauthenticated')) {
        return null;
      }
      // Log other unexpected errors
      console.error('Unexpected error in getCurrentUser:', error);
      return null;
    }
  },
});

// =============================================================================
// PUBLIC API OPERATIONS
// =============================================================================

/**
 * Create a new user and add them to an organization (admin only)
 */
export const createMember = mutation({
  args: {
    organizationId: v.string(),
    email: v.string(),
    password: v.string(),
    displayName: v.optional(v.string()),
    role: v.optional(UsersModel.roleValidator),
  },
  returns: v.object({
    userId: v.string(),
    memberId: v.string(),
  }),
  handler: async (ctx, args) => {
    return await UsersModel.createMember(ctx, args);
  },
});

/**
 * Update the current user's password
 */
export const updateUserPassword = mutation({
  args: {
    currentPassword: v.string(),
    newPassword: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args) => {
    const trustedHeadersEnabled =
      process.env.TRUSTED_HEADERS_ENABLED === 'true';
    if (trustedHeadersEnabled) {
      throw new Error(
        'Password changes are disabled because authentication is managed by a trusted headers provider.',
      );
    }
    await UsersModel.updateUserPassword(ctx, args);
    return null;
  },
});
