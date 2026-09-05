/**
 * Look up the `slug` for an organization given its Better Auth `_id`.
 *
 * RAG/crawler require the slug (not the id) on the X-Tale-Org header
 * because their per-org provider catalog is keyed by slug on disk at
 * `$TALE_CONFIG_DIR/<orgSlug>/providers/`. Most Convex action contexts
 * carry `organizationId`; this helper bridges to the slug.
 */

import { AppError } from '../../../../lib/shared/errors/app-error';
import { getString, isRecord } from '../../../../lib/utils/type-utils';
import { components } from '../handler_names';
import { looksLikeConvexDocumentId } from './id_shape';

// Loose ctx shape so all of: Convex ActionCtx, ToolCtx, query/mutation
// ctxs can pass through. The runQuery signature on the real Convex
// types is generic over FunctionReference — using a narrower stub here
// would force every caller to cast.
type CtxWithRunQuery = {
  // oxlint-disable-next-line typescript/no-explicit-any -- structural-only typing for cross-ctx compatibility
  runQuery: (...args: any[]) => Promise<unknown>;
};

/**
 * Terminal lookup failure: the org row was not found, or exists but has
 * no `slug` field. Both conditions are permanent — retrying will not
 * succeed, so callers (`orgSlugFromIdOrNull`, retry-on-throw layers)
 * should treat this distinctly from transient transport errors.
 *
 * Extends `AppError` with `code: 'ORG_NOT_FOUND'` so that when it does
 * propagate uncaught out of a public function (a stale client whose
 * persisted active org was deleted), the client receives a structured,
 * dispatchable error — the same code the membership gate
 * (`auth/membership.ts`) uses for a dead org — instead of an opaque redacted
 * "Server Error" it retries forever. `message` is reassigned after
 * `super()` so server logs keep the human sentence (the wire serializes
 * `data`, not `message`).
 */
export class OrgSlugUnresolvableError extends AppError<{
  code: string;
  message: string;
}> {
  override readonly name = 'OrgSlugUnresolvableError';

  constructor(
    readonly organizationId: string,
    readonly reason: 'no_row' | 'no_slug',
  ) {
    const message =
      reason === 'no_row'
        ? `[orgSlugFromId] no organization row found for id ${JSON.stringify(organizationId)}`
        : `[orgSlugFromId] organization ${JSON.stringify(organizationId)} has no slug`;
    super({ code: 'ORG_NOT_FOUND', message });
    this.message = message;
  }
}

export function isOrgSlugUnresolvable(
  err: unknown,
): err is OrgSlugUnresolvableError {
  return err instanceof OrgSlugUnresolvableError;
}

/**
 * Resolve an organizationId to its slug via Better Auth.
 *
 * **This helper does NOT verify caller membership.** It is purely an
 * id → slug lookup that succeeds for any organization row that exists.
 * Callers must ensure `organizationId` came from a verified-membership
 * check upstream (the `requireOrgMember` middleware /
 * `requireOrganizationMember`, or a server-side context whose
 * `organizationId` is trusted by construction).
 *
 * **Never** call this with an `organizationId` taken directly from
 * a request body / argument without first verifying membership — that
 * would let a member of org A pass org B's id and silently obtain
 * org B's slug, then use it as the `X-Tale-Org` header on a downstream
 * RAG/crawler call.
 *
 * Throws `OrgSlugUnresolvableError` when the row is missing or has no
 * slug; transport errors (Better Auth adapter failure, network blip)
 * propagate as themselves. Callers that want to fold the terminal-miss
 * case into a `null` result (cascade cleanup, governance, multi-org
 * status batches) should use `orgSlugFromIdOrNull`.
 */
export async function orgSlugFromId(
  ctx: CtxWithRunQuery,
  organizationId: string,
): Promise<string> {
  return (await orgIdentityFromId(ctx, organizationId)).slug;
}

export interface OrgIdentity {
  slug: string;
  /** The org's display name; absent only on legacy rows with no `name`. */
  name?: string;
}

/**
 * Resolve an organizationId to its `{ slug, name }` in a single lookup.
 *
 * Same non-membership-gated contract and `OrgSlugUnresolvableError` semantics
 * as `orgSlugFromId` (see its doc) — callers must have verified membership (or
 * be reading display-only data). Used where both the on-disk slug and the
 * human display name are needed at once, e.g. branding reads that surface the
 * org name as the app name.
 */
export async function orgIdentityFromId(
  ctx: CtxWithRunQuery,
  organizationId: string,
): Promise<OrgIdentity> {
  // A value that cannot BE a document id (a sentinel like 'system', a slug,
  // an email) would throw INSIDE the betterAuth component — logged there as
  // an uncaught error on every caller cadence, and non-terminal to
  // `orgSlugFromIdOrNull`, so cron reconcilers would retry it forever.
  // Treat it as the permanent miss it is.
  if (!looksLikeConvexDocumentId(organizationId)) {
    throw new OrgSlugUnresolvableError(organizationId, 'no_row');
  }
  const row = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'organization',
    where: [{ field: '_id', value: organizationId, operator: 'eq' }],
  });
  if (!isRecord(row)) {
    throw new OrgSlugUnresolvableError(organizationId, 'no_row');
  }
  const slug = getString(row, 'slug');
  if (!slug) {
    throw new OrgSlugUnresolvableError(organizationId, 'no_slug');
  }
  return { slug, name: getString(row, 'name') };
}

/**
 * Variant of `orgSlugFromId` that returns `null` on terminal lookup
 * failure (row missing, no slug field) instead of throwing. Transient
 * errors (transport, adapter exceptions) still propagate.
 *
 * Use this from callers where "the org is gone" is a recoverable state
 * — typically anything that runs after the org may have been deleted:
 *
 *   - Background cascade cleanup (`threads/cascade_helpers.ts`)
 *   - GDPR subject erasure cascade (`governance/erasure.ts`)
 *   - Retention sweeps (`governance/retention_cleanup.ts`)
 *   - Multi-org status batches that should not abort on one bad org
 *     (`file_metadata/actions.ts`)
 *   - Polling/retry actions where a missing slug should stop the
 *     retry loop rather than reschedule indefinitely
 *     (`documents/internal_actions.ts::deleteDocumentFromRag`)
 *
 * Callers that NEED the slug (agent tools, user-initiated reads/writes
 * that must reach RAG/crawler with the X-Tale-Org header) should keep
 * using `orgSlugFromId` so the throw bubbles up to a user-facing error.
 */
export async function orgSlugFromIdOrNull(
  ctx: CtxWithRunQuery,
  organizationId: string,
): Promise<string | null> {
  try {
    return await orgSlugFromId(ctx, organizationId);
  } catch (err) {
    if (isOrgSlugUnresolvable(err)) return null;
    throw err;
  }
}

/**
 * Resolve an org `slug` back to its Better Auth `_id` — the inverse of
 * {@link orgSlugFromId}.
 *
 * Background contexts that are keyed by slug (the in-process crawler stores
 * `website_org_memberships.org_slug`, not the org id) need the id to read the
 * per-org `websites` rows, which are indexed `by_organizationId`. Returns
 * `null` when no org has that slug (deleted / renamed) so callers can no-op
 * rather than throw — these are best-effort background syncs, not user-facing
 * reads.
 *
 * **Does NOT verify membership** — same caveat as `orgSlugFromId`. Only call
 * with a slug obtained from a trusted server-side source (e.g. the corpus
 * membership table this deployment owns), never from a request body.
 */
export async function orgIdFromSlug(
  ctx: CtxWithRunQuery,
  slug: string,
): Promise<string | null> {
  const row = await ctx.runQuery(components.betterAuth.adapter.findOne, {
    model: 'organization',
    where: [{ field: 'slug', value: slug, operator: 'eq' }],
  });
  if (!isRecord(row)) return null;
  return getString(row, '_id') || null;
}
