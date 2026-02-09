/**
 * Business logic for finding or creating a Better Auth user from
 * trusted headers. In trusted headers mode, the role is NOT stored
 * in the member table - it comes from the session/JWT instead.
 *
 * This function only handles:
 * - Finding or creating the user record
 * - Finding or creating organization membership (for organizationId linkage)
 * - The member.role field is set to 'member' as a placeholder; the actual
 *   role is stored in the session and included in JWT claims.
 */

import type { MutationCtx } from '../../_generated/server';
import type {
  BetterAuthCreateResult,
  BetterAuthFindManyResult,
  BetterAuthMember,
  BetterAuthUser,
} from '../../members/types';

import { components } from '../../_generated/api';

export interface FindOrCreateUserFromHeadersArgs {
  email: string;
  name: string;
  role: string;
}

export interface FindOrCreateUserFromHeadersResult {
  userId: string;
  organizationId: string | null;
}

export async function findOrCreateUserFromHeaders(
  ctx: MutationCtx,
  args: FindOrCreateUserFromHeadersArgs,
): Promise<FindOrCreateUserFromHeadersResult> {
  // Normalize inputs
  const email = args.email.toLowerCase().trim();
  const name = args.name.trim();
  const _role = args.role.toLowerCase().trim();

  // Check if user already exists in Better Auth
  const existingUserResult: BetterAuthFindManyResult<BetterAuthUser> =
    await ctx.runQuery(components.betterAuth.adapter.findMany, {
      model: 'user',
      paginationOpts: {
        cursor: null,
        numItems: 1,
      },
      where: [
        {
          field: 'email',
          value: email,
          operator: 'eq',
        },
      ],
    });

  let userId: string;
  let organizationId: string | null = null;

  if (existingUserResult && existingUserResult.page.length > 0) {
    // User exists
    const existingUser = existingUserResult.page[0];
    userId = existingUser._id;

    // Update user's name if it changed
    if (existingUser.name !== name) {
      await ctx.runMutation(components.betterAuth.adapter.updateOne, {
        input: {
          model: 'user',
          update: {
            name,
            updatedAt: Date.now(),
          },
          where: [
            {
              field: '_id',
              value: userId,
              operator: 'eq',
            },
          ],
        },
      });
    }

    // Find their organization membership
    const memberResult: BetterAuthFindManyResult<BetterAuthMember> =
      await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'member',
        paginationOpts: {
          cursor: null,
          numItems: 1,
        },
        where: [
          {
            field: 'userId',
            value: userId,
            operator: 'eq',
          },
        ],
      });

    if (memberResult && memberResult.page.length > 0) {
      const member = memberResult.page[0];
      organizationId = member.organizationId;
      // Note: We don't update member.role here because in trusted headers mode,
      // the role comes from the session/JWT, not the member table.
    }
  } else {
    // User doesn't exist - create them
    // Note: We create user without password since auth is handled externally
    const createResult: BetterAuthCreateResult = await ctx.runMutation(
      components.betterAuth.adapter.create,
      {
        input: {
          model: 'user',
          data: {
            email,
            name,
            emailVerified: true, // Trust the external auth proxy
            createdAt: Date.now(),
            updatedAt: Date.now(),
          },
        },
      },
    );

    userId = createResult._id ?? createResult.id ?? String(createResult);

    // If there's already an organization in the system, attach this new
    // trusted-headers user to that existing organization instead of
    // creating a brand new one. This keeps all SSO users in the same org
    // by default.
    const existingAdminMemberResult: BetterAuthFindManyResult<BetterAuthMember> =
      await ctx.runQuery(components.betterAuth.adapter.findMany, {
        model: 'member',
        paginationOpts: {
          cursor: null,
          numItems: 1,
        },
        where: [
          {
            field: 'role',
            value: 'admin',
            operator: 'eq',
          },
        ],
      });

    if (
      existingAdminMemberResult &&
      existingAdminMemberResult.page.length > 0
    ) {
      const existingAdminMember = existingAdminMemberResult.page[0];
      const existingOrgId = existingAdminMember.organizationId;
      organizationId = existingOrgId;

      // Add the new user as a member of the existing organization.
      // Use 'member' as placeholder role - actual role comes from session/JWT.
      await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: 'member',
          data: {
            organizationId: existingOrgId,
            userId,
            role: 'member',
            createdAt: Date.now(),
          },
        },
      });
    } else {
      // No existing organization yet (first trusted-headers user) - create
      // a default organization for them and make them admin.
      const orgResult: BetterAuthCreateResult = await ctx.runMutation(
        components.betterAuth.adapter.create,
        {
          input: {
            model: 'organization',
            data: {
              name: `${name}'s Organization`,
              slug: `${email.split('@')[0]}-org-${Date.now()}`,
              createdAt: Date.now(),
            },
          },
        },
      );

      const newOrgId = orgResult._id ?? orgResult.id ?? String(orgResult);
      organizationId = newOrgId;

      await ctx.runMutation(components.betterAuth.adapter.create, {
        input: {
          model: 'member',
          data: {
            organizationId: newOrgId,
            userId,
            role: 'admin', // First user is always admin of their org
            createdAt: Date.now(),
          },
        },
      });
    }
  }

  return {
    userId,
    organizationId,
  };
}
