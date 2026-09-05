import type { Sql, TransactionSql } from 'postgres';

import { AppError } from '../../../lib/shared/errors/app-error';
import {
  buildAuthHeader,
  buildSecretBindings,
  parseSecretPayload,
  SecretPayloadError,
  type ConnectorSecretPayload,
} from '../../core/connector_credentials/auth_injection.ts';
import {
  connectorBearerScheme,
  loadConnectorDefinitions,
} from '../../core/connector_credentials/connector_catalog.ts';
import { withImapFromAddress } from '../../core/connector_credentials/imap_from_address.ts';
import { maskPayload } from '../../core/connector_credentials/masking.ts';
import { normalizeEndpointOrigin } from '../../core/connector_credentials/mutations.ts';
import { oauthAppEnvPrefix } from '../../core/http_connectors/deployment_config.ts';
import {
  refreshAccessToken,
  type FetchLike,
} from '../../core/http_connectors/token_exchange.ts';
import {
  decryptSecret,
  encryptSecret,
  KeyRotatedError,
  type EncryptedSecret,
} from '../../core/lib/secret_box.ts';
import { toJson } from '../../db/sql.ts';
import {
  applyMicrosoftTenant,
  resolveConnectorOauthApp,
} from '../connectors/oauth-apps.ts';

/**
 * Connector credentials — the 0.5 twin of `convex/connector_credentials/*`:
 * org-owned, multiple per connector, secrets sealed in ONE `secret_box`
 * envelope, plaintext reachable only through {@link resolveConnectorCredential}
 * (this module's decrypt seam). The validation, payload, masking, and
 * auth-injection pieces are the 0.4 PURE modules reused verbatim; the
 * transactional invariants (case-insensitive name uniqueness, at most one
 * default per pair, delete-promotes-oldest-active) run here, backed by the
 * table's own unique indexes.
 */

type Db = Sql | TransactionSql;

type AuthMethod = 'api-key' | 'bearer' | 'basic' | 'oauth2';
type CredentialStatus = 'active' | 'disabled' | 'needs-reauth';

export class ConnectorCredentialError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409;

  constructor(
    code: string,
    message: string,
    status: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = 'ConnectorCredentialError';
    this.code = code;
    this.status = status;
  }
}

/** The 0.4 modules throw coded AppErrors; translate them onto the 0.5
 * domain error so the routes' structural mapping serves them. */
function translateAppError(error: unknown): never {
  if (error instanceof AppError) {
    const data: unknown = error.data;
    if (data !== null && typeof data === 'object' && 'code' in data) {
      const record = data as { code?: unknown; message?: unknown };
      throw new ConnectorCredentialError(
        typeof record.code === 'string' ? record.code : 'CREDENTIAL_INVALID',
        typeof record.message === 'string' ? record.message : error.message,
      );
    }
  }
  throw error;
}

export interface CredentialRow {
  id: string;
  organizationId: string;
  connectorSlug: string;
  authMethod: AuthMethod;
  name: string;
  encryptedData: EncryptedSecret;
  endpointUrl: string | null;
  config: Record<string, string | number | boolean> | null;
  maskedPreview: string | null;
  isDefault: boolean;
  mailSyncInboundSince: number | null;
  mailSyncOutboundSince: number | null;
  status: CredentialStatus;
  statusDetail: string | null;
  createdBy: string;
  createdAt: number;
  updatedAt: number;
}

const CREDENTIAL_COLUMNS = `
  id, org_id AS "organizationId", connector_slug AS "connectorSlug",
  auth_method AS "authMethod", name, encrypted_data AS "encryptedData",
  endpoint_url AS "endpointUrl", config, masked_preview AS "maskedPreview",
  is_default AS "isDefault",
  mail_sync_inbound_since_ms::float8 AS "mailSyncInboundSince",
  mail_sync_outbound_since_ms::float8 AS "mailSyncOutboundSince",
  status, status_detail AS "statusDetail", created_by AS "createdBy",
  created_at_ms::float8 AS "createdAt", updated_at_ms::float8 AS "updatedAt"
`;

/** The longest label a credential may carry — the OAuth callback derives
 * workspace-named labels and must stay within it. */
export const CREDENTIAL_NAME_MAX = 100;
const NAME_MAX = CREDENTIAL_NAME_MAX;
const SECRET_VALUE_MAX = 8192;

function normalizeName(raw: string): string {
  const name = raw.trim();
  if (name.length === 0 || name.length > NAME_MAX) {
    throw new ConnectorCredentialError(
      'CREDENTIAL_NAME_INVALID',
      `Credential name must be 1..${NAME_MAX} characters.`,
    );
  }
  return name;
}

function normalizeSecretValue(raw: string, field: string): string {
  const value = raw.trim();
  if (value.length === 0 || value.length > SECRET_VALUE_MAX) {
    throw new ConnectorCredentialError(
      'CREDENTIAL_SECRET_INVALID',
      `${field} must be 1..${SECRET_VALUE_MAX} characters.`,
    );
  }
  return value;
}

type Connector = ReturnType<typeof loadConnectorDefinitions>[number];

function requireConnectorAuthMethod(
  connectorSlug: string,
  authMethod: AuthMethod,
): Connector {
  const connectors = loadConnectorDefinitions();
  const connector = connectors.find((entry) => entry.name === connectorSlug);
  if (!connector) {
    const known = connectors
      .map((entry) => entry.name)
      .sort()
      .join(', ');
    throw new ConnectorCredentialError(
      'CONNECTOR_UNKNOWN',
      `Unknown connector "${connectorSlug}" — available connectors: ${known}.`,
      404,
    );
  }
  if (!connector.auth.some((entry) => entry.method === authMethod)) {
    const offered = connector.auth.map((entry) => entry.method).join(', ');
    throw new ConnectorCredentialError(
      'AUTH_METHOD_NOT_SUPPORTED',
      `Connector "${connectorSlug}" does not accept ${authMethod} credentials — it accepts: ${offered}.`,
    );
  }
  return connector;
}

/** Per-credential API origin: required exactly when the connector declares
 * `endpointMode: per-credential`, refused otherwise. */
function normalizeEndpointUrl(
  connector: Connector,
  raw: string | undefined,
): string | undefined {
  if (connector.endpointMode === 'per-credential') {
    if (raw === undefined) {
      throw new ConnectorCredentialError(
        'CREDENTIAL_ENDPOINT_REQUIRED',
        `Connector "${connector.name}" uses one endpoint per credential — enter the instance URL.`,
      );
    }
    try {
      return normalizeEndpointOrigin(raw);
    } catch (error) {
      translateAppError(error);
    }
  }
  if (raw !== undefined) {
    throw new ConnectorCredentialError(
      'CREDENTIAL_ENDPOINT_INVALID',
      `Connector "${connector.name}" has a fixed endpoint — a per-credential endpoint URL does not apply here.`,
    );
  }
  return undefined;
}

/** Validate the connector's non-secret per-credential config against its
 * declared `configFields` (0.4 `normalizeConfig` semantics). */
function normalizeConfig(
  connector: Connector,
  raw: Record<string, string | number | boolean> | undefined,
): Record<string, string | number | boolean> | undefined {
  const fields = connector.configFields;
  if (fields.length === 0) {
    if (raw !== undefined && Object.keys(raw).length > 0) {
      throw new ConnectorCredentialError(
        'CREDENTIAL_CONFIG_INVALID',
        `Connector "${connector.name}" takes no per-credential settings.`,
      );
    }
    return undefined;
  }
  const supplied = raw ?? {};
  const declared = new Set(fields.map((f) => f.key));
  for (const key of Object.keys(supplied)) {
    if (!declared.has(key)) {
      throw new ConnectorCredentialError(
        'CREDENTIAL_CONFIG_INVALID',
        `Connector "${connector.name}" has no setting "${key}".`,
      );
    }
  }
  const out: Record<string, string | number | boolean> = {};
  for (const field of fields) {
    const provided = supplied[field.key];
    const value = provided ?? field.default;
    if (value === undefined || value === '') {
      if (field.required) {
        throw new ConnectorCredentialError(
          'CREDENTIAL_CONFIG_REQUIRED',
          `Connector "${connector.name}" needs "${field.label}".`,
        );
      }
      continue;
    }
    if (field.type === 'number') {
      const n = typeof value === 'number' ? value : Number(value);
      if (!Number.isFinite(n)) {
        throw new ConnectorCredentialError(
          'CREDENTIAL_CONFIG_INVALID',
          `"${field.label}" must be a number.`,
        );
      }
      out[field.key] = n;
      continue;
    }
    if (field.type === 'boolean') {
      out[field.key] =
        typeof value === 'boolean' ? value : String(value) === 'true';
      continue;
    }
    const s = String(value);
    if (field.enum !== undefined && !field.enum.includes(s)) {
      throw new ConnectorCredentialError(
        'CREDENTIAL_CONFIG_INVALID',
        `"${field.label}" must be one of: ${field.enum.join(', ')}.`,
      );
    }
    out[field.key] = s;
  }
  return out;
}

export interface SecretInput {
  token?: string;
  username?: string;
  password?: string;
  smtpUsername?: string;
  smtpPassword?: string;
  accessToken?: string;
  refreshToken?: string;
  expiresAt?: number;
  scopes?: string[];
}

/** Assemble + validate the method's secret payload (0.4 `buildPayload`). */
function buildPayload(
  authMethod: AuthMethod,
  input: SecretInput,
): ConnectorSecretPayload {
  const raw: Record<string, unknown> = (() => {
    switch (authMethod) {
      case 'api-key':
      case 'bearer':
        return {
          token:
            input.token === undefined
              ? undefined
              : normalizeSecretValue(input.token, 'The token'),
        };
      case 'basic':
        return {
          username: input.username?.trim(),
          password:
            input.password === undefined
              ? undefined
              : normalizeSecretValue(input.password, 'The password'),
          ...(input.smtpUsername !== undefined ||
          input.smtpPassword !== undefined
            ? {
                smtpUsername: input.smtpUsername?.trim(),
                smtpPassword:
                  input.smtpPassword === undefined
                    ? undefined
                    : normalizeSecretValue(
                        input.smtpPassword,
                        'The SMTP password',
                      ),
              }
            : {}),
        };
      case 'oauth2':
        return {
          accessToken:
            input.accessToken === undefined
              ? undefined
              : normalizeSecretValue(input.accessToken, 'The access token'),
          ...(input.refreshToken !== undefined && {
            refreshToken: normalizeSecretValue(
              input.refreshToken,
              'The refresh token',
            ),
          }),
          ...(input.expiresAt !== undefined && { expiresAt: input.expiresAt }),
          ...(input.scopes !== undefined && { scopes: input.scopes }),
        };
      default: {
        const _exhaustive: never = authMethod;
        return _exhaustive;
      }
    }
  })();
  for (const key of Object.keys(raw)) {
    if (raw[key] === undefined) delete raw[key];
  }
  try {
    return parseSecretPayload(authMethod, raw);
  } catch (err) {
    if (err instanceof SecretPayloadError) {
      throw new ConnectorCredentialError(
        'CREDENTIAL_SECRET_INVALID',
        err.message,
      );
    }
    throw err;
  }
}

/** Encrypt a validated payload and compute its non-secret preview. */
function sealPayload(payload: ConnectorSecretPayload): {
  encryptedData: EncryptedSecret;
  maskedPreview?: string;
} {
  const { authMethod: _method, ...document } = payload;
  const maskedPreview = maskPayload(payload);
  return {
    encryptedData: encryptSecret(JSON.stringify(document)),
    ...(maskedPreview !== undefined && { maskedPreview }),
  };
}

async function rowsForConnector(
  db: Db,
  organizationId: string,
  connectorSlug: string,
): Promise<CredentialRow[]> {
  return db<CredentialRow[]>`
    SELECT ${db.unsafe(CREDENTIAL_COLUMNS)} FROM app.connector_credentials
    WHERE org_id = ${organizationId} AND connector_slug = ${connectorSlug}
  `;
}

async function requireOwnRow(
  db: Db,
  organizationId: string,
  credentialId: string,
): Promise<CredentialRow> {
  const rows = await db<CredentialRow[]>`
    SELECT ${db.unsafe(CREDENTIAL_COLUMNS)} FROM app.connector_credentials
    WHERE id = ${credentialId} AND org_id = ${organizationId} LIMIT 1
  `;
  const row = rows[0];
  if (!row) {
    throw new ConnectorCredentialError(
      'CREDENTIAL_NOT_FOUND',
      'Credential not found.',
      404,
    );
  }
  return row;
}

function assertNameFree(
  rows: readonly CredentialRow[],
  name: string,
  excludeId?: string,
): void {
  const needle = name.toLowerCase();
  const clash = rows.find(
    (row) => row.id !== excludeId && row.name.toLowerCase() === needle,
  );
  if (clash) {
    throw new ConnectorCredentialError(
      'CREDENTIAL_NAME_TAKEN',
      `A credential named "${clash.name}" already exists for this connector — pick a different name.`,
      409,
    );
  }
}

async function clearOtherDefaults(
  tx: TransactionSql,
  organizationId: string,
  connectorSlug: string,
  keepId: string | null,
): Promise<void> {
  await tx`
    UPDATE app.connector_credentials
    SET is_default = false, updated_at_ms = ${Date.now()}
    WHERE org_id = ${organizationId} AND connector_slug = ${connectorSlug}
      AND is_default AND (${keepId ?? null}::text IS NULL OR id <> ${keepId})
  `;
}

export interface MaskedCredential {
  id: string;
  connectorSlug: string;
  authMethod: AuthMethod;
  name: string;
  endpointUrl?: string;
  config?: Record<string, string | number | boolean>;
  maskedPreview?: string;
  isDefault: boolean;
  status: CredentialStatus;
  statusDetail?: string;
  createdAt: number;
  updatedAt: number;
}

function toMasked(row: CredentialRow): MaskedCredential {
  return {
    id: row.id,
    connectorSlug: row.connectorSlug,
    authMethod: row.authMethod,
    name: row.name,
    ...(row.endpointUrl !== null ? { endpointUrl: row.endpointUrl } : {}),
    ...(row.config !== null ? { config: row.config } : {}),
    ...(row.maskedPreview !== null ? { maskedPreview: row.maskedPreview } : {}),
    isDefault: row.isDefault,
    status: row.status,
    ...(row.statusDetail !== null ? { statusDetail: row.statusDetail } : {}),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt,
  };
}

/** The organization's credentials, masked, connector-then-name ordered. */
export async function listCredentials(
  sql: Sql,
  organizationId: string,
  connectorSlug?: string,
): Promise<MaskedCredential[]> {
  const rows = await sql<CredentialRow[]>`
    SELECT ${sql.unsafe(CREDENTIAL_COLUMNS)} FROM app.connector_credentials
    WHERE org_id = ${organizationId}
      AND (${connectorSlug ?? null}::text IS NULL
        OR connector_slug = ${connectorSlug ?? null})
    ORDER BY connector_slug ASC, name ASC
  `;
  return rows.map(toMasked);
}

export async function getCredential(
  sql: Sql,
  organizationId: string,
  credentialId: string,
): Promise<MaskedCredential> {
  return toMasked(await requireOwnRow(sql, organizationId, credentialId));
}

export interface CreateCredentialArgs {
  organizationId: string;
  connectorSlug: string;
  authMethod: AuthMethod;
  name: string;
  secret: SecretInput;
  endpointUrl?: string;
  config?: Record<string, string | number | boolean>;
  isDefault?: boolean;
  createdBy: string;
}

/** Create one credential: connector must offer the method; the pair's FIRST
 * credential becomes its default; `isDefault: true` promotes this one. */
export async function createCredential(
  sql: Sql,
  args: CreateCredentialArgs,
): Promise<{ credentialId: string }> {
  const prepared = prepareCredential(args);
  return sql.begin((tx) => insertPreparedCredential(tx, args, prepared));
}

/**
 * {@link createCredential} on a transaction the CALLER owns — for a flow
 * whose credential must commit together with another write, or not at all.
 * The connector OAuth callback claims the Slack workspace in the same
 * transaction: a lost claim then rolls the credential back instead of
 * leaving a foreign workspace's live token stored as this organization's
 * default. Validation and sealing still run before the first statement.
 */
export async function createCredentialInTransaction(
  tx: TransactionSql,
  args: CreateCredentialArgs,
): Promise<{ credentialId: string }> {
  return insertPreparedCredential(tx, args, prepareCredential(args));
}

interface PreparedCredential {
  endpointUrl: ReturnType<typeof normalizeEndpointUrl>;
  config: Record<string, string | number | boolean> | undefined;
  name: string;
  sealed: ReturnType<typeof sealPayload>;
}

/** Everything that can refuse a new credential, before any statement. */
function prepareCredential(args: CreateCredentialArgs): PreparedCredential {
  const connector = requireConnectorAuthMethod(
    args.connectorSlug,
    args.authMethod,
  );
  const endpointUrl = normalizeEndpointUrl(connector, args.endpointUrl);
  let config: Record<string, string | number | boolean> | undefined;
  try {
    config = withImapFromAddress(
      args.connectorSlug,
      normalizeConfig(connector, args.config),
      args.secret.username,
    );
  } catch (error) {
    translateAppError(error);
  }
  return {
    endpointUrl,
    config,
    name: normalizeName(args.name),
    sealed: sealPayload(buildPayload(args.authMethod, args.secret)),
  };
}

async function insertPreparedCredential(
  tx: TransactionSql,
  args: CreateCredentialArgs,
  prepared: PreparedCredential,
): Promise<{ credentialId: string }> {
  const siblings = await rowsForConnector(
    tx,
    args.organizationId,
    args.connectorSlug,
  );
  assertNameFree(siblings, prepared.name);
  const isDefault = args.isDefault ?? siblings.length === 0;
  if (isDefault) {
    await clearOtherDefaults(tx, args.organizationId, args.connectorSlug, null);
  }
  const now = Date.now();
  const inserted = await tx<{ id: string }[]>`
    INSERT INTO app.connector_credentials (
      org_id, connector_slug, auth_method, name, encrypted_data,
      endpoint_url, config, masked_preview, is_default, status,
      created_by, created_at_ms, updated_at_ms
    ) VALUES (
      ${args.organizationId}, ${args.connectorSlug}, ${args.authMethod},
      ${prepared.name}, ${tx.json(toJson(prepared.sealed.encryptedData))},
      ${prepared.endpointUrl ?? null},
      ${prepared.config === undefined ? null : tx.json(toJson(prepared.config))},
      ${prepared.sealed.maskedPreview ?? null}, ${isDefault}, 'active',
      ${args.createdBy}, ${now}, ${now}
    )
    RETURNING id
  `;
  const credentialId = inserted[0]?.id;
  if (!credentialId) throw new Error('credential insert failed');
  return { credentialId };
}

export interface UpdateCredentialArgs {
  organizationId: string;
  credentialId: string;
  name?: string;
  secret?: SecretInput;
  endpointUrl?: string;
  config?: Record<string, string | number | boolean>;
  status?: CredentialStatus;
  statusDetail?: string | null;
  isDefault?: boolean;
}

/** Update one credential; a secret replacement is validated against the
 * row's EXISTING method and re-sealed whole. */
export async function updateCredential(
  sql: Sql,
  args: UpdateCredentialArgs,
): Promise<void> {
  await sql.begin(async (tx) => {
    const row = await requireOwnRow(tx, args.organizationId, args.credentialId);
    const connector = requireConnectorAuthMethod(
      row.connectorSlug,
      row.authMethod,
    );

    let name = row.name;
    if (args.name !== undefined) {
      name = normalizeName(args.name);
      const siblings = await rowsForConnector(
        tx,
        args.organizationId,
        row.connectorSlug,
      );
      assertNameFree(siblings, name, row.id);
    }
    let sealed: ReturnType<typeof sealPayload> | undefined;
    if (args.secret !== undefined) {
      sealed = sealPayload(buildPayload(row.authMethod, args.secret));
    }
    let endpointUrl = row.endpointUrl;
    if (args.endpointUrl !== undefined) {
      endpointUrl = normalizeEndpointUrl(connector, args.endpointUrl) ?? null;
    }
    let config = row.config;
    if (args.config !== undefined) {
      try {
        config =
          withImapFromAddress(
            row.connectorSlug,
            normalizeConfig(connector, args.config),
            args.secret?.username,
          ) ?? null;
      } catch (error) {
        translateAppError(error);
      }
    }
    if (args.isDefault === true) {
      await clearOtherDefaults(
        tx,
        args.organizationId,
        row.connectorSlug,
        row.id,
      );
    }
    await tx`
      UPDATE app.connector_credentials SET
        name = ${name},
        encrypted_data = ${sealed !== undefined ? tx.json(toJson(sealed.encryptedData)) : tx.unsafe('encrypted_data')},
        masked_preview = ${sealed !== undefined ? (sealed.maskedPreview ?? null) : tx.unsafe('masked_preview')},
        endpoint_url = ${endpointUrl},
        config = ${config === null ? null : tx.json(toJson(config))},
        status = ${args.status ?? tx.unsafe('status')},
        status_detail = ${args.statusDetail !== undefined ? args.statusDetail : tx.unsafe('status_detail')},
        is_default = ${args.isDefault ?? tx.unsafe('is_default')},
        updated_at_ms = ${Date.now()}
      WHERE id = ${row.id}
    `;
  });
}

/** Delete a credential; deleting the DEFAULT promotes the oldest remaining
 * ACTIVE row of the pair (never a disabled one). */
export async function deleteCredential(
  sql: Sql,
  organizationId: string,
  credentialId: string,
): Promise<void> {
  await sql.begin(async (tx) => {
    const row = await requireOwnRow(tx, organizationId, credentialId);
    await tx`DELETE FROM app.connector_credentials WHERE id = ${row.id}`;
    if (!row.isDefault) return;
    const successors = await tx<{ id: string }[]>`
      SELECT id FROM app.connector_credentials
      WHERE org_id = ${organizationId}
        AND connector_slug = ${row.connectorSlug} AND status = 'active'
      ORDER BY created_at_ms ASC, id ASC
      LIMIT 1
    `;
    const successor = successors[0];
    if (successor) {
      await tx`
        UPDATE app.connector_credentials
        SET is_default = true, updated_at_ms = ${Date.now()}
        WHERE id = ${successor.id}
      `;
    }
  });
}

/** Make one credential its pair's default (active rows only). */
export async function setDefaultCredential(
  sql: Sql,
  organizationId: string,
  credentialId: string,
): Promise<void> {
  await sql.begin(async (tx) => {
    const row = await requireOwnRow(tx, organizationId, credentialId);
    if (row.status === 'disabled') {
      throw new ConnectorCredentialError(
        'CREDENTIAL_DISABLED',
        `Credential "${row.name}" is disabled — enable it before making it the default.`,
      );
    }
    if (row.status === 'needs-reauth') {
      throw new ConnectorCredentialError(
        'CREDENTIAL_NEEDS_REAUTH',
        `Credential "${row.name}" needs to be reconnected before it can be the default.`,
      );
    }
    await clearOtherDefaults(tx, organizationId, row.connectorSlug, row.id);
    if (!row.isDefault) {
      await tx`
        UPDATE app.connector_credentials
        SET is_default = true, updated_at_ms = ${Date.now()}
        WHERE id = ${row.id}
      `;
    }
  });
}

// -------------------------------------------------------------- resolution

export interface ResolvedConnectorCredential {
  credentialId: string;
  connectorSlug: string;
  authMethod: AuthMethod;
  secrets: Record<string, string>;
  endpoint?: string;
  config: Record<string, string | number | boolean>;
  authHeader?: string;
}

/** The addressed row (explicit id-or-name ref, else the pair's default), or
 * null on a miss — the 0.4 `resolveCredentialRefInternal` contract the work
 * lanes' ctx shim serves to the reused credential broker. */
export async function findCredentialForRef(
  sql: Sql,
  args: {
    organizationId: string;
    connectorSlug: string;
    credentialRef?: string;
  },
): Promise<CredentialRow | null> {
  const rows = await rowsForConnector(
    sql,
    args.organizationId,
    args.connectorSlug,
  );
  if (args.credentialRef === undefined) {
    return rows.find((row) => row.isDefault) ?? null;
  }
  const ref = args.credentialRef.trim();
  const byId = rows.find((row) => row.id === ref);
  if (byId) return byId;
  const needle = ref.toLowerCase();
  return rows.find((row) => row.name.toLowerCase() === needle) ?? null;
}

/**
 * The 0.4 `resolveCredentialRefInternal` answer every reused resolver reads —
 * the work-lane credential broker and the mailbox sync's IMAP fromAddress
 * heal alike: the FULL row including the sealed envelope (the reused resolver
 * decrypts it itself and refuses disabled / needs-reauth rows on `status`), in
 * the 0.4 wire shape where nullable columns are ABSENT fields, never nulls.
 * Null on a miss. Internal-only by contract: it carries sealed secret
 * material and must never reach a client, an agent, or a log.
 *
 * An active oauth2 row passes through the same refresh seam as
 * {@link resolveConnectorCredential} first, so the envelope handed out is the
 * renewed one and a dead grant is already marked `needs-reauth` for the
 * reused resolver to refuse. Best-effort by design: this answer also serves
 * readers that only want the row's config, so a refresh the vendor could not
 * be reached for hands the row back as stored (warned, not thrown) and the
 * invocation fails at the vendor the way it would have anyway.
 */
export async function resolveCredentialRowForShim(
  sql: Sql,
  args: {
    organizationId: string;
    connectorSlug: string;
    credentialRef?: string;
  },
): Promise<Record<string, unknown> | null> {
  let row = await findCredentialForRef(sql, args);
  if (row === null) return null;
  if (row.status === 'active' && row.authMethod === 'oauth2') {
    try {
      row = (await freshenOauth2Row(sql, row, openRowEnvelope(row), {})).row;
    } catch (error) {
      if (!(error instanceof ConnectorCredentialError)) throw error;
      if (error.code === 'CREDENTIAL_NEEDS_REAUTH') {
        // The flip is persisted: the re-read row says so on `status`.
        row = await requireOwnRow(sql, row.organizationId, row.id);
      } else {
        console.warn(
          `[connector-credentials] "${row.connectorSlug}" credential "${row.name}" could not be refreshed (${error.code}); handing it back as stored`,
        );
      }
    }
  }
  return {
    _id: row.id,
    organizationId: row.organizationId,
    connectorSlug: row.connectorSlug,
    authMethod: row.authMethod,
    name: row.name,
    encryptedData: row.encryptedData,
    ...(row.endpointUrl !== null ? { endpointUrl: row.endpointUrl } : {}),
    ...(row.config !== null ? { config: row.config } : {}),
    status: row.status,
    ...(row.statusDetail !== null ? { statusDetail: row.statusDetail } : {}),
  };
}

/** Load the addressed row (explicit id-or-name ref, else the default). */
async function loadRowForResolve(
  sql: Sql,
  args: {
    organizationId: string;
    connectorSlug: string;
    credentialRef?: string;
  },
): Promise<CredentialRow> {
  const row = await findCredentialForRef(sql, args);
  if (row) return row;
  if (args.credentialRef === undefined) {
    throw new ConnectorCredentialError(
      'CREDENTIAL_NONE_CONFIGURED',
      `No default credential is configured for "${args.connectorSlug}" — add one in Settings → Connectors, or name a credential explicitly.`,
      404,
    );
  }
  throw new ConnectorCredentialError(
    'CREDENTIAL_NOT_FOUND',
    `No credential "${args.credentialRef}" is configured for "${args.connectorSlug}" — check the name, or add it in Settings → Connectors.`,
    404,
  );
}

/** Refuse a row the operator or the system took out of service, saying which
 * of the two it was and what fixes it. */
function assertRowUsable(row: CredentialRow): void {
  if (row.status === 'disabled') {
    throw new ConnectorCredentialError(
      'CREDENTIAL_DISABLED',
      `Credential "${row.name}" is disabled — enable it in Settings → Connectors, or name another credential.`,
    );
  }
  if (row.status === 'needs-reauth') {
    throw needsReauthError(row.name, row.connectorSlug, row.statusDetail);
  }
}

function needsReauthError(
  name: string,
  connectorSlug: string,
  statusDetail: string | null,
): ConnectorCredentialError {
  const detail = statusDetail ? ` (${statusDetail})` : '';
  return new ConnectorCredentialError(
    'CREDENTIAL_NEEDS_REAUTH',
    `Credential "${name}" lost its authorization${detail} — reconnect "${connectorSlug}" in Settings → Connectors to restore access.`,
  );
}

/** Decrypt and validate the row's envelope, mapping both failure modes onto
 * actionable refusals instead of a bare crypto or schema error. */
function openRowEnvelope(row: CredentialRow): ConnectorSecretPayload {
  let plaintext: string;
  try {
    plaintext = decryptSecret(row.encryptedData);
  } catch (err) {
    if (err instanceof KeyRotatedError) {
      throw new ConnectorCredentialError(
        'CREDENTIAL_KEY_ROTATED',
        `Credential "${row.name}" was encrypted under a previous ENCRYPTION_SECRET_HEX and cannot be decrypted — re-enter it in Settings → Connectors.`,
      );
    }
    throw err;
  }
  try {
    return parseSecretPayload(row.authMethod, JSON.parse(plaintext));
  } catch (err) {
    if (err instanceof SecretPayloadError || err instanceof SyntaxError) {
      throw new ConnectorCredentialError(
        'CREDENTIAL_SHAPE_INVALID',
        `Credential "${row.name}" does not carry a usable ${row.authMethod} payload — re-enter it in Settings → Connectors.`,
      );
    }
    throw err;
  }
}

/** How long before its declared expiry an access token counts as expired —
 * a token handed out with less than this left would die mid-invocation. */
const OAUTH2_REFRESH_SKEW_MS = 60_000;

/** A refresh the CAS lost is retried against the re-read row this many
 * times before the re-read row is handed out as it stands. */
const OAUTH2_REFRESH_MAX_ATTEMPTS = 2;

/** The seams `resolveConnectorCredential` lets a test (or an integration
 * probe) inject — only the vendor call, never the store. */
export interface ResolveCredentialOptions {
  readonly fetchImpl?: FetchLike;
}

/**
 * Persist that the grant is dead: only a new consent brings the row back,
 * and every listing stops offering it meanwhile. Guarded by the same
 * compare-and-swap on `updated_at_ms` as the refresh write: the verdict is
 * about the envelope that was READ, so a row an operator re-issued (Reconnect
 * stores a fresh grant) or a concurrent refresh renewed in the meantime is
 * not flipped on the strength of a stale token. Answers whether this call
 * wrote the row — false means someone else wrote first and the caller must
 * re-read.
 */
async function markNeedsReauth(
  sql: Sql,
  row: CredentialRow,
  statusDetail: string,
): Promise<boolean> {
  const flipped = await sql<{ id: string }[]>`
    UPDATE app.connector_credentials
    SET status = 'needs-reauth', status_detail = ${statusDetail},
        updated_at_ms = ${Date.now()}
    WHERE id = ${row.id} AND org_id = ${row.organizationId}
      AND updated_at_ms = ${row.updatedAt}
    RETURNING id
  `;
  if (flipped.length === 0) {
    console.warn(
      `[connector-credentials] "${row.connectorSlug}" credential "${row.name}" changed under the refresh for organization ${row.organizationId}; not marking needs-reauth (${statusDetail})`,
    );
    return false;
  }
  console.warn(
    `[connector-credentials] "${row.connectorSlug}" credential "${row.name}" needs re-authorization for organization ${row.organizationId}: ${statusDetail}`,
  );
  return true;
}

/**
 * After a lost compare-and-swap: a concurrent invocation (or an operator
 * edit) wrote the row first, so its envelope is the truth now — read it
 * back and use that, refreshing again only if it too is expired, and hand
 * the re-read row out as it stands once the retry budget is spent.
 */
async function resolveAfterLostCas(
  sql: Sql,
  row: CredentialRow,
  options: ResolveCredentialOptions,
  attempt: number,
): Promise<{ row: CredentialRow; payload: ConnectorSecretPayload }> {
  const current = await requireOwnRow(sql, row.organizationId, row.id);
  assertRowUsable(current);
  const currentPayload = openRowEnvelope(current);
  if (attempt >= OAUTH2_REFRESH_MAX_ATTEMPTS) {
    return { row: current, payload: currentPayload };
  }
  return freshenOauth2Row(sql, current, currentPayload, options, attempt + 1);
}

/**
 * The oauth2 refresh seam. A grant whose access token is expired (or about to
 * be) is renewed from its refresh token BEFORE the material is handed out,
 * and the renewed envelope replaces the stored one under a compare-and-swap
 * on `updated_at_ms` — two invocations refreshing at once cannot both write,
 * and the loser reads what the winner stored instead of overwriting it with a
 * second token. Anything other than an active oauth2 grant with a declared
 * expiry passes through untouched.
 *
 * A vendor that REJECTS the refresh (`invalid_grant`: revoked, expired,
 * consent withdrawn) has ended the grant, so the row is marked `needs-reauth`
 * with the vendor's code and refused — the settings page shows Reconnect. A
 * grant that carries no refresh token cannot be renewed at all and is marked
 * the same way — both marks are under the same CAS, so a row re-issued or
 * renewed meanwhile is re-read instead of flipped. A vendor that could not
 * be reached says nothing about the grant: the row keeps its status and the
 * invocation is refused with a distinct, retryable code.
 */
async function freshenOauth2Row(
  sql: Sql,
  row: CredentialRow,
  payload: ConnectorSecretPayload,
  options: ResolveCredentialOptions,
  attempt = 1,
): Promise<{ row: CredentialRow; payload: ConnectorSecretPayload }> {
  if (
    payload.authMethod !== 'oauth2' ||
    payload.expiresAt === undefined ||
    payload.expiresAt - OAUTH2_REFRESH_SKEW_MS > Date.now()
  ) {
    return { row, payload };
  }

  if (payload.refreshToken === undefined) {
    const statusDetail =
      'the access token expired and the grant carries no refresh token';
    if (!(await markNeedsReauth(sql, row, statusDetail))) {
      return resolveAfterLostCas(sql, row, options, attempt);
    }
    throw needsReauthError(row.name, row.connectorSlug, statusDetail);
  }

  const oauth2 = loadConnectorDefinitions()
    .find((entry) => entry.name === row.connectorSlug)
    ?.auth.find((entry) => entry.method === 'oauth2');
  if (oauth2 === undefined) {
    throw new ConnectorCredentialError(
      'CREDENTIAL_REFRESH_FAILED',
      `Credential "${row.name}" holds an expired access token and "${row.connectorSlug}" declares no OAuth token endpoint to renew it from.`,
    );
  }
  const app = await resolveConnectorOauthApp(
    sql,
    row.organizationId,
    row.connectorSlug,
  );
  if (app === null) {
    const prefix = oauthAppEnvPrefix(row.connectorSlug);
    throw new ConnectorCredentialError(
      'CREDENTIAL_REFRESH_FAILED',
      `Credential "${row.name}" holds an expired access token and no OAuth app is configured for "${row.connectorSlug}" to renew it — configure one under Settings → Connectors, or set ${prefix}CLIENT_ID and ${prefix}CLIENT_SECRET on the deployment.`,
    );
  }

  const refreshed = await refreshAccessToken(
    {
      tokenUrl: applyMicrosoftTenant(oauth2.tokenUrl, app.tenantId),
      refreshToken: payload.refreshToken,
      clientId: app.clientId,
      clientSecret: app.clientSecret,
    },
    options.fetchImpl,
  );
  if (!refreshed.ok) {
    if (refreshed.reason === 'vendor_rejected') {
      const statusDetail = refreshed.code
        ? `the vendor rejected the token refresh: ${refreshed.code}`
        : 'the vendor rejected the token refresh';
      if (!(await markNeedsReauth(sql, row, statusDetail))) {
        return resolveAfterLostCas(sql, row, options, attempt);
      }
      throw needsReauthError(row.name, row.connectorSlug, statusDetail);
    }
    console.warn(
      `[connector-credentials] "${row.connectorSlug}" credential "${row.name}" refresh did not complete for organization ${row.organizationId}: ${refreshed.reason}`,
    );
    throw new ConnectorCredentialError(
      'CREDENTIAL_REFRESH_FAILED',
      `Credential "${row.name}" holds an expired access token and the "${row.connectorSlug}" token endpoint ${
        refreshed.reason === 'vendor_unreachable'
          ? 'could not be reached'
          : 'answered without a usable token'
      } — try again shortly.`,
    );
  }

  // The vendor may omit the refresh token (Google keeps the old one valid) or
  // rotate it (Microsoft); keep whichever is current. Scopes are the grant's,
  // not the refresh answer's, unless the vendor restates them.
  const { tokens } = refreshed;
  const scopes = tokens.scopes.length > 0 ? tokens.scopes : payload.scopes;
  const next = parseSecretPayload('oauth2', {
    accessToken: tokens.accessToken,
    refreshToken: tokens.refreshToken ?? payload.refreshToken,
    ...(tokens.expiresAt !== undefined && { expiresAt: tokens.expiresAt }),
    ...(scopes !== undefined && { scopes }),
  });
  const sealed = sealPayload(next);
  const written = await sql<CredentialRow[]>`
    UPDATE app.connector_credentials
    SET encrypted_data = ${sql.json(toJson(sealed.encryptedData))},
        masked_preview = ${sealed.maskedPreview ?? null},
        updated_at_ms = ${Date.now()}
    WHERE id = ${row.id} AND org_id = ${row.organizationId}
      AND updated_at_ms = ${row.updatedAt}
    RETURNING ${sql.unsafe(CREDENTIAL_COLUMNS)}
  `;
  const stored = written[0];
  if (stored !== undefined) {
    return { row: stored, payload: next };
  }

  return resolveAfterLostCas(sql, row, options, attempt);
}

/**
 * Resolve one (org, connector[, credential]) selection to the material an
 * invocation runs with — the ONE decrypt seam. An expired oauth2 grant is
 * renewed on the way through ({@link freshenOauth2Row}), so what comes back
 * is always a live token or a coded refusal. Internal-only by contract:
 * callers keep the result out of logs and client responses.
 */
export async function resolveConnectorCredential(
  sql: Sql,
  args: {
    organizationId: string;
    connectorSlug: string;
    credentialRef?: string;
  },
  options: ResolveCredentialOptions = {},
): Promise<ResolvedConnectorCredential> {
  const loaded = await loadRowForResolve(sql, args);
  assertRowUsable(loaded);
  const { row, payload } = await freshenOauth2Row(
    sql,
    loaded,
    openRowEnvelope(loaded),
    options,
  );

  const connector = loadConnectorDefinitions().find(
    (entry) => entry.name === row.connectorSlug,
  );
  const authHeader = buildAuthHeader(
    payload,
    connector ? connectorBearerScheme(connector) : undefined,
  );
  return {
    credentialId: row.id,
    connectorSlug: row.connectorSlug,
    authMethod: row.authMethod,
    secrets: buildSecretBindings(payload),
    config: row.config ?? {},
    ...(row.endpointUrl !== null ? { endpoint: row.endpointUrl } : {}),
    ...(authHeader !== undefined ? { authHeader } : {}),
  };
}

/** Active credentials for one connector — the mailbox-sync fan-out list. */
export async function listActiveCredentials(
  sql: Sql,
  organizationId: string,
  connectorSlug: string,
): Promise<
  {
    id: string;
    name: string;
    isDefault: boolean;
    config: Record<string, string | number | boolean> | null;
    mailSyncInboundSince: number | null;
    mailSyncOutboundSince: number | null;
  }[]
> {
  return sql<
    {
      id: string;
      name: string;
      isDefault: boolean;
      config: Record<string, string | number | boolean> | null;
      mailSyncInboundSince: number | null;
      mailSyncOutboundSince: number | null;
    }[]
  >`
    SELECT id, name, is_default AS "isDefault", config,
           mail_sync_inbound_since_ms::float8 AS "mailSyncInboundSince",
           mail_sync_outbound_since_ms::float8 AS "mailSyncOutboundSince"
    FROM app.connector_credentials
    WHERE org_id = ${organizationId} AND connector_slug = ${connectorSlug}
      AND status = 'active'
    ORDER BY created_at_ms ASC
  `;
}

/** The connectors this organization can actually invoke — distinct slugs
 * holding at least one ACTIVE credential (disabled/needs-reauth ones cannot
 * serve a run). The equipment pickers list exactly this set: a granted slug
 * resolves its default credential at dispatch. */
export async function listConnectedConnectorSlugs(
  sql: Sql,
  organizationId: string,
): Promise<string[]> {
  const rows = await sql<{ connectorSlug: string }[]>`
    SELECT DISTINCT connector_slug AS "connectorSlug"
    FROM app.connector_credentials
    WHERE org_id = ${organizationId} AND status = 'active'
    ORDER BY connector_slug ASC
  `;
  return rows.map((row) => row.connectorSlug);
}

/** Advance a credential's mail-sync watermarks (the sync pass's cursor). */
export async function patchMailSyncWatermarks(
  sql: Sql,
  organizationId: string,
  credentialId: string,
  patch: { inboundSince?: number; outboundSince?: number },
): Promise<void> {
  await sql`
    UPDATE app.connector_credentials SET
      mail_sync_inbound_since_ms = coalesce(
        ${patch.inboundSince ?? null}, mail_sync_inbound_since_ms),
      mail_sync_outbound_since_ms = coalesce(
        ${patch.outboundSince ?? null}, mail_sync_outbound_since_ms),
      updated_at_ms = ${Date.now()}
    WHERE id = ${credentialId} AND org_id = ${organizationId}
  `;
}

/**
 * The mailbox sync's config heal (the IMAP `fromAddress` mirror): the caller
 * derived the whole config from the row's own resolved config plus a login
 * address it validated, so it is written as given — a system seam, not the
 * user door, hence no per-field normalization — scoped to the org like the
 * watermark patch.
 */
export async function patchCredentialConfigInternal(
  sql: Sql,
  organizationId: string,
  credentialId: string,
  config: Record<string, string | number | boolean>,
): Promise<void> {
  await sql`
    UPDATE app.connector_credentials SET
      config = ${sql.json(toJson(config))},
      updated_at_ms = ${Date.now()}
    WHERE id = ${credentialId} AND org_id = ${organizationId}
  `;
}
