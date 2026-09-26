import { transactSerializable } from '@tale/shared/db/serializable';
import type { Sql, TransactionSql } from 'postgres';

import {
  splitEmailForAudit,
  splitIpForAudit,
} from '../../core/lib/helpers/pii_hash.ts';
import { createAuditLog } from './service.ts';
import type { AuditLogCategory } from './types.ts';

/**
 * Audit rows for a USER-scoped security event — a second factor, a passkey,
 * an API key: things a person holds across organizations rather than inside
 * one. The audit log is per organization, so one such event lands as one
 * row in every organization the person belongs to, all in ONE serializable
 * transaction (a person in several organizations gets every row or none).
 * PII is split into plaintext + peppered hash by the shared helpers, like
 * every other security row.
 */

type Db = Sql | TransactionSql;

/** Every organization the user is a member of. */
export async function userOrgIds(db: Db, userId: string): Promise<string[]> {
  const rows = await db<{ organizationId: string }[]>`
    SELECT "organizationId" FROM "member" WHERE "userId" = ${userId}
  `;
  return rows.map((row) => row.organizationId);
}

/** The user's e-mail, for an actor a door knew only by id. */
export async function userEmail(
  db: Db,
  userId: string,
): Promise<string | undefined> {
  const rows = await db<{ email: string | null }[]>`
    SELECT "email" FROM "user" WHERE "id" = ${userId} LIMIT 1
  `;
  return rows[0]?.email ?? undefined;
}

export interface UserScopedSecurityEvent {
  userId: string;
  action: string;
  /** Defaults to `security`. */
  category?: AuditLogCategory;
  resourceType: string;
  resourceId: string;
  resourceName?: string;
  actorEmail?: string;
  ip?: string;
  userAgent?: string;
  previousState?: Record<string, unknown>;
  newState?: Record<string, unknown>;
  changedFields?: string[];
  metadata?: Record<string, unknown>;
}

export async function recordUserScopedSecurityEvent(
  sql: Sql,
  args: UserScopedSecurityEvent,
): Promise<void> {
  const emailParts =
    args.actorEmail !== undefined
      ? await splitEmailForAudit(args.actorEmail)
      : {};
  const ipParts = args.ip !== undefined ? await splitIpForAudit(args.ip) : {};
  await transactSerializable(sql, async (tx) => {
    for (const organizationId of await userOrgIds(tx, args.userId)) {
      await createAuditLog(tx, {
        organizationId,
        actorId: args.userId,
        ...(emailParts.plaintext !== undefined
          ? { actorEmail: emailParts.plaintext }
          : {}),
        ...(emailParts.hash !== undefined
          ? { actorEmailHash: emailParts.hash }
          : {}),
        actorType: 'user',
        action: args.action,
        category: args.category ?? 'security',
        resourceType: args.resourceType,
        resourceId: args.resourceId,
        ...(args.resourceName !== undefined
          ? { resourceName: args.resourceName }
          : {}),
        ...(args.previousState !== undefined
          ? { previousState: args.previousState }
          : {}),
        ...(args.newState !== undefined ? { newState: args.newState } : {}),
        ...(args.changedFields !== undefined
          ? { changedFields: args.changedFields }
          : {}),
        ...(ipParts.plaintext !== undefined
          ? { ipAddress: ipParts.plaintext }
          : {}),
        ...(ipParts.hash !== undefined ? { actorIpHash: ipParts.hash } : {}),
        ...(args.userAgent !== undefined ? { userAgent: args.userAgent } : {}),
        status: 'success',
        ...(args.metadata !== undefined ? { metadata: args.metadata } : {}),
      });
    }
  });
}
