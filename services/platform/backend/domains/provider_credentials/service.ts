import type { Sql, TransactionSql } from 'postgres';

import { isAdminOrDeveloperRole } from '../../auth/membership.ts';
import type { EncryptedSecret } from '../../core/lib/secret_box.ts';
import { encryptSecret } from '../../core/lib/secret_box.ts';
import { maskSecret } from '../../core/provider_credentials/masking.ts';
import {
  resolveProviderCredential as resolveProviderCredential04,
  type ResolvedProviderCredential,
} from '../../core/provider_credentials/resolve_credential.ts';
import { toJson } from '../../db/sql.ts';
import { createCtxShim } from '../../lib/ctx-shim.ts';
import { createAuditLog } from '../audit_logs/service.ts';

/**
 * AI-provider credentials — the org's keys to LLM/embedding providers.
 * The RESOLUTION path (decrypt / env gate / broker pool fetch+pick) reuses
 * the 0.4 module byte-for-byte through the ctx shim: only the two row
 * lookups it makes are re-pointed at `app.provider_credentials`. Secret
 * material never leaves the server: list/read return metadata + the
 * write-time masked preview.
 *
 * Admin surface gate: Settings → AI providers = admin/developer roles
 * (the 0.4 developerSettings capability).
 */

export class CredentialAdminError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404;

  constructor(code: string, message: string, status: 400 | 403 | 404 = 400) {
    super(message);
    this.name = 'CredentialAdminError';
    this.code = code;
    this.status = status;
  }
}

export interface CredentialScope {
  organizationId: string;
  userId: string;
  email?: string;
  role: string;
}

function assertCredentialAdmin(scope: CredentialScope): void {
  if (!isAdminOrDeveloperRole(scope.role)) {
    throw new CredentialAdminError(
      'FORBIDDEN_DEVELOPER_SETTINGS',
      'Admin or developer role required',
      403,
    );
  }
}

/** The row shape the reused 0.4 resolver expects (`_id`, camelCase). */
interface ResolverRow {
  _id: string;
  organizationId: string;
  providerSlug: string;
  authMethod: 'api-key' | 'env' | 'subscription-key' | 'subscription-broker';
  name: string;
  encryptedData?: EncryptedSecret;
  envName?: string;
  endpointUrl?: string;
  status: 'active' | 'disabled';
}

const RESOLVER_COLUMNS = `
  id AS "_id", org_id AS "organizationId", provider_slug AS "providerSlug",
  auth_method AS "authMethod", name, encrypted_data AS "encryptedData",
  env_name AS "envName", endpoint_url AS "endpointUrl", status
`;

function rowOrNull(rows: ResolverRow[]): ResolverRow | null {
  const row = rows[0];
  if (!row) {
    return null;
  }
  // The resolver treats absent optionals as undefined, not null.
  return {
    ...row,
    encryptedData: row.encryptedData ?? undefined,
    envName: row.envName ?? undefined,
    endpointUrl: row.endpointUrl ?? undefined,
  };
}

/** The credential-row shim handlers, shared with every reused 0.4 module
 * that resolves credentials (knowledge embedding, the chat gateway later). */
export function credentialShimHandlers(
  sql: Sql,
): Record<string, (raw: unknown) => Promise<unknown>> {
  return {
    'provider_credentials/queries:getCredentialInternal': async (raw) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the reused 0.4 caller passes exactly this shape
      const { credentialId } = raw as { credentialId: string };
      return rowOrNull(
        await sql<ResolverRow[]>`
          SELECT ${sql.unsafe(RESOLVER_COLUMNS)} FROM app.provider_credentials
          WHERE id = ${credentialId} LIMIT 1
        `,
      );
    },
    'provider_credentials/queries:getDefaultCredentialInternal': async (
      raw,
    ) => {
      // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- shim boundary: the reused 0.4 caller passes exactly this shape
      const { organizationId, providerSlug } = raw as {
        organizationId: string;
        providerSlug: string;
      };
      return rowOrNull(
        await sql<ResolverRow[]>`
          SELECT ${sql.unsafe(RESOLVER_COLUMNS)} FROM app.provider_credentials
          WHERE org_id = ${organizationId}
            AND provider_slug = ${providerSlug}
            AND is_default AND status = 'active'
          LIMIT 1
        `,
      );
    },
  };
}

/**
 * Resolve one (org, provider[, credential]) selection to usable secret
 * material — the 0.4 resolver running over Postgres rows. INTERNAL ONLY:
 * callers keep the result out of logs and responses.
 */
export async function resolveProviderCredential(
  sql: Sql,
  args: {
    organizationId: string;
    providerSlug: string;
    credentialId?: string;
    excludeBrokerTokens?: readonly string[];
    excludeBrokerTokenHashes?: readonly string[];
  },
): Promise<ResolvedProviderCredential> {
  const shim = createCtxShim(credentialShimHandlers(sql));
  return resolveProviderCredential04(
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the reused 0.4 resolver touches only runQuery (see ctx-shim contract)
    shim as unknown as Parameters<typeof resolveProviderCredential04>[0],
    {
      organizationId: args.organizationId,
      providerSlug: args.providerSlug,
      ...(args.credentialId !== undefined
        ? {
            credentialId: args.credentialId,
          }
        : {}),
      ...(args.excludeBrokerTokens !== undefined
        ? { excludeBrokerTokens: args.excludeBrokerTokens }
        : {}),
      ...(args.excludeBrokerTokenHashes !== undefined
        ? { excludeBrokerTokenHashes: args.excludeBrokerTokenHashes }
        : {}),
    },
  );
}

/** The credential facts a model-serving walk reads. */
export interface ServingCredentialFacts {
  providerSlug: string;
  authMethod: 'api-key' | 'env' | 'subscription-key' | 'subscription-broker';
  modelAllowlist?: string[];
}

/**
 * The org's SERVABLE credential per provider — the active default row, and
 * only that: every serving path (the chat wire, the agent walks, vision,
 * TTS, the title lane) resolves a provider's default credential, so a model
 * only a non-default or disabled credential could reach is a model no turn
 * can run. The composer's picker and the Auto pick read THIS set, which is
 * what keeps "offered" and "servable" the same world: disable or delete a
 * connector's default and its models leave the picker (the settings page
 * says the connector has no default) instead of failing every send.
 */
export async function listServingCredentialFacts(
  sql: Sql,
  organizationId: string,
): Promise<ServingCredentialFacts[]> {
  const rows = await sql<
    {
      providerSlug: string;
      authMethod: ServingCredentialFacts['authMethod'];
      modelAllowlist: string[] | null;
    }[]
  >`
    SELECT provider_slug AS "providerSlug", auth_method AS "authMethod",
           model_allowlist AS "modelAllowlist"
    FROM app.provider_credentials
    WHERE org_id = ${organizationId} AND is_default AND status = 'active'
    ORDER BY provider_slug ASC
  `;
  return rows.map((row) => {
    const facts: ServingCredentialFacts = {
      providerSlug: row.providerSlug,
      authMethod: row.authMethod,
    };
    if (row.modelAllowlist !== null) facts.modelAllowlist = row.modelAllowlist;
    return facts;
  });
}

// ---------------------------------------------------------------------------
// Admin surface
// ---------------------------------------------------------------------------

export interface CredentialListItem {
  id: string;
  providerSlug: string;
  authMethod: string;
  name: string;
  envName: string | null;
  endpointUrl: string | null;
  maskedPreview: string | null;
  modelAllowlist: string[] | null;
  isDefault: boolean;
  status: string;
  createdAt: number;
  updatedAt: number;
}

export async function listCredentials(
  sql: Sql,
  scope: CredentialScope,
  providerSlug?: string,
): Promise<CredentialListItem[]> {
  assertCredentialAdmin(scope);
  return sql<CredentialListItem[]>`
    SELECT id, provider_slug AS "providerSlug", auth_method AS "authMethod",
           name, env_name AS "envName", endpoint_url AS "endpointUrl",
           masked_preview AS "maskedPreview",
           model_allowlist AS "modelAllowlist", is_default AS "isDefault",
           status, created_at_ms::float8 AS "createdAt",
           updated_at_ms::float8 AS "updatedAt"
    FROM app.provider_credentials
    WHERE org_id = ${scope.organizationId}
      AND (${providerSlug ?? null}::text IS NULL
        OR provider_slug = ${providerSlug ?? null})
    ORDER BY provider_slug ASC, created_at_ms ASC
  `;
}

const ENV_NAME_REGEX = /^TALE_PROVIDER_KEY_[A-Z0-9_]{1,64}$/;

export interface CreateCredentialArgs {
  providerSlug: string;
  authMethod: 'api-key' | 'env' | 'subscription-key' | 'subscription-broker';
  name: string;
  /** Plaintext secret (api-key/subscription-key) or broker-config JSON. */
  secret?: string;
  envName?: string;
  endpointUrl?: string;
  modelAllowlist?: string[];
}

export async function createCredential(
  tx: TransactionSql,
  scope: CredentialScope,
  args: CreateCredentialArgs,
): Promise<string> {
  assertCredentialAdmin(scope);
  const name = args.name.trim();
  if (name.length === 0 || name.length > 120) {
    throw new CredentialAdminError('CREDENTIAL_NAME_INVALID', 'Invalid name');
  }
  let encryptedData: EncryptedSecret | undefined;
  let maskedPreview: string | undefined;
  let envName: string | undefined;
  if (args.authMethod === 'env') {
    if (!args.envName || !ENV_NAME_REGEX.test(args.envName)) {
      throw new CredentialAdminError(
        'CREDENTIAL_ENV_NAME_INVALID',
        'Env credentials must reference a TALE_PROVIDER_KEY_* variable',
      );
    }
    envName = args.envName;
  } else {
    if (!args.secret || args.secret.trim().length === 0) {
      throw new CredentialAdminError(
        'CREDENTIAL_SECRET_REQUIRED',
        'A secret is required for this auth method',
      );
    }
    encryptedData = encryptSecret(args.secret);
    maskedPreview =
      args.authMethod === 'subscription-broker'
        ? undefined
        : maskSecret(args.secret);
  }
  if (
    args.endpointUrl !== undefined &&
    !args.endpointUrl.startsWith('https://')
  ) {
    throw new CredentialAdminError(
      'CREDENTIAL_ENDPOINT_INVALID',
      'Endpoint URLs must be https',
    );
  }

  const siblings = await tx<{ id: string }[]>`
    SELECT id FROM app.provider_credentials
    WHERE org_id = ${scope.organizationId}
      AND provider_slug = ${args.providerSlug}
    LIMIT 1
  `;
  const now = Date.now();
  const rows = await tx<{ id: string }[]>`
    INSERT INTO app.provider_credentials (
      org_id, provider_slug, auth_method, name, encrypted_data, env_name,
      endpoint_url, masked_preview, model_allowlist, is_default, status,
      created_by, created_at_ms, updated_at_ms
    ) VALUES (
      ${scope.organizationId}, ${args.providerSlug}, ${args.authMethod},
      ${name},
      ${encryptedData === undefined ? null : tx.json(toJson(encryptedData))},
      ${envName ?? null}, ${args.endpointUrl ?? null},
      ${maskedPreview ?? null}, ${args.modelAllowlist ?? null},
      ${siblings.length === 0}, 'active', ${scope.userId}, ${now}, ${now}
    )
    RETURNING id
  `;
  const id = rows[0]?.id;
  if (!id) {
    throw new CredentialAdminError('CREDENTIAL_CREATE_FAILED', 'Insert failed');
  }
  await createAuditLog(tx, {
    organizationId: scope.organizationId,
    actorId: scope.userId,
    ...(scope.email !== undefined ? { actorEmail: scope.email } : {}),
    actorType: 'user',
    action: 'provider_credential.created',
    category: 'security',
    resourceType: 'provider_credential',
    resourceId: id,
    resourceName: name,
    metadata: { providerSlug: args.providerSlug, authMethod: args.authMethod },
    status: 'success',
  });
  return id;
}

export interface UpdateCredentialPatch {
  name?: string;
  status?: 'active' | 'disabled';
  isDefault?: boolean;
  modelAllowlist?: string[] | null;
  endpointUrl?: string | null;
  /** Re-point an `env` credential at another TALE_PROVIDER_KEY_* variable. */
  envName?: string;
  /** Rotate the stored secret (api-key/subscription-key/broker JSON). */
  secret?: string;
}

/** Name / status / default / allowlist / endpoint / env-ref / secret-rotation
 * edits. An empty patch is refused rather than acknowledged: an ack with an
 * audit row and no change is how a dropped field once read as a saved edit. */
export async function updateCredential(
  tx: TransactionSql,
  scope: CredentialScope,
  credentialId: string,
  patch: UpdateCredentialPatch,
): Promise<void> {
  assertCredentialAdmin(scope);
  if (Object.values(patch).every((value) => value === undefined)) {
    throw new CredentialAdminError(
      'CREDENTIAL_PATCH_EMPTY',
      'Nothing to update — the edit carried no changed field',
    );
  }
  const rows = await tx<
    {
      providerSlug: string;
      isDefault: boolean;
      name: string;
      authMethod:
        | 'api-key'
        | 'env'
        | 'subscription-key'
        | 'subscription-broker';
      status: 'active' | 'disabled';
    }[]
  >`
    SELECT provider_slug AS "providerSlug", is_default AS "isDefault", name,
           auth_method AS "authMethod", status
    FROM app.provider_credentials
    WHERE id = ${credentialId} AND org_id = ${scope.organizationId}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    throw new CredentialAdminError(
      'CREDENTIAL_NOT_FOUND',
      'Credential not found',
      404,
    );
  }
  // The documented contract: a disabled credential cannot become (or stay
  // being promoted as) the default — serving reads the ACTIVE default only,
  // so a disabled default is a connector that serves nothing.
  if (patch.isDefault === true && (patch.status ?? row.status) === 'disabled') {
    throw new CredentialAdminError(
      'CREDENTIAL_DISABLED_DEFAULT',
      'A disabled credential cannot be the default — enable it first',
    );
  }
  if (patch.envName !== undefined) {
    if (row.authMethod !== 'env') {
      throw new CredentialAdminError(
        'CREDENTIAL_ENV_NAME_INVALID',
        'Only an environment-variable credential carries an env name',
      );
    }
    if (!ENV_NAME_REGEX.test(patch.envName)) {
      throw new CredentialAdminError(
        'CREDENTIAL_ENV_NAME_INVALID',
        'Env credentials must reference a TALE_PROVIDER_KEY_* variable',
      );
    }
  }
  if (patch.isDefault === true) {
    await tx`
      UPDATE app.provider_credentials SET is_default = false,
        updated_at_ms = ${Date.now()}
      WHERE org_id = ${scope.organizationId}
        AND provider_slug = ${row.providerSlug}
        AND is_default AND id <> ${credentialId}
    `;
  }
  const name = patch.name?.trim();
  if (name !== undefined && (name.length === 0 || name.length > 120)) {
    throw new CredentialAdminError('CREDENTIAL_NAME_INVALID', 'Invalid name');
  }
  let rotated: EncryptedSecret | undefined;
  let rotatedPreview: string | undefined;
  if (patch.secret !== undefined) {
    if (patch.secret.trim().length === 0) {
      throw new CredentialAdminError(
        'CREDENTIAL_SECRET_INVALID',
        'Secret must not be empty',
      );
    }
    rotated = encryptSecret(patch.secret);
    // A broker configuration is JSON, not a key — same rule as creation:
    // it gets no masked preview.
    if (row.authMethod !== 'subscription-broker') {
      rotatedPreview = maskSecret(patch.secret);
    }
  }
  if (
    patch.endpointUrl !== undefined &&
    patch.endpointUrl !== null &&
    !patch.endpointUrl.startsWith('https://')
  ) {
    throw new CredentialAdminError(
      'CREDENTIAL_ENDPOINT_INVALID',
      'Endpoint URLs must be https',
    );
  }
  await tx`
    UPDATE app.provider_credentials SET
      name = coalesce(${name ?? null}, name),
      status = coalesce(${patch.status ?? null}, status),
      is_default = coalesce(${patch.isDefault ?? null}, is_default),
      model_allowlist = ${patch.modelAllowlist === undefined ? tx`model_allowlist` : (patch.modelAllowlist ?? null)},
      endpoint_url = ${patch.endpointUrl === undefined ? tx`endpoint_url` : patch.endpointUrl},
      env_name = coalesce(${patch.envName ?? null}, env_name),
      encrypted_data = ${rotated === undefined ? tx`encrypted_data` : tx.json(toJson(rotated))},
      masked_preview = coalesce(${rotatedPreview ?? null}, masked_preview),
      updated_at_ms = ${Date.now()}
    WHERE id = ${credentialId}
  `;
  await createAuditLog(tx, {
    organizationId: scope.organizationId,
    actorId: scope.userId,
    ...(scope.email !== undefined ? { actorEmail: scope.email } : {}),
    actorType: 'user',
    action: 'provider_credential.updated',
    category: 'security',
    resourceType: 'provider_credential',
    resourceId: credentialId,
    resourceName: row.name,
    status: 'success',
  });
}

export async function deleteCredential(
  tx: TransactionSql,
  scope: CredentialScope,
  credentialId: string,
): Promise<void> {
  assertCredentialAdmin(scope);
  const rows = await tx<{ name: string }[]>`
    DELETE FROM app.provider_credentials
    WHERE id = ${credentialId} AND org_id = ${scope.organizationId}
    RETURNING name
  `;
  const row = rows[0];
  if (!row) {
    throw new CredentialAdminError(
      'CREDENTIAL_NOT_FOUND',
      'Credential not found',
      404,
    );
  }
  await createAuditLog(tx, {
    organizationId: scope.organizationId,
    actorId: scope.userId,
    ...(scope.email !== undefined ? { actorEmail: scope.email } : {}),
    actorType: 'user',
    action: 'provider_credential.deleted',
    category: 'security',
    resourceType: 'provider_credential',
    resourceId: credentialId,
    resourceName: row.name,
    status: 'success',
  });
}
