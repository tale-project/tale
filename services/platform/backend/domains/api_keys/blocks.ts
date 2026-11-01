import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql, TransactionSql } from 'postgres';

import { API_KEY_HINT_ENTITY } from '../../../lib/shared/hint-entities.ts';
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
  type PersonalKeysStanding,
  personalKeysStandingOf,
} from './personal-keys.ts';
import { type ApiKeyActor, ApiKeyError } from './service.ts';

/**
 * An organization's blocks on its members' own API keys (APIKEY-R11).
 *
 * A person's own key (one with no `app.api_key_owners` row) works in every
 * organization they belong to. An Owner or Admin may block it in theirs:
 * the REST door then refuses the key's requests against this organization
 * (`API_KEY_BLOCKED`, `rest/v1.ts`), while it keeps working in the holder's
 * other organizations and the holder keeps it. An Admin cannot block or free
 * an Owner's key; an Owner can anyone's. Each block and each lift is one
 * audit row naming who did it and the key by its masked ends, and the holder
 * is told in the bell.
 */

type Db = Sql | TransactionSql;

/** The bell rows a holder gets when one of their keys is blocked or freed. */
export const API_KEY_BLOCKED_NOTIFICATION_TYPE = 'api_key_blocked';
export const API_KEY_UNBLOCKED_NOTIFICATION_TYPE = 'api_key_unblocked';

/** A member's own key, as an Owner or Admin sees it on the member's row. */
export interface MemberPersonalApiKey {
  id: string;
  name: string | null;
  start: string | null;
  prefix: string | null;
  suffix: string | null;
  enabled: boolean | null;
  expiresAt: number | null;
  createdAt: number;
  /** When and by whom this organization blocked it; null while it works. */
  blocked: { at: number; by: { userId: string; name: string | null } } | null;
}

export interface MemberPersonalApiKeys {
  keys: MemberPersonalApiKey[];
  /** Whether the viewer may block and free these keys. */
  canBlock: boolean;
  /**
   * Whether this organization lets members' own keys in at all
   * (APIKEY-R12): while `refused` none of these keys works here, blocked or
   * not; while `unavailable` the setting cannot be read and the door keeps
   * them out until it can, so nobody can say whether one would work.
   */
  personalKeys: PersonalKeysStanding;
}

interface PersonalKeyRow {
  id: string;
  name: string | null;
  start: string | null;
  prefix: string | null;
  suffix: string | null;
  enabled: boolean | null;
  expiresAt: Date | null;
  createdAt: Date;
  blockedAtMs: string | number | null;
  blockedBy: string | null;
  blockedByName: string | null;
}

/** A generous bound: nobody holds this many keys of their own. */
const LISTED_KEY_LIMIT = 200;

const forbidden = (message: string) =>
  new ApiKeyError('API_KEY_BLOCK_FORBIDDEN', message, 403);
const notFound = () =>
  new ApiKeyError('API_KEY_NOT_FOUND', 'API key not found.', 404);

/**
 * Whether the viewer may block the keys of this holder here: an Owner or
 * Admin, on someone else's keys, never on those of a role above their own.
 */
function blockDenial(
  actor: Pick<ApiKeyActor, 'userId' | 'role'>,
  holder: { userId: string; role: string },
): string | null {
  if (!isAdminRole(actor.role)) {
    return "Only an Owner or Admin can block a member's API keys.";
  }
  if (holder.userId === actor.userId) {
    return 'Your own API keys are ended in your own key settings, not blocked.';
  }
  if (roleRank(holder.role) > roleRank(actor.role)) {
    return "An Admin cannot block or free an Owner's API keys.";
  }
  return null;
}

/**
 * A member's own keys, for an Owner or Admin of this organization: the
 * keys still valid (turned on and not expired), each with this
 * organization's block on it, and whether this organization lets members'
 * own keys in at all, without which no unblocked key works here either.
 * A key bound to an organization is not
 * listed: it is ended, not blocked. Nor is a key's last use: it counts
 * every organization the key works in, and would tell the admins about the
 * holder's work in the others.
 */
export async function listMemberPersonalApiKeys(
  db: Db,
  args: {
    organizationId: string;
    actor: Pick<ApiKeyActor, 'userId' | 'role'>;
    memberUserId: string;
  },
): Promise<MemberPersonalApiKeys> {
  if (!isAdminRole(args.actor.role)) {
    throw forbidden("Only an Owner or Admin can see a member's API keys.");
  }
  const holder = await findOrganizationMember(
    db,
    args.organizationId,
    args.memberUserId,
  );
  if (holder === null) {
    throw new ApiKeyError(
      'API_KEY_MEMBER_NOT_FOUND',
      'Not a member of this organization.',
      404,
    );
  }
  const rows = await db<PersonalKeyRow[]>`
    SELECT k."id", k."name", k."start", k."prefix", k."suffix", k."enabled",
           k."expiresAt", k."createdAt",
           b.blocked_at_ms AS "blockedAtMs", b.blocked_by AS "blockedBy",
           bu."name" AS "blockedByName"
    FROM "apikey" k
    LEFT JOIN app.api_key_owners o ON o.api_key_id = k."id"
    LEFT JOIN app.api_key_org_blocks b
      ON b.org_id = ${args.organizationId} AND b.api_key_id = k."id"
    LEFT JOIN "user" bu ON bu."id" = b.blocked_by
    WHERE k."referenceId" = ${args.memberUserId} AND o.api_key_id IS NULL
      AND k."enabled" IS NOT FALSE
      AND (k."expiresAt" IS NULL OR k."expiresAt" > now())
    ORDER BY k."createdAt" ASC, k."id" ASC
    LIMIT ${LISTED_KEY_LIMIT}
  `;
  return {
    keys: rows.map((row) => ({
      id: row.id,
      name: row.name,
      start: row.start,
      prefix: row.prefix,
      suffix: row.suffix,
      enabled: row.enabled,
      expiresAt: row.expiresAt === null ? null : row.expiresAt.getTime(),
      createdAt: row.createdAt.getTime(),
      blocked:
        row.blockedAtMs === null || row.blockedBy === null
          ? null
          : {
              at: Number(row.blockedAtMs),
              by: { userId: row.blockedBy, name: row.blockedByName },
            },
    })),
    canBlock:
      blockDenial(args.actor, {
        userId: args.memberUserId,
        role: holder.role,
      }) === null,
    personalKeys: await personalKeysStandingOf(db, args.organizationId),
  };
}

interface PersonalKey {
  id: string;
  name: string | null;
  start: string | null;
  suffix: string | null;
  holderUserId: string;
}

/** A member's own key that this viewer may block or free here. */
async function readBlockableKey(
  db: Db,
  args: { organizationId: string; actor: ApiKeyActor; keyId: string },
): Promise<PersonalKey> {
  if (!isAdminRole(args.actor.role)) {
    throw forbidden("Only an Owner or Admin can block a member's API keys.");
  }
  const rows = await db<PersonalKey[]>`
    SELECT k."id", k."name", k."start", k."suffix",
           k."referenceId" AS "holderUserId"
    FROM "apikey" k
    LEFT JOIN app.api_key_owners o ON o.api_key_id = k."id"
    WHERE k."id" = ${args.keyId} AND o.api_key_id IS NULL
    LIMIT 1
  `;
  const key = rows[0];
  // An Owner or Admin learns nothing of a key that is not a member's own
  // key here: one bound to an organization is ended, not blocked, and one
  // whose holder is not a member here is not this organization's to block.
  if (key === undefined) throw notFound();
  const holder = await findOrganizationMember(
    db,
    args.organizationId,
    key.holderUserId,
  );
  if (holder === null) throw notFound();
  const denial = blockDenial(args.actor, {
    userId: key.holderUserId,
    role: holder.role,
  });
  if (denial !== null) throw forbidden(denial);
  return key;
}

/**
 * Block or free a member's own key in this organization. Repeating either
 * changes nothing and writes nothing: the audit log holds one row per
 * change, and the holder hears of each change once.
 */
export async function setPersonalApiKeyBlock(
  deps: { sql: Sql },
  args: {
    organizationId: string;
    actor: ApiKeyActor;
    keyId: string;
    blocked: boolean;
  },
): Promise<{ changed: boolean }> {
  const { sql } = deps;
  const emailParts =
    args.actor.email !== undefined
      ? await splitEmailForAudit(args.actor.email)
      : {};
  const ipParts =
    args.actor.ip !== undefined ? await splitIpForAudit(args.actor.ip) : {};
  // The key and its holder's role are read in the serializable transaction
  // that writes the block, so the decision and the write act as one: a
  // promotion to Owner lands either before it, and the block is refused, or
  // after it, as if the member were promoted once blocked.
  const outcome = await transactSerializable(sql, async (tx) => {
    const key = await readBlockableKey(tx, args);
    const maskedKey = {
      name: key.name,
      start: key.start,
      suffix: key.suffix,
      holderUserId: key.holderUserId,
    };
    const rows = args.blocked
      ? await tx`
          INSERT INTO app.api_key_org_blocks
            (org_id, api_key_id, holder_user_id, blocked_by, blocked_at_ms)
          VALUES (${args.organizationId}, ${key.id}, ${key.holderUserId},
                  ${args.actor.userId}, ${Date.now()})
          ON CONFLICT (org_id, api_key_id) DO NOTHING
          RETURNING api_key_id
        `
      : await tx`
          DELETE FROM app.api_key_org_blocks
          WHERE org_id = ${args.organizationId} AND api_key_id = ${key.id}
          RETURNING api_key_id
        `;
    if (rows.length === 0) return { changed: false, key };
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
      action: args.blocked ? 'api_key.blocked' : 'api_key.unblocked',
      category: 'security',
      resourceType: 'api_key',
      resourceId: key.id,
      ...(key.name !== null ? { resourceName: key.name } : {}),
      // The key by its masked ends, never its secret.
      ...(args.blocked
        ? { newState: { ...maskedKey, blocked: true } }
        : { previousState: { ...maskedKey, blocked: true } }),
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
      entityId: key.id,
    });
    return { changed: true, key };
  });
  if (!outcome.changed) return { changed: false };

  // The holder hears that their key stopped, or works again, here. The
  // block holds either way: a notice that cannot be written is logged.
  try {
    await notifyUser(sql, {
      organizationId: args.organizationId,
      userId: outcome.key.holderUserId,
      type: args.blocked
        ? API_KEY_BLOCKED_NOTIFICATION_TYPE
        : API_KEY_UNBLOCKED_NOTIFICATION_TYPE,
      titleKey: args.blocked ? 'apiKeyBlockedForYou' : 'apiKeyUnblockedForYou',
      bodyKey: args.blocked
        ? 'apiKeyBlockedForYouBody'
        : 'apiKeyUnblockedForYouBody',
      params: {
        name: args.actor.name || args.actor.email || args.actor.userId,
        keyName: outcome.key.name ?? outcome.key.start ?? outcome.key.id,
        apiKeys: true,
      },
      resourceType: 'api_key',
      resourceId: outcome.key.id,
      actorType: 'user',
      actorId: args.actor.userId,
    });
  } catch (error) {
    console.error(
      '[api-keys] failed to notify the holder of a block change',
      error instanceof Error ? error.message : error,
    );
  }
  return { changed: true };
}
