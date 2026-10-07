import { transactSerializable } from '@tale/shared/db/serializable';
import { generateId } from 'better-auth';
import type { Sql, TransactionSql } from 'postgres';

import { API_KEY_HINT_ENTITY } from '../../../lib/shared/hint-entities.ts';
import type { Auth } from '../../auth/auth.ts';
import {
  findOrganizationMember,
  isAdminRole,
  roleRank,
} from '../../auth/membership.ts';
import {
  splitEmailForAudit,
  splitIpForAudit,
} from '../../core/lib/helpers/pii_hash.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { notifyUser } from '../collab/service.ts';
import {
  type ApiKeyOwnerKind,
  isServiceKeyRole,
  readApiKeyOwner,
  SCOPED_SERVICE_KEY_ROLES,
  type ServiceKeyRole,
} from './owners.ts';
import { revokeBoundKeysInTx } from './retire.ts';

/**
 * The app's door for API keys that are not simply their maker's own: a key
 * an Owner or Admin makes for another member, and the keys of a team, a
 * project and the organization. A person's own key is still minted by the
 * api-key plugin's endpoint (`/api/auth/api-key/create`), where its create
 * gate and its trail live; this module lists every key a person may see in
 * one organization and revokes them.
 *
 * Every key made here is bound to ONE organization by its
 * `app.api_key_owners` row (`owners.ts`), written before the secret leaves
 * the server — no request can authenticate with a key whose binding is not
 * written yet, because nobody holds its secret yet. A key that is not a
 * person acts as an identity of its own: a `"user"` row with no `member` or
 * `teamMember` row and an address that names nothing, so no member list,
 * picker, notification, e-mail or identity-provider sync reaches it.
 */

type Db = Sql | TransactionSql;

/** The bell row a member gets when a key is made for them. */
export const API_KEY_CREATED_NOTIFICATION_TYPE = 'api_key_created';

/** The api-key plugin's own name bound (`maximumNameLength`, 32). */
const API_KEY_NAME_MAX = 32;
/** The longest lifetime the plugin accepts (`keyExpiration.maxExpiresIn`). */
const API_KEY_MAX_EXPIRY_DAYS = 365;
const DAY_SECONDS = 86_400;

export class ApiKeyError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409;

  constructor(code: string, message: string, status: 400 | 403 | 404 | 409) {
    super(message);
    this.name = 'ApiKeyError';
    this.code = code;
    this.status = status;
  }
}

/** Whose key a new one is. */
export type ApiKeyOwnerInput =
  | { kind: 'member'; userId: string }
  | { kind: 'team'; teamId: string; role: ServiceKeyRole }
  | { kind: 'project'; projectId: string; role: ServiceKeyRole }
  | { kind: 'organization'; role: ServiceKeyRole };

/** The signed-in Owner or Admin acting here. */
export interface ApiKeyActor {
  userId: string;
  email?: string;
  name?: string;
  role: string;
  ip?: string;
  userAgent?: string;
}

/** The address of a key's own identity: one that names nothing, so no
 * password reset, invitation or notification e-mail can reach it. */
export function servicePrincipalEmail(userId: string): string {
  return `${userId.toLowerCase()}@api-keys.invalid`;
}

/** The plugin's create response, as far as this module reads it. */
interface MintedKey {
  id: string;
  key: string;
  start: string | null;
  expiresAt: Date | string | null;
}

function epochMs(value: Date | string | number | null): number | null {
  if (value === null) return null;
  if (value instanceof Date) return value.getTime();
  const ms = typeof value === 'number' ? value : Date.parse(value);
  return Number.isNaN(ms) ? null : ms;
}

/** The plugin's own window: whole days, from one to a year. */
function assertExpiresIn(expiresIn: number | undefined): void {
  if (expiresIn === undefined) return;
  const days = expiresIn / DAY_SECONDS;
  if (
    !Number.isInteger(expiresIn) ||
    days < 1 ||
    days > API_KEY_MAX_EXPIRY_DAYS
  ) {
    throw new ApiKeyError(
      'API_KEY_EXPIRY_INVALID',
      `A key expires between one day and ${API_KEY_MAX_EXPIRY_DAYS} days after it is made.`,
      400,
    );
  }
}

/** What the new key will be bound to, checked against this organization. */
interface ResolvedOwner {
  kind: ApiKeyOwnerKind;
  /** The member a member's key acts as; absent for a key of its own. */
  memberUserId?: string;
  memberName?: string;
  teamId?: string;
  projectId?: string;
  role: ServiceKeyRole | null;
}

async function resolveOwner(
  db: Db,
  organizationId: string,
  actor: ApiKeyActor,
  owner: ApiKeyOwnerInput,
): Promise<ResolvedOwner> {
  if (owner.kind === 'member') {
    if (owner.userId === actor.userId) {
      throw new ApiKeyError(
        'API_KEY_MEMBER_SELF',
        'Your own key is made as a personal key, not as a key for a member.',
        400,
      );
    }
    const member = await findOrganizationMember(
      db,
      organizationId,
      owner.userId,
    );
    if (member === null || member.role === 'disabled') {
      throw new ApiKeyError(
        'API_KEY_MEMBER_NOT_FOUND',
        'That person is not an active member of this organization.',
        404,
      );
    }
    // A key acts as the member: making one is acting as them, which takes
    // more authority than they hold here — an admin cannot mint a key
    // for a peer admin or the owner.
    if (roleRank(actor.role) <= roleRank(member.role)) {
      throw new ApiKeyError(
        'API_KEY_MEMBER_FORBIDDEN',
        'You can make a key only for a member whose role is below yours.',
        403,
      );
    }
    const users = await db<{ name: string | null; email: string | null }[]>`
      SELECT "name", "email" FROM "user" WHERE "id" = ${owner.userId} LIMIT 1
    `;
    return {
      kind: 'member',
      memberUserId: owner.userId,
      memberName: users[0]?.name ?? users[0]?.email ?? owner.userId,
      role: null,
    };
  }

  const scoped = owner.kind === 'team' || owner.kind === 'project';
  if (
    (scoped && !SCOPED_SERVICE_KEY_ROLES.includes(owner.role)) ||
    roleRank(owner.role) > roleRank(actor.role)
  ) {
    throw new ApiKeyError(
      'API_KEY_ROLE_FORBIDDEN',
      scoped
        ? 'A team or project key acts as a Member, Editor or Developer.'
        : 'A key cannot act with a role above your own.',
      400,
    );
  }
  if (owner.kind === 'team') {
    const teams = await db<{ id: string }[]>`
      SELECT "id" FROM "team"
      WHERE "id" = ${owner.teamId} AND "organizationId" = ${organizationId}
      LIMIT 1
    `;
    if (teams.length === 0) {
      throw new ApiKeyError(
        'API_KEY_TEAM_NOT_FOUND',
        'That team does not exist in this organization.',
        404,
      );
    }
    return { kind: 'team', teamId: owner.teamId, role: owner.role };
  }
  if (owner.kind === 'project') {
    const projects = await db<{ archivedAt: string | null }[]>`
      SELECT archived_at_ms AS "archivedAt" FROM app.projects
      WHERE id = ${owner.projectId} AND org_id = ${organizationId}
      LIMIT 1
    `;
    const project = projects[0];
    if (project === undefined) {
      throw new ApiKeyError(
        'API_KEY_PROJECT_NOT_FOUND',
        'That project does not exist in this organization.',
        404,
      );
    }
    if (project.archivedAt !== null) {
      throw new ApiKeyError(
        'API_KEY_PROJECT_ARCHIVED',
        'An archived project takes no new keys.',
        409,
      );
    }
    return { kind: 'project', projectId: owner.projectId, role: owner.role };
  }
  return { kind: 'organization', role: owner.role };
}

/** The maker's live role, read where the binding is written: one demoted
 * while the key was minted makes none. */
async function liveMakerRole(
  db: Db,
  organizationId: string,
  userId: string,
): Promise<string> {
  const maker = await findOrganizationMember(db, organizationId, userId);
  if (maker === null || !isAdminRole(maker.role)) {
    throw new ApiKeyError(
      'API_KEY_OWNER_FORBIDDEN',
      'Only Owners and Admins make keys for a member, a team, a project or the organization.',
      403,
    );
  }
  return maker.role;
}

export interface CreatedOwnedApiKey {
  id: string;
  /** The secret, shown once. */
  key: string;
  name: string;
  expiresAt: number | null;
  owner: ResolvedOwner;
}

/**
 * Make a key for another member, a team, a project or the organization —
 * an Owner's or Admin's act, bound to this organization.
 *
 * The secret is minted by the api-key plugin as a server call (no session,
 * so the plugin's own create gate and its holder-wide trail stay out of
 * it), the binding, the audit row and the hint are written in one
 * transaction, and only then does the secret leave. A failure after the
 * mint removes the key, and the identity made for it, again.
 */
export async function createOwnedApiKey(
  deps: { sql: Sql; auth: Auth },
  args: {
    organizationId: string;
    actor: ApiKeyActor;
    name: string;
    expiresIn?: number;
    owner: ApiKeyOwnerInput;
  },
): Promise<CreatedOwnedApiKey> {
  const { sql, auth } = deps;
  if (!isAdminRole(args.actor.role)) {
    throw new ApiKeyError(
      'API_KEY_OWNER_FORBIDDEN',
      'Only Owners and Admins make keys for a member, a team, a project or the organization.',
      403,
    );
  }
  const name = args.name.trim();
  if (name.length === 0 || name.length > API_KEY_NAME_MAX) {
    throw new ApiKeyError(
      'API_KEY_NAME_INVALID',
      `A key name has 1 to ${API_KEY_NAME_MAX} characters.`,
      400,
    );
  }
  assertExpiresIn(args.expiresIn);
  const owner = await resolveOwner(
    sql,
    args.organizationId,
    args.actor,
    args.owner,
  );

  // The identity the key authenticates as — one of its own for every kind,
  // a member's key included: only the binding says whom it acts as, so an
  // image that does not read the binding refuses the key instead of reading
  // it as the member's own. Inserted directly: the user-create hooks
  // (first-run setup, verification mail) are a person's.
  const keyUserId = generateId(32);
  const principalUserId = owner.memberUserId ?? keyUserId;
  await sql`
    INSERT INTO "user" ("id", "name", "email", "emailVerified")
    VALUES (${keyUserId}, ${name}, ${servicePrincipalEmail(keyUserId)}, false)
  `;
  const dropIdentity = async (): Promise<void> => {
    try {
      await sql`DELETE FROM "user" WHERE "id" = ${keyUserId}`;
    } catch (error) {
      console.error(
        '[api-keys] failed to remove the identity of a key that was not made',
        error instanceof Error ? error.message : error,
      );
    }
  };

  let minted: MintedKey;
  try {
    // A server call: no headers, so the key is the named user's.
    const result: unknown = await auth.api.createApiKey({
      body: {
        name,
        userId: keyUserId,
        ...(args.expiresIn !== undefined ? { expiresIn: args.expiresIn } : {}),
      },
    });
    minted = readMintedKey(result);
  } catch (error) {
    await dropIdentity();
    throw error;
  }

  const now = Date.now();
  const expiresAt = epochMs(minted.expiresAt);
  const suffix = minted.key.length > 4 ? minted.key.slice(-4) : null;
  try {
    const emailParts =
      args.actor.email !== undefined
        ? await splitEmailForAudit(args.actor.email)
        : {};
    const ipParts =
      args.actor.ip !== undefined ? await splitIpForAudit(args.actor.ip) : {};
    await transactSerializable(sql, async (tx) => {
      // What the key is bound to is checked again in the transaction that
      // binds it: a member removed, a team or project deleted, or the maker
      // demoted while the key was minted refuses it, and the catch below
      // removes the key again.
      const makerRole = await liveMakerRole(
        tx,
        args.organizationId,
        args.actor.userId,
      );
      await resolveOwner(
        tx,
        args.organizationId,
        { ...args.actor, role: makerRole },
        args.owner,
      );
      await tx`
        INSERT INTO app.api_key_owners (
          api_key_id, org_id, owner_kind, key_user_id, principal_user_id,
          team_id, project_id, role, name, created_by, created_at_ms
        ) VALUES (
          ${minted.id}, ${args.organizationId}, ${owner.kind}, ${keyUserId},
          ${principalUserId}, ${owner.teamId ?? null},
          ${owner.projectId ?? null}, ${owner.role}, ${name},
          ${args.actor.userId}, ${now}
        )
      `;
      // The after-hook writes it too; a key made here never depends on that.
      if (suffix !== null) {
        await tx`UPDATE "apikey" SET "suffix" = ${suffix} WHERE "id" = ${minted.id}`;
      }
      await createAuditLog(tx, {
        organizationId: args.organizationId,
        actorId: args.actor.userId,
        ...(emailParts.plaintext !== undefined
          ? { actorEmail: emailParts.plaintext }
          : {}),
        ...(emailParts.hash !== undefined
          ? { actorEmailHash: emailParts.hash }
          : {}),
        actorRole: args.actor.role,
        actorType: 'user',
        action: 'api_key.created',
        category: 'security',
        resourceType: 'api_key',
        resourceId: minted.id,
        resourceName: name,
        newState: {
          name,
          start: minted.start,
          suffix,
          expiresAt,
          owner: owner.kind,
          ...(owner.memberUserId !== undefined
            ? { userId: owner.memberUserId }
            : {}),
          ...(owner.teamId !== undefined ? { teamId: owner.teamId } : {}),
          ...(owner.projectId !== undefined
            ? { projectId: owner.projectId }
            : {}),
          ...(owner.role !== null ? { role: owner.role } : {}),
        },
        ...(ipParts.plaintext !== undefined
          ? { ipAddress: ipParts.plaintext }
          : {}),
        ...(ipParts.hash !== undefined ? { actorIpHash: ipParts.hash } : {}),
        ...(args.actor.userAgent !== undefined
          ? { userAgent: args.actor.userAgent }
          : {}),
        status: 'success',
      });
      await emitHintInTx(tx, {
        orgId: args.organizationId,
        entity: API_KEY_HINT_ENTITY,
        entityId: minted.id,
      });
    });
  } catch (error) {
    try {
      await sql`DELETE FROM "apikey" WHERE "id" = ${minted.id}`;
    } catch (cleanup) {
      console.error(
        '[api-keys] failed to remove a key whose binding was not written',
        cleanup instanceof Error ? cleanup.message : cleanup,
      );
    }
    await dropIdentity();
    throw error;
  }

  // The member hears of a credential in their name, and where to end it.
  // The key exists either way: a notice that cannot be written is logged.
  if (owner.memberUserId !== undefined) {
    try {
      await notifyUser(sql, {
        organizationId: args.organizationId,
        userId: owner.memberUserId,
        type: API_KEY_CREATED_NOTIFICATION_TYPE,
        titleKey: 'apiKeyCreatedForYou',
        bodyKey: 'apiKeyCreatedForYouBody',
        params: {
          name: args.actor.name || args.actor.email || args.actor.userId,
          keyName: name,
          apiKeys: true,
        },
        resourceType: 'api_key',
        resourceId: minted.id,
        actorType: 'user',
        actorId: args.actor.userId,
      });
    } catch (error) {
      console.error(
        '[api-keys] failed to notify the member a key was made for',
        error instanceof Error ? error.message : error,
      );
    }
  }

  return { id: minted.id, key: minted.key, name, expiresAt, owner };
}

function readMintedKey(result: unknown): MintedKey {
  if (typeof result !== 'object' || result === null) {
    throw new Error('API key creation returned no key');
  }
  const id: unknown = Reflect.get(result, 'id');
  const key: unknown = Reflect.get(result, 'key');
  const start: unknown = Reflect.get(result, 'start');
  const expiresAt: unknown = Reflect.get(result, 'expiresAt');
  if (typeof id !== 'string' || typeof key !== 'string') {
    throw new Error('API key creation returned no key');
  }
  return {
    id,
    key,
    start: typeof start === 'string' ? start : null,
    expiresAt:
      expiresAt instanceof Date || typeof expiresAt === 'string'
        ? expiresAt
        : null,
  };
}

/** Whose a listed key is, as the keys table names it. */
export type ListedApiKeyOwner =
  | { kind: 'user' }
  | {
      kind: 'member';
      userId: string;
      name: string | null;
      email: string | null;
    }
  | { kind: 'team'; teamId: string; teamName: string | null }
  | { kind: 'project'; projectId: string; projectName: string | null }
  | { kind: 'organization' };

export interface ListedApiKey {
  id: string;
  name: string | null;
  start: string | null;
  prefix: string | null;
  suffix: string | null;
  enabled: boolean | null;
  expiresAt: number | null;
  createdAt: number;
  lastRequest: number | null;
  owner: ListedApiKeyOwner;
  /** The role a team, project or organization key acts with. */
  role: ServiceKeyRole | null;
  /** Who made a key bound to this organization; null for a person's own. */
  createdBy: { userId: string; name: string | null } | null;
  canRevoke: boolean;
}

interface ListedRow {
  id: string;
  name: string | null;
  start: string | null;
  prefix: string | null;
  suffix: string | null;
  enabled: boolean | null;
  expiresAt: Date | null;
  createdAt: Date;
  lastRequest: Date | null;
  ownerKind: string | null;
  principalUserId: string | null;
  teamId: string | null;
  projectId: string | null;
  role: string | null;
  createdBy: string | null;
  memberName: string | null;
  memberEmail: string | null;
  teamName: string | null;
  projectName: string | null;
  createdByName: string | null;
}

/** A generous bound: the keys table pages on the client. */
const LISTED_KEY_LIMIT = 1000;

/**
 * The keys a person sees on the organization's API settings: their own
 * keys (which work in every organization they belong to), the keys made for
 * them in this organization, and — for an Owner or Admin — every key bound
 * to this organization: the members', the teams', the projects' and the
 * organization's own.
 */
export async function listApiKeysForViewer(
  db: Db,
  viewer: { organizationId: string; userId: string; role: string },
): Promise<ListedApiKey[]> {
  const admin = isAdminRole(viewer.role);
  const rows = await db<ListedRow[]>`
    SELECT k."id", k."name", k."start", k."prefix", k."suffix", k."enabled",
           k."expiresAt", k."createdAt", k."lastRequest",
           o.owner_kind AS "ownerKind",
           o.principal_user_id AS "principalUserId",
           o.team_id AS "teamId", o.project_id AS "projectId", o.role,
           o.created_by AS "createdBy",
           mu."name" AS "memberName", mu."email" AS "memberEmail",
           t."name" AS "teamName", p.name AS "projectName",
           cu."name" AS "createdByName"
    FROM "apikey" k
    LEFT JOIN app.api_key_owners o ON o.api_key_id = k."id"
    LEFT JOIN "user" mu
      ON o.owner_kind = 'member' AND mu."id" = o.principal_user_id
    LEFT JOIN "team" t ON t."id" = o.team_id
    LEFT JOIN app.projects p ON p.id = o.project_id
    LEFT JOIN "user" cu ON cu."id" = o.created_by
    WHERE (o.api_key_id IS NULL AND k."referenceId" = ${viewer.userId})
       OR (o.org_id = ${viewer.organizationId} AND o.revoked_at_ms IS NULL
           AND (${admin}::boolean
                OR (o.owner_kind = 'member'
                    AND o.principal_user_id = ${viewer.userId})))
    ORDER BY k."createdAt" ASC, k."id" ASC
    LIMIT ${LISTED_KEY_LIMIT}
  `;
  if (rows.length >= LISTED_KEY_LIMIT) {
    console.warn(
      `[api-keys] the key list of organization ${viewer.organizationId} reached ${LISTED_KEY_LIMIT} rows; later keys are not shown`,
    );
  }
  return rows.map((row) => {
    const owner = listedOwner(row);
    return {
      id: row.id,
      name: row.name,
      start: row.start,
      prefix: row.prefix,
      suffix: row.suffix,
      enabled: row.enabled,
      expiresAt: row.expiresAt === null ? null : row.expiresAt.getTime(),
      createdAt: row.createdAt.getTime(),
      lastRequest: row.lastRequest === null ? null : row.lastRequest.getTime(),
      owner,
      role: row.role !== null && isServiceKeyRole(row.role) ? row.role : null,
      createdBy:
        row.createdBy === null
          ? null
          : { userId: row.createdBy, name: row.createdByName },
      // Every key listed here is one the viewer may end: their own, one made
      // for them, or — as an Owner or Admin — one bound to this organization.
      canRevoke: true,
    };
  });
}

function listedOwner(row: ListedRow): ListedApiKeyOwner {
  switch (row.ownerKind) {
    case null:
      return { kind: 'user' };
    case 'member':
      return {
        kind: 'member',
        userId: row.principalUserId ?? '',
        name: row.memberName,
        email: row.memberEmail,
      };
    case 'team':
      return { kind: 'team', teamId: row.teamId ?? '', teamName: row.teamName };
    case 'project':
      return {
        kind: 'project',
        projectId: row.projectId ?? '',
        projectName: row.projectName,
      };
    default:
      return { kind: 'organization' };
  }
}

/**
 * End a key bound to this organization that the viewer may end: one made
 * for them, or — for an Owner or Admin — any bound key. Its secret is
 * deleted and its binding stamped revoked, with one audit row and a hint in
 * this organization. A person's own key is ended through the api-key
 * plugin's own door, whose trail lands in every organization the key works
 * in; here it, a key bound elsewhere and a key the viewer may not end are
 * all not found.
 */
export async function revokeBoundApiKey(
  deps: { sql: Sql },
  args: {
    organizationId: string;
    actor: ApiKeyActor;
    keyId: string;
  },
): Promise<void> {
  const { sql } = deps;
  const owner = await readApiKeyOwner(sql, args.keyId);
  if (owner === null) {
    throw new ApiKeyError('API_KEY_NOT_FOUND', 'API key not found.', 404);
  }
  const mayRevoke =
    owner.organizationId === args.organizationId &&
    owner.revokedAt === null &&
    (isAdminRole(args.actor.role) ||
      (owner.kind === 'member' && owner.principalUserId === args.actor.userId));
  if (!mayRevoke) {
    throw new ApiKeyError('API_KEY_NOT_FOUND', 'API key not found.', 404);
  }
  const emailParts =
    args.actor.email !== undefined
      ? await splitEmailForAudit(args.actor.email)
      : {};
  const ipParts =
    args.actor.ip !== undefined ? await splitIpForAudit(args.actor.ip) : {};
  await transactSerializable(sql, async (tx) => {
    const revoked = await revokeBoundKeysInTx(tx, {
      organizationId: args.organizationId,
      keyIds: [owner.apiKeyId],
      revokedBy: args.actor.userId,
    });
    for (const key of revoked) {
      await createAuditLog(tx, {
        organizationId: args.organizationId,
        actorId: args.actor.userId,
        ...(emailParts.plaintext !== undefined
          ? { actorEmail: emailParts.plaintext }
          : {}),
        ...(emailParts.hash !== undefined
          ? { actorEmailHash: emailParts.hash }
          : {}),
        actorRole: args.actor.role,
        actorType: 'user',
        action: 'api_key.revoked',
        category: 'security',
        resourceType: 'api_key',
        resourceId: key.apiKeyId,
        resourceName: key.name,
        previousState: { owner: key.kind },
        ...(ipParts.plaintext !== undefined
          ? { ipAddress: ipParts.plaintext }
          : {}),
        ...(ipParts.hash !== undefined ? { actorIpHash: ipParts.hash } : {}),
        ...(args.actor.userAgent !== undefined
          ? { userAgent: args.actor.userAgent }
          : {}),
        status: 'success',
      });
    }
  });
}
