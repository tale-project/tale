import type { TransactionSql } from 'postgres';

import { API_KEY_HINT_ENTITY } from '../../../lib/shared/hint-entities.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';

/**
 * Ending keys bound to one organization (`owners.ts`): the stamp, the
 * deleted secret and the hint every revocation shares, and the retirements
 * the platform runs when what a key belonged to goes — a team, a project, a
 * member's seat, the organization itself. Its own module so the membership
 * cascade (`auth/membership.ts`) can call it without a cycle through the
 * key door, which reads memberships.
 */

/** A key {@link revokeBoundKeysInTx} ended, as its audit row names it. */
interface RevokedKey {
  apiKeyId: string;
  kind: string;
  name: string;
}

/** Stamp bound keys revoked and delete their secrets, with one hint each.
 * The caller writes the audit rows that say why. */
export async function revokeBoundKeysInTx(
  tx: TransactionSql,
  args: { organizationId: string; keyIds: string[]; revokedBy: string },
): Promise<RevokedKey[]> {
  if (args.keyIds.length === 0) return [];
  const rows = await tx<RevokedKey[]>`
    UPDATE app.api_key_owners
    SET revoked_at_ms = ${Date.now()}, revoked_by = ${args.revokedBy}
    WHERE org_id = ${args.organizationId}
      AND api_key_id = ANY(${args.keyIds})
      AND revoked_at_ms IS NULL
    RETURNING api_key_id AS "apiKeyId", owner_kind AS "kind", name
  `;
  const ids = rows.map((row) => row.apiKeyId);
  if (ids.length > 0) {
    await tx`DELETE FROM "apikey" WHERE "id" = ANY(${ids})`;
  }
  for (const id of ids) {
    await emitHintInTx(tx, {
      orgId: args.organizationId,
      entity: API_KEY_HINT_ENTITY,
      entityId: id,
    });
  }
  return rows;
}

/** Why the platform ended a key nobody revoked by hand. */
export type ApiKeyRetirementReason =
  | 'team_deleted'
  | 'project_deleted'
  | 'member_removed';

/**
 * End the keys that lost what they belonged to, inside the caller's own
 * transaction: a deleted team's keys, a deleted project's keys, or the keys
 * made for a member who left the organization. Each gets an
 * `api_key.revoked` audit row from the system, saying why. A person's own
 * keys are theirs and stay — they simply stop working here.
 */
export async function retireApiKeysInTx(
  tx: TransactionSql,
  args: {
    organizationId: string;
    reason: ApiKeyRetirementReason;
    teamId?: string;
    projectId?: string;
    memberUserId?: string;
  },
): Promise<string[]> {
  const targets = await tx<{ apiKeyId: string }[]>`
    SELECT api_key_id AS "apiKeyId" FROM app.api_key_owners
    WHERE org_id = ${args.organizationId} AND revoked_at_ms IS NULL
      AND (
        (owner_kind = 'team' AND team_id = ${args.teamId ?? null})
        OR (owner_kind = 'project' AND project_id = ${args.projectId ?? null})
        OR (owner_kind = 'member'
            AND principal_user_id = ${args.memberUserId ?? null})
      )
  `;
  const revoked = await revokeBoundKeysInTx(tx, {
    organizationId: args.organizationId,
    keyIds: targets.map((row) => row.apiKeyId),
    revokedBy: 'system',
  });
  for (const key of revoked) {
    await createAuditLog(tx, {
      organizationId: args.organizationId,
      actorId: 'system',
      actorType: 'system',
      action: 'api_key.revoked',
      category: 'security',
      resourceType: 'api_key',
      resourceId: key.apiKeyId,
      resourceName: key.name,
      previousState: { owner: key.kind },
      metadata: { reason: args.reason },
      status: 'success',
    });
  }
  return revoked.map((key) => key.apiKeyId);
}

/**
 * Remove every key bound to an organization that is being deleted, with
 * the identities its team, project and organization keys acted as — inside
 * the deletion's own transaction. Members' own keys are theirs and stay.
 */
export async function deleteOrganizationApiKeysInTx(
  tx: TransactionSql,
  organizationId: string,
): Promise<void> {
  const rows = await tx<
    { apiKeyId: string; principalUserId: string; kind: string }[]
  >`
    DELETE FROM app.api_key_owners WHERE org_id = ${organizationId}
    RETURNING api_key_id AS "apiKeyId", principal_user_id AS "principalUserId",
              owner_kind AS "kind"
  `;
  const keyIds = rows.map((row) => row.apiKeyId);
  if (keyIds.length > 0) {
    await tx`DELETE FROM "apikey" WHERE "id" = ANY(${keyIds})`;
  }
  const identities = rows
    .filter((row) => row.kind !== 'member')
    .map((row) => row.principalUserId);
  if (identities.length > 0) {
    await tx`DELETE FROM "user" WHERE "id" = ANY(${identities})`;
  }
}
