import { API_KEY_HINT_ENTITY } from '@/lib/shared/hint-entities';

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

/**
 * The organization's API-key listing (`GET /governance/api-keys`, the budget
 * editor's): keyed under the API-key entity, so a key created, renamed or
 * revoked anywhere refreshes it. It also describes the keys the saved budget
 * rules name, so a budgets change must refresh it as well — the save
 * adapter, and the hint handler for every `governance_policy` change another
 * session or a configuration import or rollback makes.
 */
export function orgApiKeyListKey(orgId: string): BackendQueryKey {
  return backendKey(orgId, API_KEY_HINT_ENTITY, 'org-list');
}

/** Project equipment depends on its audience and the org's skill/connector
 * catalog. A separate backend entity lets a project hint target one catalog
 * without expiring other projects; resync still reaches every org read. */
export function projectCapabilityCatalogKey(
  orgId: string,
  projectId?: string,
): BackendQueryKey {
  return backendKey(
    orgId,
    'project_capability',
    ...(projectId === undefined ? [] : [projectId]),
  );
}
