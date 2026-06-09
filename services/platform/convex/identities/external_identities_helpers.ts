/**
 * Pure, dependency-free helpers for external (non-Better-Auth) thread-owner ids.
 *
 * These live in their OWN module — separate from `external_identities.ts`, which
 * defines convex functions (`internalMutation`/`internalQuery`) — so that client
 * code can import a helper WITHOUT dragging the function definitions into the
 * browser bundle. A convex function builder runs `assertNotBrowser()` at
 * module-init, so importing a function-defining module client-side logs
 * "Convex functions should not be imported in the browser" (and ships handler
 * code to clients). Keeping these helpers function-free avoids that. Mirrors the
 * sibling `external_identities_schema.ts` split.
 */

const EXTERNAL_OWNER_SEPARATOR = ':';

/**
 * Build a namespaced, org-scoped thread-owner id for an external author, e.g.
 * `buildExternalOwnerId('slack', 'U07ABC123', 'org_42') === 'slack:org_42:U07ABC123'`.
 *
 * The organization is part of the key on purpose: the same Slack user id can
 * appear in two workspaces connected to two different orgs (Enterprise Grid /
 * shared members). Scoping the owner id per org keeps each org's identity row
 * and display name isolated, so one org's name can never bleed into another's
 * prompts or member lists.
 */
export function buildExternalOwnerId(
  source: string,
  externalUserId: string,
  organizationId: string,
): string {
  return [source, organizationId, externalUserId].join(
    EXTERNAL_OWNER_SEPARATOR,
  );
}

/**
 * True when a thread-owner `userId` is NOT a Better Auth user id and therefore
 * must not be passed to the Better Auth adapter (its `_id` lookups route
 * through `ctx.db.get`, which throws on non-Convex-id strings). Covers the
 * `'system'` sentinel and namespaced external owners like `slack:org_42:U123`.
 * Real Better Auth ids never contain the separator.
 */
export function isExternalOwnerId(userId: string): boolean {
  return userId === 'system' || userId.includes(EXTERNAL_OWNER_SEPARATOR);
}
