import type { Sql } from 'postgres';

import {
  maskAgentSecretPreview,
  MAX_AGENT_SECRET_DESCRIPTION_LEN,
  MAX_AGENT_SECRETS_PER_ORG,
  validateAgentSecretName,
  validateAgentSecretValue,
} from '../../core/agent_secrets/constants.ts';
import {
  decryptSecret,
  encryptSecret,
  type EncryptedSecret,
} from '../../core/lib/secret_box.ts';
import { toJson } from '../../db/sql.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import { createAuditLog } from '../audit_logs/service.ts';

/**
 * Org agent secrets — the 0.5 twin of `convex/agent_secrets/*` with the
 * validation/masking/crypto REUSED verbatim. Values are write-only: no
 * read-back path exists; plaintext leaves this module only inside
 * `resolveAgentSecretsEnv`'s per-turn env map. A dangling name on an
 * agent's equipment is inert (the injection simply skips it), so deletion
 * never rewrites agent rows. Injection audits one credential-access row
 * PER injected secret, keyed by name — the name is non-secret.
 */

export class AgentSecretError extends Error {
  readonly code: string;
  readonly status: 400 | 404 | 409;
  constructor(code: string, message: string, status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = 'AgentSecretError';
    this.code = code;
    this.status = status;
  }
}

const AGENT_SECRET_AUDIT = {
  created: 'agent_secret.created',
  updated: 'agent_secret.updated',
  deleted: 'agent_secret.deleted',
} as const;
const AGENT_SECRET_RESOURCE_TYPE = 'agent_secret';

export async function upsertAgentSecret(
  sql: Sql,
  args: {
    organizationId: string;
    actorId: string;
    actorEmail?: string;
    name: string;
    value: string;
    description?: string;
  },
): Promise<{ created: boolean }> {
  const nameCheck = validateAgentSecretName(args.name);
  if (!nameCheck.ok) {
    throw new AgentSecretError('invalid', nameCheck.reason);
  }
  // Trim surrounding whitespace — a pasted token very commonly carries a
  // trailing newline that silently corrupts it (→ 401). Interior whitespace
  // is kept so multi-line secrets (PEM keys) survive.
  const value = args.value.trim();
  const valueCheck = validateAgentSecretValue(value);
  if (!valueCheck.ok) {
    throw new AgentSecretError('invalid', valueCheck.reason);
  }
  const description = args.description?.trim();
  if (
    description !== undefined &&
    description.length > MAX_AGENT_SECRET_DESCRIPTION_LEN
  ) {
    throw new AgentSecretError(
      'invalid',
      `Description exceeds ${MAX_AGENT_SECRET_DESCRIPTION_LEN} characters.`,
    );
  }
  const encryptedValue = encryptSecret(value);
  const maskedPreview = maskAgentSecretPreview(value);
  const now = Date.now();
  return sql.begin(async (tx) => {
    const existing = await tx<{ id: string }[]>`
      SELECT id FROM app.agent_secrets
      WHERE org_id = ${args.organizationId} AND name = ${args.name}
      LIMIT 1
    `;
    if (existing[0]) {
      await tx`
        UPDATE app.agent_secrets SET
          encrypted_value = ${tx.json(toJson(encryptedValue))},
          description = ${description !== undefined && description !== '' ? description : null},
          masked_preview = ${maskedPreview ?? null},
          updated_at_ms = ${now}, updated_by = ${args.actorId}
        WHERE id = ${existing[0].id}
      `;
    } else {
      const count = await tx<{ count: string }[]>`
        SELECT count(*)::text AS count FROM app.agent_secrets
        WHERE org_id = ${args.organizationId}
      `;
      if (Number(count[0]?.count ?? '0') >= MAX_AGENT_SECRETS_PER_ORG) {
        throw new AgentSecretError(
          'AGENT_SECRET_LIMIT',
          `An organization may store at most ${MAX_AGENT_SECRETS_PER_ORG} agent secrets.`,
          409,
        );
      }
      await tx`
        INSERT INTO app.agent_secrets (
          org_id, name, description, encrypted_value, masked_preview,
          created_by, created_at_ms, updated_by, updated_at_ms
        ) VALUES (
          ${args.organizationId}, ${args.name},
          ${description !== undefined && description !== '' ? description : null},
          ${tx.json(toJson(encryptedValue))}, ${maskedPreview ?? null},
          ${args.actorId}, ${now}, ${args.actorId}, ${now}
        )
      `;
    }
    // The audit row records the name + description length only — never the
    // value, the preview, or the ciphertext.
    await createAuditLog(tx, {
      organizationId: args.organizationId,
      actorId: args.actorId,
      ...(args.actorEmail !== undefined ? { actorEmail: args.actorEmail } : {}),
      actorType: 'user',
      action: existing[0]
        ? AGENT_SECRET_AUDIT.updated
        : AGENT_SECRET_AUDIT.created,
      category: 'data',
      resourceType: AGENT_SECRET_RESOURCE_TYPE,
      resourceId: args.name,
      resourceName: args.name,
      metadata: { descriptionLength: description?.length ?? 0 },
      status: 'success',
    });
    await emitHintInTx(tx, {
      orgId: args.organizationId,
      entity: 'agent_secret',
      entityId: args.name,
    });
    return { created: existing.length === 0 };
  });
}

export async function listAgentSecrets(
  sql: Sql,
  organizationId: string,
): Promise<
  Array<{
    name: string;
    description: string | null;
    maskedPreview: string | null;
    createdAt: number;
    updatedAt: number;
    updatedBy: string;
  }>
> {
  return sql<
    {
      name: string;
      description: string | null;
      maskedPreview: string | null;
      createdAt: number;
      updatedAt: number;
      updatedBy: string;
    }[]
  >`
    SELECT name, description, masked_preview AS "maskedPreview",
           created_at_ms::float8 AS "createdAt",
           updated_at_ms::float8 AS "updatedAt",
           updated_by AS "updatedBy"
    FROM app.agent_secrets
    WHERE org_id = ${organizationId}
    ORDER BY name
  `;
}

export async function deleteAgentSecret(
  sql: Sql,
  args: {
    organizationId: string;
    actorId: string;
    actorEmail?: string;
    name: string;
  },
): Promise<void> {
  await sql.begin(async (tx) => {
    const removed = await tx<{ id: string }[]>`
      DELETE FROM app.agent_secrets
      WHERE org_id = ${args.organizationId} AND name = ${args.name}
      RETURNING id
    `;
    if (removed.length === 0) {
      throw new AgentSecretError(
        'AGENT_SECRET_NOT_FOUND',
        'No secret by that name',
        404,
      );
    }
    await createAuditLog(tx, {
      organizationId: args.organizationId,
      actorId: args.actorId,
      ...(args.actorEmail !== undefined ? { actorEmail: args.actorEmail } : {}),
      actorType: 'user',
      action: AGENT_SECRET_AUDIT.deleted,
      category: 'data',
      resourceType: AGENT_SECRET_RESOURCE_TYPE,
      resourceId: args.name,
      resourceName: args.name,
      status: 'success',
    });
    await emitHintInTx(tx, {
      orgId: args.organizationId,
      entity: 'agent_secret',
      entityId: args.name,
    });
  });
}

/**
 * Decrypt the named org secrets into a turn's env map — the work lanes'
 * per-exec injection. A corrupt secret / rotated key skips that one entry
 * (never aborts the turn); a name with no row is silently absent. One
 * credential-access audit row per injected secret, best-effort.
 */
export async function resolveAgentSecretsEnv(
  sql: Sql,
  args: { organizationId: string; sessionId: string; names: string[] },
): Promise<{ env: Record<string, string> }> {
  if (args.names.length === 0) return { env: {} };
  const rows = await sql<{ name: string; encryptedValue: unknown }[]>`
    SELECT name, encrypted_value AS "encryptedValue"
    FROM app.agent_secrets
    WHERE org_id = ${args.organizationId} AND name IN ${sql(args.names)}
  `;
  const env: Record<string, string> = {};
  const injected: string[] = [];
  for (const row of rows) {
    try {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the column stores exactly the encryptSecret envelope
      env[row.name] = decryptSecret(row.encryptedValue as EncryptedSecret);
      injected.push(row.name);
    } catch (err) {
      console.warn(
        `[agent-secrets] secret '${row.name}' failed to decrypt:`,
        err instanceof Error ? err.message : String(err),
      );
    }
  }
  for (const name of injected) {
    try {
      await sql`
        INSERT INTO app.sandbox_credential_access (
          org_id, session_id, slug, kind, fetched_at_ms
        ) VALUES (
          ${args.organizationId}, ${args.sessionId},
          ${`agent-secret:${name}`}, 'bootstrap', ${Date.now()}
        )
      `;
    } catch (err) {
      console.warn('[agent-secrets] credential-access audit failed:', err);
    }
  }
  return { env };
}
