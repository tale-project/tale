/**
 * Organizations API
 *
 * Notes:
 * - Organization CRUD operations (create, update, delete) should be done
 *   via the client-side authClient.organization.* methods, not through Convex.
 * - These functions are for server-side queries and setup actions only.
 */

import { v } from 'convex/values';
import { action, query } from './_generated/server';
import * as OrganizationsModel from './model/organizations';
import { saveDefaultWorkflows } from './model/organizations/save_default_workflows';
import type { BetterAuthOrganization } from './model/members/types';

// =============================================================================
// PUBLIC QUERY OPERATIONS
// =============================================================================

/**
 * Get the current user's active organization ID
 */
export const currentOrganization = query({
  args: {},
  returns: v.union(v.null(), v.string()),
  handler: async (ctx) => {
    try {
      return await OrganizationsModel.getCurrentOrganization(ctx);
    } catch {
      // Handle unauthenticated state gracefully (e.g., during logout)
      return null;
    }
  },
});

/**
 * Get an organization by ID from Better Auth
 */
export const getOrganization = query({
  args: {
    id: v.string(),
  },
  returns: v.union(
    v.object({
      _id: v.string(),
      name: v.string(),
      slug: v.string(),
      logo: v.optional(v.union(v.null(), v.string())),
      createdAt: v.number(),
      metadata: v.optional(v.union(v.null(), v.string())),
    }),
    v.null(),
  ),
  handler: async (ctx, args) => {
    try {
      const organization = await OrganizationsModel.getOrganization(
        ctx,
        args.id,
      );
      if (!organization) {
        return null;
      }

      // Shape result to match the public validator (exclude system fields like _creationTime)
      const org = organization as BetterAuthOrganization;
      const shaped = {
        _id: String(org._id),
        name: org.name,
        slug: org.slug,
        logo: org.logo ?? undefined,
        createdAt: Number(org.createdAt),
        ...((org.metadata === null || typeof org.metadata === 'string') && {
          metadata: org.metadata,
        }),
      };

      return shaped;
    } catch {
      // Handle unauthenticated state gracefully (e.g., during logout)
      return null;
    }
  },
});

// =============================================================================
// PUBLIC ACTIONS
// =============================================================================

/**
 * Initialize default workflows for a new organization
 *
 * This should be called after creating an organization to set up:
 * - Document RAG Sync workflow
 * - OneDrive Sync workflow
 *
 * Note: Plugins are now part of integrations and are created when
 * an integration is added (via predefined_integrations).
 */
export const initializeDefaultWorkflows = action({
  args: {
    organizationId: v.string(),
  },
  returns: v.object({
    success: v.boolean(),
    workflowIds: v.array(v.id('wfDefinitions')),
  }),
  handler: async (ctx, args) => {
    // Save default workflows
    const workflowIds = await saveDefaultWorkflows(ctx, {
      organizationId: args.organizationId,
    });

    return {
      success: true,
      workflowIds,
    };
  },
});
