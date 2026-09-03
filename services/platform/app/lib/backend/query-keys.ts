/**
 * Query-key vocabulary for 0.5-backend data.
 *
 * Every migrated hook keys its queries `['backend', orgId, entity, ...]`,
 * and the hint stream invalidates by the `['backend', orgId, entity]`
 * prefix — so the ONE contract binding reads to invalidation is this
 * module. The entity names are the outbox's (`backend/realtime/outbox.ts`
 * writers): singular nouns like `task`, `notification`, `document`. A name
 * both ends must agree on is declared once in `lib/shared/hint-entities.ts`
 * and imported by the writer AND the query key — a mismatch is silence, not
 * an error.
 */

export type BackendQueryKey = readonly [
  'backend',
  string,
  string,
  ...(readonly unknown[]),
];

/** Key for one query: `backendKey(orgId, 'task', 'list', filters)`. */
export function backendKey(
  orgId: string,
  entity: string,
  ...parts: readonly unknown[]
): BackendQueryKey {
  return ['backend', orgId, entity, ...parts];
}

/** The invalidation prefix a hint on `entity` maps to. */
export function backendEntityPrefix(
  orgId: string,
  entity: string,
): readonly ['backend', string, string] {
  return ['backend', orgId, entity];
}

/** Every backend query of one org — what a `resync` (a replay the server
 * could not serve in full) invalidates. */
export function backendOrgPrefix(orgId: string): readonly ['backend', string] {
  return ['backend', orgId];
}
