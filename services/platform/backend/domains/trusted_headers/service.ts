import type { Sql } from 'postgres';

import {
  TRUSTED_HEADER_KEYS_PER_ORG_MAX,
  trustedHeaderAssertableRoleSchema,
  type TrustedHeaderAssertableRole,
  type TrustedHeaderKeyCreated,
  type TrustedHeaderKeyCreateInput,
  type TrustedHeaderKeyView,
  type TrustedHeaderSettingsInput,
  type TrustedHeadersView,
} from '../../../lib/shared/schemas/trusted_headers.ts';
import {
  generateOpaqueToken,
  hashOpaqueToken,
  opaqueTokenPrefix,
} from '../../core/lib/opaque_token.ts';
import { trustedHeaderNames } from '../../core/trusted_headers_auth/header_names.ts';
import { createAuditLog } from '../audit_logs/service.ts';

/**
 * Trusted headers, organization mode — the settings and the keys behind the
 * hand-off door (`domains/sso/trusted-headers.ts`).
 *
 * The credential is the organization's: a key is minted here, answered in
 * plaintext exactly once, and only its SHA-256 hash persists
 * (`app.trusted_header_keys`). The door resolves the ORGANIZATION from the
 * presented key — the SCIM token's posture — so a proxy can sign users into
 * the organization that issued its key and no other. The organization's
 * switch and role ceiling (`app.trusted_header_settings`) govern every key
 * it holds; revoking a key is a stamp, never a delete, so the row stays the
 * audit trail behind the sessions it minted.
 */

/** The marker every trusted-header key starts with. */
export const TRUSTED_HEADER_KEY_MARKER = 'thk_';

export interface TrustedHeadersActor {
  userId: string;
  email?: string;
}

export class TrustedHeadersError extends Error {
  constructor(
    readonly code: 'TRUSTED_HEADER_KEY_NOT_FOUND' | 'TRUSTED_HEADER_KEY_LIMIT',
    message: string,
    readonly status: 404 | 409,
  ) {
    super(message);
    this.name = 'TrustedHeadersError';
  }
}

interface SettingsRow {
  enabled: boolean;
  maxAssertedRole: string;
}

function parseMaxAssertedRole(value: string): TrustedHeaderAssertableRole {
  const parsed = trustedHeaderAssertableRoleSchema.safeParse(value);
  return parsed.success ? parsed.data : 'member';
}

async function readSettings(
  sql: Sql,
  organizationId: string,
): Promise<SettingsRow | null> {
  const rows = await sql<SettingsRow[]>`
    SELECT enabled, max_asserted_role AS "maxAssertedRole"
    FROM app.trusted_header_settings
    WHERE org_id = ${organizationId}
    LIMIT 1
  `;
  return rows[0] ?? null;
}

async function listLiveKeys(
  sql: Sql,
  organizationId: string,
): Promise<TrustedHeaderKeyView[]> {
  return sql<TrustedHeaderKeyView[]>`
    SELECT id, name,
           token_prefix AS "tokenPrefix",
           created_by AS "createdBy",
           created_at_ms::float8 AS "createdAt",
           last_used_at_ms::float8 AS "lastUsedAt"
    FROM app.trusted_header_keys
    WHERE org_id = ${organizationId} AND revoked_at_ms IS NULL
    ORDER BY created_at_ms DESC
  `;
}

/** What the settings card reads: the switch, the ceiling, the live keys. */
export async function getTrustedHeadersView(
  sql: Sql,
  organizationId: string,
): Promise<TrustedHeadersView> {
  const [settings, keys] = await Promise.all([
    readSettings(sql, organizationId),
    listLiveKeys(sql, organizationId),
  ]);
  return {
    enabled: settings?.enabled ?? false,
    maxAssertedRole: parseMaxAssertedRole(
      settings?.maxAssertedRole ?? 'member',
    ),
    keys,
    headers: trustedHeaderNames(),
  };
}

/**
 * Flip the switch and/or move the ceiling. One audit row per call, named
 * for the change that matters most: a switch flip over a ceiling move.
 */
export async function setTrustedHeaderSettings(
  sql: Sql,
  args: TrustedHeaderSettingsInput & {
    organizationId: string;
    actor: TrustedHeadersActor;
  },
): Promise<TrustedHeadersView> {
  await sql.begin(async (tx) => {
    const now = Date.now();
    const previous = await tx<SettingsRow[]>`
      SELECT enabled, max_asserted_role AS "maxAssertedRole"
      FROM app.trusted_header_settings
      WHERE org_id = ${args.organizationId}
      FOR UPDATE
    `;
    const before = previous[0];
    await tx`
      INSERT INTO app.trusted_header_settings (
        org_id, enabled, max_asserted_role, updated_by, created_at_ms, updated_at_ms
      ) VALUES (
        ${args.organizationId}, ${args.enabled}, ${args.maxAssertedRole},
        ${args.actor.userId}, ${now}, ${now}
      )
      ON CONFLICT (org_id) DO UPDATE SET
        enabled = ${args.enabled},
        max_asserted_role = ${args.maxAssertedRole},
        updated_by = ${args.actor.userId},
        updated_at_ms = ${now}
    `;
    const wasEnabled = before?.enabled ?? false;
    const action =
      wasEnabled !== args.enabled
        ? args.enabled
          ? 'trusted_headers_enabled'
          : 'trusted_headers_disabled'
        : 'trusted_headers_policy_updated';
    await createAuditLog(tx, {
      organizationId: args.organizationId,
      actorId: args.actor.userId,
      ...(args.actor.email !== undefined
        ? { actorEmail: args.actor.email }
        : {}),
      actorType: 'user',
      action,
      category: 'security',
      resourceType: 'trusted_headers',
      resourceId: args.organizationId,
      ...(before !== undefined
        ? {
            previousState: {
              enabled: before.enabled,
              maxAssertedRole: before.maxAssertedRole,
            },
          }
        : {}),
      newState: {
        enabled: args.enabled,
        maxAssertedRole: args.maxAssertedRole,
      },
      status: 'success',
    });
  });
  return getTrustedHeadersView(sql, args.organizationId);
}

/**
 * Mint a key for the organization. The plaintext leaves this function once,
 * in the return value; the row keeps the hash and a display prefix.
 */
export async function createTrustedHeaderKey(
  sql: Sql,
  args: TrustedHeaderKeyCreateInput & {
    organizationId: string;
    actor: TrustedHeadersActor;
  },
): Promise<TrustedHeaderKeyCreated> {
  const key = generateOpaqueToken(TRUSTED_HEADER_KEY_MARKER);
  const tokenHash = await hashOpaqueToken(key);
  const tokenPrefix = opaqueTokenPrefix(key, TRUSTED_HEADER_KEY_MARKER);
  const name = args.name.trim();
  const id = await sql.begin(async (tx) => {
    const now = Date.now();
    // Serialize the count-then-insert per organization, so two admins
    // racing the ceiling cannot both land the eleventh key.
    await tx`SELECT pg_advisory_xact_lock(hashtextextended(${`trusted-header-keys:${args.organizationId}`}, 0))`;
    const live = await tx<{ count: string }[]>`
      SELECT count(*)::text AS count FROM app.trusted_header_keys
      WHERE org_id = ${args.organizationId} AND revoked_at_ms IS NULL
    `;
    if (Number(live[0]?.count ?? '0') >= TRUSTED_HEADER_KEYS_PER_ORG_MAX) {
      throw new TrustedHeadersError(
        'TRUSTED_HEADER_KEY_LIMIT',
        `An organization holds at most ${TRUSTED_HEADER_KEYS_PER_ORG_MAX} live trusted-header keys; revoke one first`,
        409,
      );
    }
    const inserted = await tx<{ id: string }[]>`
      INSERT INTO app.trusted_header_keys (
        org_id, name, token_hash, token_prefix, created_by, created_at_ms
      ) VALUES (
        ${args.organizationId}, ${name}, ${tokenHash}, ${tokenPrefix},
        ${args.actor.userId}, ${now}
      )
      RETURNING id
    `;
    const keyId = inserted[0]?.id;
    if (keyId === undefined)
      throw new Error('trusted-header key insert failed');
    await createAuditLog(tx, {
      organizationId: args.organizationId,
      actorId: args.actor.userId,
      ...(args.actor.email !== undefined
        ? { actorEmail: args.actor.email }
        : {}),
      actorType: 'user',
      action: 'trusted_header_key_created',
      category: 'security',
      resourceType: 'trusted_header_key',
      resourceId: keyId,
      resourceName: name,
      newState: { name, tokenPrefix },
      status: 'success',
    });
    return keyId;
  });
  return { id, key, tokenPrefix };
}

/**
 * Revoke a key: a stamp on the row. A second revoke is a no-op; a key that
 * is not this organization's is "not found" — the id space says nothing
 * about other organizations.
 */
export async function revokeTrustedHeaderKey(
  sql: Sql,
  args: { organizationId: string; actor: TrustedHeadersActor; keyId: string },
): Promise<void> {
  await sql.begin(async (tx) => {
    const rows = await tx<
      {
        id: string;
        name: string;
        tokenPrefix: string;
        revokedAt: string | null;
      }[]
    >`
      SELECT id, name, token_prefix AS "tokenPrefix",
             revoked_at_ms::text AS "revokedAt"
      FROM app.trusted_header_keys
      WHERE id = ${args.keyId} AND org_id = ${args.organizationId}
      FOR UPDATE
    `;
    const row = rows[0];
    if (row === undefined) {
      throw new TrustedHeadersError(
        'TRUSTED_HEADER_KEY_NOT_FOUND',
        'No such trusted-header key in this organization',
        404,
      );
    }
    if (row.revokedAt !== null) return;
    const now = Date.now();
    await tx`
      UPDATE app.trusted_header_keys
      SET revoked_at_ms = ${now}, revoked_by = ${args.actor.userId}
      WHERE id = ${row.id}
    `;
    await createAuditLog(tx, {
      organizationId: args.organizationId,
      actorId: args.actor.userId,
      ...(args.actor.email !== undefined
        ? { actorEmail: args.actor.email }
        : {}),
      actorType: 'user',
      action: 'trusted_header_key_revoked',
      category: 'security',
      resourceType: 'trusted_header_key',
      resourceId: row.id,
      resourceName: row.name,
      previousState: { name: row.name, tokenPrefix: row.tokenPrefix },
      status: 'success',
    });
  });
}

/** What the door learns from a presented key. */
export interface ResolvedTrustedHeaderKey {
  keyId: string;
  organizationId: string;
  /** The organization's switch — a live key of a paused organization resolves, and is then refused. */
  enabled: boolean;
  maxAssertedRole: TrustedHeaderAssertableRole;
}

/**
 * Resolve a presented key to its organization. Only a live (unrevoked) key
 * matches; the empty string never does.
 */
export async function resolveTrustedHeaderKey(
  sql: Sql,
  presentedKey: string,
): Promise<ResolvedTrustedHeaderKey | null> {
  const key = presentedKey.trim();
  if (!key) return null;
  const tokenHash = await hashOpaqueToken(key);
  const rows = await sql<
    {
      keyId: string;
      organizationId: string;
      enabled: boolean | null;
      maxAssertedRole: string | null;
    }[]
  >`
    SELECT k.id AS "keyId", k.org_id AS "organizationId",
           s.enabled AS enabled, s.max_asserted_role AS "maxAssertedRole"
    FROM app.trusted_header_keys k
    LEFT JOIN app.trusted_header_settings s ON s.org_id = k.org_id
    WHERE k.token_hash = ${tokenHash} AND k.revoked_at_ms IS NULL
    LIMIT 1
  `;
  const row = rows[0];
  if (row === undefined) return null;
  return {
    keyId: row.keyId,
    organizationId: row.organizationId,
    enabled: row.enabled ?? false,
    maxAssertedRole: parseMaxAssertedRole(row.maxAssertedRole ?? 'member'),
  };
}

/** Throttled last-used stamp (skips within a minute), as the SCIM token's. */
export async function touchTrustedHeaderKeyLastUsed(
  sql: Sql,
  keyId: string,
): Promise<void> {
  const now = Date.now();
  await sql`
    UPDATE app.trusted_header_keys SET last_used_at_ms = ${now}
    WHERE id = ${keyId}
      AND (last_used_at_ms IS NULL OR last_used_at_ms < ${now - 60_000})
  `;
}
