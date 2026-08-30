/**
 * Resolve which organization an API caller is operating on.
 *
 * Shared by every API-key-authenticated HTTP surface (the REST v1 handlers
 * via `lib/rest/helpers.ts`; the OpenAI-compatible API used it from the same
 * helper before that surface was retired for its rebuild). Moved here from
 * `openai_compat/internal_queries.ts` because org resolution is an
 * organizations concern, not an API-dialect one.
 *
 * Resolution:
 *  1. Explicit `orgSlug` (the `X-Organization-Slug` header): resolve the
 *     org, then REQUIRE a current non-disabled membership — without that
 *     check, any API-key holder could probe another org's data by guessing
 *     its slug.
 *  2. No slug: auto-resolve from the user's memberships. A single-org user
 *     resolves directly; a multi-org user falls back to the dashboard's
 *     `lastActiveOrganizationId` when it maps to one of their current
 *     memberships, and otherwise must supply the header explicitly.
 *     With `requireExplicitOrgSlug` that fallback is skipped entirely: a
 *     multi-org user MUST send the header, because the last-active pointer
 *     moves with unrelated dashboard clicks — following it would silently
 *     redirect a write-capable machine key to another tenant.
 */

import { v } from 'convex/values';

import { AppError } from '../../lib/shared/errors/app-error';
import { isRecord, getString } from '../../lib/utils/type-utils';
import { components } from '../_generated/api';
import { internalQuery } from '../_generated/server';

export const resolveUserOrganization = internalQuery({
  args: {
    userId: v.string(),
    orgSlug: v.optional(v.string()),
    requireExplicitOrgSlug: v.optional(v.boolean()),
  },
  returns: v.object({
    organizationId: v.string(),
    orgSlug: v.string(),
  }),
  handler: async (ctx, args) => {
    if (args.orgSlug) {
      const org = await ctx.runQuery(components.betterAuth.adapter.findOne, {
        model: 'organization',
        where: [{ field: 'slug', value: args.orgSlug, operator: 'eq' }],
      });

      const orgRecord = isRecord(org) ? org : undefined;
      const orgId = orgRecord ? getString(orgRecord, '_id') : undefined;
      const canonicalSlug = orgRecord
        ? getString(orgRecord, 'slug')
        : undefined;
      if (!orgId || !canonicalSlug) {
        throw new AppError({
          code: 'ORG_SLUG_INVALID',
          message: `Organization not found: ${args.orgSlug}`,
        });
      }

      // Membership check — see the header note on slug probing.
      const memberRes = await ctx.runQuery(
        components.betterAuth.adapter.findMany,
        {
          model: 'member',
          paginationOpts: { cursor: null, numItems: 1 },
          where: [
            { field: 'organizationId', value: orgId, operator: 'eq' },
            { field: 'userId', value: args.userId, operator: 'eq' },
          ],
        },
      );
      const member = memberRes?.page?.[0];
      if (!member || getString(member, 'role') === 'disabled') {
        // Same code resolveRestOrgRole answers with → 403 at the REST boundary.
        throw new AppError({
          code: 'ORG_FORBIDDEN',
          message: `Not a member of organization ${canonicalSlug}`,
        });
      }

      return { organizationId: orgId, orgSlug: canonicalSlug };
    }

    // No slug provided — auto-resolve from user memberships.
    const memberResult = await ctx.runQuery(
      components.betterAuth.adapter.findMany,
      {
        model: 'member',
        paginationOpts: { cursor: null, numItems: 100 },
        where: [{ field: 'userId', value: args.userId, operator: 'eq' }],
      },
    );

    const members = (memberResult?.page ?? []).filter(
      (m: Record<string, unknown>) => getString(m, 'role') !== 'disabled',
    );

    if (members.length === 0) {
      throw new AppError({
        code: 'ORG_FORBIDDEN',
        message: 'User has no organization memberships',
      });
    }

    let pickedOrgId: string | undefined;
    if (members.length === 1) {
      pickedOrgId = getString(members[0], 'organizationId');
    } else {
      // Multi-org user. Strict callers never consult the last-active pointer
      // — see the header note on cross-tenant write redirects.
      if (!args.requireExplicitOrgSlug) {
        // Honour the dashboard's lastActiveOrganizationId before forcing the
        // caller to set X-Organization-Slug, so dev tools and scripts follow
        // the org the user already picked in the UI.
        const userRow = await ctx.runQuery(
          components.betterAuth.adapter.findOne,
          {
            model: 'user',
            where: [{ field: '_id', value: args.userId, operator: 'eq' }],
          },
        );
        const lastActive =
          userRow && isRecord(userRow)
            ? getString(userRow, 'lastActiveOrganizationId')
            : undefined;
        if (lastActive) {
          const memberOfLastActive = members.find(
            (m: Record<string, unknown>) =>
              getString(m, 'organizationId') === lastActive,
          );
          if (memberOfLastActive) {
            pickedOrgId = lastActive;
          }
        }
      }
      if (!pickedOrgId) {
        throw new AppError({
          code: 'ORG_SLUG_REQUIRED',
          message:
            'User belongs to multiple organizations. Provide X-Organization-Slug header.',
        });
      }
    }

    if (!pickedOrgId) {
      throw new Error('Organization ID missing from membership record');
    }

    // Look up the slug for downstream use.
    const org = await ctx.runQuery(components.betterAuth.adapter.findOne, {
      model: 'organization',
      where: [{ field: '_id', value: pickedOrgId, operator: 'eq' }],
    });

    const orgRecord = isRecord(org) ? org : undefined;
    const slug = orgRecord ? getString(orgRecord, 'slug') : undefined;
    if (!slug) {
      throw new Error('Organization slug not found');
    }

    return { organizationId: pickedOrgId, orgSlug: slug };
  },
});
