import type { Sql, TransactionSql } from 'postgres';

import {
  decryptSecret,
  encryptSecret,
  type EncryptedSecret,
} from '../../core/lib/secret_box.ts';
import {
  MAX_ENV_VARS_PER_USER,
  SECRET_MASK,
  validateEnvKey,
  validateEnvValue,
} from '../../core/sandbox/user_env_constants.ts';
import { toJson } from '../../db/sql.ts';

/**
 * User-level sandbox env/secrets (the 0.4 `sandboxUserEnv` port): one row
 * per (org, user, key), auto-attachable to the user's sandbox sessions.
 * Secrets are write-only — the settings read answers a fixed mask; the
 * injection read (`resolveUserEnvForInjection`) decrypts server-side.
 */

export class UserEnvError extends Error {
  readonly code: string;

  constructor(code: string, message: string) {
    super(message);
    this.name = 'UserEnvError';
    this.code = code;
  }
}

interface UserEnvRow {
  key: string;
  isSecret: boolean;
  value: string | null;
  encrypted: EncryptedSecret | null;
  updatedAt: number;
  updatedBy: string;
}

const ENV_COLUMNS = `
  key, is_secret AS "isSecret", value, encrypted,
  updated_at_ms::float8 AS "updatedAt", updated_by AS "updatedBy"
`;

export interface UserEnvListItem {
  key: string;
  isSecret: boolean;
  value?: string;
  maskedValue?: string;
  updatedAt: number;
}

/** The settings listing — plaintext for plain vars, a mask for secrets. */
export async function listMyEnv(
  sql: Sql,
  scope: { organizationId: string; userId: string },
): Promise<UserEnvListItem[]> {
  const rows = await sql<UserEnvRow[]>`
    SELECT ${sql.unsafe(ENV_COLUMNS)} FROM app.sandbox_user_env
    WHERE org_id = ${scope.organizationId} AND user_id = ${scope.userId}
    ORDER BY key ASC
  `;
  return rows.map((row) => {
    const item: UserEnvListItem = {
      key: row.key,
      isSecret: row.isSecret,
      updatedAt: row.updatedAt,
    };
    if (row.isSecret) {
      item.maskedValue = SECRET_MASK;
    } else {
      item.value = row.value ?? '';
    }
    return item;
  });
}

/** Upsert one env/secret (validation + the per-user cap; secrets encrypted
 * with the shared envelope; a secret↔plain flip never leaves stale data). */
export async function upsertMyEnvVar(
  tx: TransactionSql,
  scope: { organizationId: string; userId: string },
  args: { key: string; value: string; isSecret: boolean },
): Promise<void> {
  const keyCheck = validateEnvKey(args.key);
  if (!keyCheck.ok) {
    throw new UserEnvError('invalid', keyCheck.reason);
  }
  const valueCheck = validateEnvValue(args.value);
  if (!valueCheck.ok) {
    throw new UserEnvError('invalid', valueCheck.reason);
  }
  const existing = await tx<{ id: string }[]>`
    SELECT id FROM app.sandbox_user_env
    WHERE org_id = ${scope.organizationId} AND user_id = ${scope.userId}
      AND key = ${args.key}
    LIMIT 1
  `;
  if (!existing[0]) {
    const counts = await tx<{ count: string }[]>`
      SELECT count(*)::text AS count FROM app.sandbox_user_env
      WHERE org_id = ${scope.organizationId} AND user_id = ${scope.userId}
    `;
    if (Number(counts[0]?.count ?? '0') >= MAX_ENV_VARS_PER_USER) {
      throw new UserEnvError(
        'too_many',
        `You can store at most ${MAX_ENV_VARS_PER_USER} environment variables.`,
      );
    }
  }
  const now = Date.now();
  const encrypted = args.isSecret ? encryptSecret(args.value) : null;
  const value = args.isSecret ? null : args.value;
  await tx`
    INSERT INTO app.sandbox_user_env (
      org_id, user_id, key, is_secret, value, encrypted, updated_by,
      created_at_ms, updated_at_ms
    ) VALUES (
      ${scope.organizationId}, ${scope.userId}, ${args.key},
      ${args.isSecret}, ${value},
      ${encrypted === null ? null : tx.json(toJson(encrypted))},
      ${scope.userId}, ${now}, ${now}
    )
    ON CONFLICT (org_id, user_id, key) DO UPDATE SET
      is_secret = EXCLUDED.is_secret, value = EXCLUDED.value,
      encrypted = EXCLUDED.encrypted, updated_by = EXCLUDED.updated_by,
      updated_at_ms = EXCLUDED.updated_at_ms
  `;
}

export async function deleteMyEnvVar(
  sql: Sql,
  scope: { organizationId: string; userId: string },
  key: string,
): Promise<{ deleted: boolean }> {
  const deleted = await sql<{ id: string }[]>`
    DELETE FROM app.sandbox_user_env
    WHERE org_id = ${scope.organizationId} AND user_id = ${scope.userId}
      AND key = ${key}
    RETURNING id
  `;
  return { deleted: deleted.length > 0 };
}

/** Injection map for a turn (secrets decrypted server-side; a corrupt
 * secret skips rather than aborting the turn — the 0.4 resilience). */
export async function resolveUserEnvForInjection(
  sql: Sql,
  scope: { organizationId: string; userId: string },
): Promise<Record<string, string>> {
  const rows = await sql<UserEnvRow[]>`
    SELECT ${sql.unsafe(ENV_COLUMNS)} FROM app.sandbox_user_env
    WHERE org_id = ${scope.organizationId} AND user_id = ${scope.userId}
  `;
  const env: Record<string, string> = {};
  for (const row of rows) {
    if (row.isSecret) {
      if (row.encrypted === null) continue;
      try {
        env[row.key] = decryptSecret(row.encrypted);
      } catch (error) {
        console.warn(
          `[sandbox.userenv] secret '${row.key}' failed to decrypt:`,
          error instanceof Error ? error.message : String(error),
        );
      }
    } else {
      env[row.key] = row.value ?? '';
    }
  }
  return env;
}
