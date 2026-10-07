import type { Sql, TransactionSql } from 'postgres';

/**
 * Who an API key belongs to when it is not simply its maker's own — the
 * `app.api_key_owners` row (migration 0154).
 *
 *  - `member`: a key an Owner or Admin made for another member. It acts as
 *    that member, with their live role and teams, in its organization only.
 *  - `team`, `project`, `organization`: a key that is not a person. It acts
 *    as an identity of its own (a `"user"` row with no membership), with the
 *    role it was made with — across the organization, with one team's
 *    audience, or inside one project only.
 *
 * A key with no row is a person's own key: it acts as them in every
 * organization they belong to.
 */

type Db = Sql | TransactionSql;

export const API_KEY_OWNER_KINDS = [
  'member',
  'team',
  'project',
  'organization',
] as const;
export type ApiKeyOwnerKind = (typeof API_KEY_OWNER_KINDS)[number];

/** The roles a key that is not a person can act with — never `owner`. */
export const SERVICE_KEY_ROLES = [
  'member',
  'editor',
  'developer',
  'admin',
] as const;
export type ServiceKeyRole = (typeof SERVICE_KEY_ROLES)[number];

/** A team's or a project's key acts as a member of a team does: an admin
 * role would see every audience in the organization. */
export const SCOPED_SERVICE_KEY_ROLES: readonly ServiceKeyRole[] = [
  'member',
  'editor',
  'developer',
];

export function isServiceKeyRole(value: string): value is ServiceKeyRole {
  return (SERVICE_KEY_ROLES as readonly string[]).includes(value);
}

function isApiKeyOwnerKind(value: string): value is ApiKeyOwnerKind {
  return (API_KEY_OWNER_KINDS as readonly string[]).includes(value);
}

export interface ApiKeyOwner {
  apiKeyId: string;
  organizationId: string;
  kind: ApiKeyOwnerKind;
  /** Who the key acts as: the member, or the key's own identity. */
  principalUserId: string;
  teamId: string | null;
  projectId: string | null;
  /** The role a team, project or organization key acts with; null for a
   * member's key, which acts with the member's live role. */
  role: ServiceKeyRole | null;
  /** The name the key was made with. */
  name: string;
  createdBy: string;
  createdAt: number;
  revokedAt: number | null;
  revokedBy: string | null;
}

interface OwnerRow {
  apiKeyId: string;
  organizationId: string;
  kind: string;
  principalUserId: string;
  teamId: string | null;
  projectId: string | null;
  role: string | null;
  name: string;
  createdBy: string;
  createdAt: string | number;
  revokedAt: string | number | null;
  revokedBy: string | null;
}

/** The row as an owner, or null when its kind is none of the four the
 * column's CHECK admits. */
function toOwner(row: OwnerRow): ApiKeyOwner | null {
  if (!isApiKeyOwnerKind(row.kind)) return null;
  return {
    apiKeyId: row.apiKeyId,
    organizationId: row.organizationId,
    kind: row.kind,
    principalUserId: row.principalUserId,
    teamId: row.teamId,
    projectId: row.projectId,
    role: row.role !== null && isServiceKeyRole(row.role) ? row.role : null,
    name: row.name,
    createdBy: row.createdBy,
    createdAt: Number(row.createdAt),
    revokedAt: row.revokedAt === null ? null : Number(row.revokedAt),
    revokedBy: row.revokedBy,
  };
}

/** The owner row of one key, live or revoked, or null for a person's own
 * key. */
export async function readApiKeyOwner(
  db: Db,
  apiKeyId: string,
): Promise<ApiKeyOwner | null> {
  if (apiKeyId === '') return null;
  const rows = await db<OwnerRow[]>`
    SELECT api_key_id AS "apiKeyId", org_id AS "organizationId",
           owner_kind AS "kind", principal_user_id AS "principalUserId",
           team_id AS "teamId", project_id AS "projectId", role, name,
           created_by AS "createdBy", created_at_ms AS "createdAt",
           revoked_at_ms AS "revokedAt", revoked_by AS "revokedBy"
    FROM app.api_key_owners
    WHERE api_key_id = ${apiKeyId}
    LIMIT 1
  `;
  const row = rows[0];
  if (row === undefined) return null;
  const owner = toOwner(row);
  // Reading a row of an unknown kind as a person's own key would let it work
  // in every organization of its identity: the request fails instead.
  if (owner === null) {
    throw new Error(
      `api key ${row.apiKeyId} has an unknown owner kind "${row.kind}"`,
    );
  }
  return owner;
}

/**
 * The key whose own identity `userId` is — a team's, a project's or the
 * organization's — live or revoked, or null when `userId` is a person. An
 * identity is never a person, whatever became of its key: the spend of work
 * it started before the revocation is still the key's, and is measured so.
 */
export async function readKeyIdentity(
  db: Db,
  userId: string,
): Promise<ApiKeyOwner | null> {
  const rows = await db<OwnerRow[]>`
    SELECT api_key_id AS "apiKeyId", org_id AS "organizationId",
           owner_kind AS "kind", principal_user_id AS "principalUserId",
           team_id AS "teamId", project_id AS "projectId", role, name,
           created_by AS "createdBy", created_at_ms AS "createdAt",
           revoked_at_ms AS "revokedAt", revoked_by AS "revokedBy"
    FROM app.api_key_owners
    WHERE principal_user_id = ${userId} AND owner_kind <> 'member'
    LIMIT 1
  `;
  const row = rows[0];
  return row === undefined ? null : toOwner(row);
}

/**
 * The live key whose own identity `userId` is — a team's, a project's or
 * the organization's key — or null when `userId` is a person (or the key
 * was revoked).
 */
export async function readServicePrincipal(
  db: Db,
  userId: string,
): Promise<ApiKeyOwner | null> {
  const rows = await db<OwnerRow[]>`
    SELECT api_key_id AS "apiKeyId", org_id AS "organizationId",
           owner_kind AS "kind", principal_user_id AS "principalUserId",
           team_id AS "teamId", project_id AS "projectId", role, name,
           created_by AS "createdBy", created_at_ms AS "createdAt",
           revoked_at_ms AS "revokedAt", revoked_by AS "revokedBy"
    FROM app.api_key_owners
    WHERE principal_user_id = ${userId} AND owner_kind <> 'member'
      AND revoked_at_ms IS NULL
    LIMIT 1
  `;
  const row = rows[0];
  // An unknown kind is no identity this module knows: it acts as nobody.
  return row === undefined ? null : toOwner(row);
}
