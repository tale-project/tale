/**
 * Look up the `slug` for an organization given its Better Auth `_id`.
 *
 * RAG/crawler require the slug (not the id) on the X-Tale-Org header
 * because their per-org provider catalog is keyed by slug on disk at
 * `$TALE_CONFIG_DIR/<orgSlug>/providers/`. Most Convex action contexts
 * carry `organizationId`; this helper bridges to the slug.
 */

import { getString, isRecord } from '../../../lib/utils/type-guards';
import { components } from '../../_generated/api';

// Loose ctx shape so all of: Convex ActionCtx, ToolCtx, query/mutation
// ctxs can pass through. The runQuery signature on the real Convex
// types is generic over FunctionReference — using a narrower stub here
// would force every caller to cast.
type CtxWithRunQuery = {
  // oxlint-disable-next-line typescript/no-explicit-any -- structural-only typing for cross-ctx compatibility
  runQuery: (...args: any[]) => Promise<unknown>;
};

/**
 * Resolve an organizationId to its slug via Better Auth.
 *
 * **This helper does NOT verify caller membership.** It is purely an
 * id → slug lookup that succeeds for any organization row that exists.
 * Callers must ensure `organizationId` came from a verified-membership
 * check upstream (e.g. `requireOrgMembership`, `requireOrgMembershipById`,
 * `getOrganizationMember`, or a server-side context whose
 * `organizationId` is trusted by construction).
 *
 * **Never** call this with an `organizationId` taken directly from
 * a request body / argument without first verifying membership — that
 * would let a member of org A pass org B's id and silently obtain
 * org B's slug, then use it as the `X-Tale-Org` header on a downstream
 * RAG/crawler call.
 *
 * Throws if no matching org row exists, or if the row has no slug.
 */
export async function orgSlugFromId(
  ctx: CtxWithRunQuery,
  organizationId: string,
): Promise<string> {
  const row = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'organization',
    where: [{ field: '_id', value: organizationId, operator: 'eq' }],
  });
  if (!isRecord(row)) {
    throw new Error(
      `[orgSlugFromId] no organization row found for id ${JSON.stringify(organizationId)}`,
    );
  }
  const slug = getString(row, 'slug');
  if (!slug) {
    throw new Error(
      `[orgSlugFromId] organization ${JSON.stringify(organizationId)} has no slug`,
    );
  }
  return slug;
}
