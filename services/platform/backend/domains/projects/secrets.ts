import type { Sql, TransactionSql } from 'postgres';

import { SECRET_NAME_RE } from '../../../lib/shared/schemas/secrets.ts';
import { encryptSecret } from '../../core/lib/secret_box.ts';
import { toJson } from '../../db/sql.ts';
import { emitHintInTx } from '../../realtime/outbox.ts';
import {
  assertProjectAdministrable,
  loadProjectOrThrow,
  ProjectError,
  type ProjectAuthContext,
} from './service.ts';

/**
 * Project-scoped secrets — the 0.4 `projects/secrets` surface: metadata-only
 * listings (values are write-only), name normalization + shape checks with
 * the same structured codes the Secrets tab maps, the atomic
 * `_USERNAME`/`_PASSWORD` pair write, project-administer gating throughout.
 */

const SECRET_VALUE_MAX = 8192;

export interface ProjectSecretMetadata {
  name: string;
  description: string | null;
  updatedAt: number;
  updatedBy: string;
}

/**
 * Normalize (trim + upper-case) and shape-check a secret name. The check runs
 * on the FULL name (including any `_USERNAME`/`_PASSWORD` suffix), so an
 * over-long base that overflows the 64-char budget once suffixed is rejected
 * here too.
 */
function normalizeSecretName(raw: string): string {
  const name = raw.trim().toUpperCase();
  if (!SECRET_NAME_RE.test(name)) {
    throw new ProjectError('SECRET_NAME_INVALID', 'Invalid secret name');
  }
  return name;
}

function assertSecretValue(value: string): void {
  if (value.length === 0 || value.length > SECRET_VALUE_MAX) {
    throw new ProjectError('SECRET_VALUE_INVALID', 'Invalid secret value');
  }
}

async function requireAdministrable(
  sql: Sql | TransactionSql,
  auth: ProjectAuthContext,
  projectId: string,
): Promise<void> {
  const project = await loadProjectOrThrow(sql, projectId);
  assertProjectAdministrable(project, auth);
}

/** List project secret METADATA (never values) — project-administer only:
 * secrets are sensitive even at the name level. */
export async function listProjectSecrets(
  sql: Sql,
  auth: ProjectAuthContext,
  projectId: string,
): Promise<ProjectSecretMetadata[]> {
  await requireAdministrable(sql, auth, projectId);
  return sql<ProjectSecretMetadata[]>`
    SELECT name, description, updated_at_ms::float8 AS "updatedAt",
           updated_by AS "updatedBy"
    FROM app.project_secrets
    WHERE org_id = ${auth.organizationId} AND project_id = ${projectId}
    ORDER BY name
  `;
}

async function upsertSecretRow(
  tx: TransactionSql,
  scope: { organizationId: string; projectId: string; updatedBy: string },
  fields: { name: string; description: string | undefined; value: string },
): Promise<void> {
  const envelope = encryptSecret(fields.value);
  const now = Date.now();
  await tx`
    INSERT INTO app.project_secrets (
      org_id, project_id, name, description, encrypted_value,
      created_by, updated_by, created_at_ms, updated_at_ms
    ) VALUES (
      ${scope.organizationId}, ${scope.projectId}, ${fields.name},
      ${fields.description ?? null}, ${tx.json(toJson(envelope))},
      ${scope.updatedBy}, ${scope.updatedBy}, ${now}, ${now}
    )
    ON CONFLICT (org_id, project_id, name) DO UPDATE SET
      description = EXCLUDED.description,
      encrypted_value = EXCLUDED.encrypted_value,
      updated_by = EXCLUDED.updated_by,
      updated_at_ms = EXCLUDED.updated_at_ms
  `;
}

/** Create or update one project secret (encrypts the value, stores only the
 * ciphertext envelope). */
export async function setProjectSecret(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: {
    projectId: string;
    name: string;
    value: string;
    description?: string;
  },
): Promise<void> {
  await requireAdministrable(tx, auth, args.projectId);
  const name = normalizeSecretName(args.name);
  assertSecretValue(args.value);
  await upsertSecretRow(
    tx,
    {
      organizationId: auth.organizationId,
      projectId: args.projectId,
      updatedBy: auth.userId,
    },
    {
      name,
      description: args.description?.trim() || undefined,
      value: args.value,
    },
  );
  await emitHintInTx(tx, {
    orgId: auth.organizationId,
    entity: 'project',
    entityId: args.projectId,
  });
}

/**
 * Create or update a `basic` credential as the `_USERNAME`/`_PASSWORD` secret
 * pair in a SINGLE transaction — either both rows land or neither does (the
 * 0.4 fix for the orphaned first write of two sequential calls).
 */
export async function setProjectSecretPair(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: {
    projectId: string;
    baseName: string;
    username: string;
    password: string;
    description?: string;
  },
): Promise<void> {
  await requireAdministrable(tx, auth, args.projectId);
  // Validate the base shape first, then each suffixed name (an over-long
  // base fails with the same SECRET_NAME_INVALID the tab maps).
  const base = normalizeSecretName(args.baseName);
  const usernameName = normalizeSecretName(`${base}_USERNAME`);
  const passwordName = normalizeSecretName(`${base}_PASSWORD`);
  assertSecretValue(args.username);
  assertSecretValue(args.password);
  const description = args.description?.trim() || undefined;
  const scope = {
    organizationId: auth.organizationId,
    projectId: args.projectId,
    updatedBy: auth.userId,
  };
  await upsertSecretRow(tx, scope, {
    name: usernameName,
    description,
    value: args.username,
  });
  await upsertSecretRow(tx, scope, {
    name: passwordName,
    description,
    value: args.password,
  });
  await emitHintInTx(tx, {
    orgId: auth.organizationId,
    entity: 'project',
    entityId: args.projectId,
  });
}

/** Delete one project secret by name (idempotent — a missing row is a no-op,
 * the 0.4 posture). */
export async function deleteProjectSecret(
  tx: TransactionSql,
  auth: ProjectAuthContext,
  args: { projectId: string; name: string },
): Promise<void> {
  await requireAdministrable(tx, auth, args.projectId);
  await tx`
    DELETE FROM app.project_secrets
    WHERE org_id = ${auth.organizationId}
      AND project_id = ${args.projectId}
      AND name = ${args.name.trim().toUpperCase()}
  `;
  await emitHintInTx(tx, {
    orgId: auth.organizationId,
    entity: 'project',
    entityId: args.projectId,
  });
}
