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
 * Throws if no matching org row exists — callers should ensure the
 * organizationId came from a verified-membership check upstream.
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
