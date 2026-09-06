import type { Sql, TransactionSql } from 'postgres';

import { resolveMicrosoftCloudImportTenantId } from '../../core/cloud_import/deployment_config.ts';
import {
  refreshGoogleAccessToken,
  refreshMicrosoftAccessToken,
  type TokenRefreshResult,
} from '../../core/cloud_import/token_refresh.ts';
import {
  parseSecretPayload,
  type ConnectorSecretPayload,
} from '../../core/connector_credentials/auth_injection.ts';
import { OAUTH_STATE_TTL_MS } from '../../core/http_connectors/oauth_state.ts';
import {
  decryptSecret,
  encryptSecret,
  KeyRotatedError,
  type EncryptedSecret,
} from '../../core/lib/secret_box.ts';
import { toJson } from '../../db/sql.ts';
import { resolveCloudImportApp } from '../connectors/oauth-apps.ts';

/**
 * Cloud-import grants — the 0.5 twin of `convex/cloud_import`: per
 * (org, user, provider) OAuth2 authorizations for Knowledge Documents
 * import/sync, sealed with the same secret-box envelope connector
 * credentials use. Intentional grants, never org connector credentials,
 * never agent-resolvable — every read is (org, user)-scoped.
 */

export type CloudImportProvider = 'onedrive' | 'google-drive';
const PROVIDERS = new Set<string>(['onedrive', 'google-drive']);
const REFRESH_BUFFER_MS = 5 * 60 * 1000;
const EXPIRED_SWEEP_LIMIT = 20;

export function isCloudImportProvider(
  value: string,
): value is CloudImportProvider {
  return PROVIDERS.has(value);
}

export type ResolveCloudTokenResult =
  | { success: true; accessToken: string }
  | { success: false; error: string; needsReauth?: boolean };

// ------------------------------------------------------------ oauth state

export async function createPendingCloudAuthorization(
  sql: Sql,
  args: {
    stateHash: string;
    organizationId: string;
    userId: string;
    provider: CloudImportProvider;
    codeVerifier: string;
    redirectUri: string;
  },
): Promise<void> {
  const now = Date.now();
  await sql.begin(async (tx) => {
    // Lazy sweep of expired states (feedback_lazy_cleanup_over_cron).
    await tx`
      DELETE FROM app.cloud_import_oauth_states
      WHERE id IN (
        SELECT id FROM app.cloud_import_oauth_states
        WHERE expires_at_ms < ${now}
        LIMIT ${EXPIRED_SWEEP_LIMIT}
      )
    `;
    await tx`
      INSERT INTO app.cloud_import_oauth_states (
        state_hash, org_id, user_id, provider, code_verifier, redirect_uri,
        created_at_ms, expires_at_ms
      ) VALUES (
        ${args.stateHash}, ${args.organizationId}, ${args.userId},
        ${args.provider}, ${args.codeVerifier}, ${args.redirectUri},
        ${now}, ${now + OAUTH_STATE_TTL_MS}
      )
    `;
  });
}

export type ConsumedCloudState =
  | {
      ok: true;
      organizationId: string;
      userId: string;
      provider: CloudImportProvider;
      codeVerifier: string;
      redirectUri: string;
    }
  | { ok: false; reason: 'unknown' | 'expired' };

/** One-shot consume: the row is deleted whether live or expired. */
export async function consumePendingCloudAuthorization(
  sql: Sql,
  stateHash: string,
): Promise<ConsumedCloudState> {
  return sql.begin(async (tx) => {
    const rows = await tx<
      {
        id: string;
        organizationId: string;
        userId: string;
        provider: CloudImportProvider;
        codeVerifier: string;
        redirectUri: string;
        expiresAt: number;
      }[]
    >`
      SELECT id, org_id AS "organizationId", user_id AS "userId", provider,
             code_verifier AS "codeVerifier", redirect_uri AS "redirectUri",
             expires_at_ms::float8 AS "expiresAt"
      FROM app.cloud_import_oauth_states
      WHERE state_hash = ${stateHash}
      LIMIT 1
      FOR UPDATE
    `;
    const row = rows[0];
    if (!row) return { ok: false, reason: 'unknown' };
    await tx`
      DELETE FROM app.cloud_import_oauth_states WHERE id = ${row.id}
    `;
    if (row.expiresAt <= Date.now()) {
      return { ok: false, reason: 'expired' };
    }
    return {
      ok: true,
      organizationId: row.organizationId,
      userId: row.userId,
      provider: row.provider,
      codeVerifier: row.codeVerifier,
      redirectUri: row.redirectUri,
    };
  });
}

// ------------------------------------------------------------------ grants

async function upsertAuthorization(
  db: Sql | TransactionSql,
  args: {
    organizationId: string;
    userId: string;
    provider: CloudImportProvider;
    encryptedData: EncryptedSecret;
    scopes: string[];
    accountLabel?: string;
  },
): Promise<void> {
  const now = Date.now();
  await db`
    INSERT INTO app.user_cloud_authorizations (
      org_id, user_id, provider, encrypted_data, scopes, account_label,
      status, created_at_ms, updated_at_ms
    ) VALUES (
      ${args.organizationId}, ${args.userId}, ${args.provider},
      ${db.json(toJson(args.encryptedData))}, ${args.scopes},
      ${args.accountLabel ?? null}, 'active', ${now}, ${now}
    )
    ON CONFLICT (org_id, user_id, provider) DO UPDATE SET
      encrypted_data = EXCLUDED.encrypted_data,
      scopes = EXCLUDED.scopes,
      account_label = coalesce(
        EXCLUDED.account_label, app.user_cloud_authorizations.account_label
      ),
      status = 'active',
      updated_at_ms = ${now}
  `;
}

/** Seal + upsert one grant (the 0.4 `storeAuthorization` twin). */
export async function storeCloudAuthorization(
  sql: Sql,
  args: {
    organizationId: string;
    userId: string;
    provider: CloudImportProvider;
    accessToken: string;
    refreshToken?: string;
    expiresAt?: number;
    scopes: string[];
    accountLabel?: string;
  },
): Promise<void> {
  const payload = parseSecretPayload('oauth2', {
    accessToken: args.accessToken,
    ...(args.refreshToken !== undefined
      ? { refreshToken: args.refreshToken }
      : {}),
    ...(args.expiresAt !== undefined ? { expiresAt: args.expiresAt } : {}),
    scopes: args.scopes,
  });
  const { authMethod: _method, ...document } = payload;
  const encryptedData = encryptSecret(JSON.stringify(document));
  await upsertAuthorization(sql, {
    organizationId: args.organizationId,
    userId: args.userId,
    provider: args.provider,
    encryptedData,
    scopes: args.scopes,
    ...(args.accountLabel !== undefined
      ? { accountLabel: args.accountLabel }
      : {}),
  });
}

export interface CloudAuthorizationStatus {
  provider: CloudImportProvider;
  status: 'active' | 'needs-reauth' | 'revoked';
  scopes: string[];
  accountLabel: string | null;
  updatedAt: number;
}

/** Metadata-only listing for the caller's own grants — no secrets. */
export async function listCloudAuthorizations(
  sql: Sql,
  args: { organizationId: string; userId: string },
): Promise<CloudAuthorizationStatus[]> {
  return sql<CloudAuthorizationStatus[]>`
    SELECT provider, status, scopes, account_label AS "accountLabel",
           updated_at_ms::float8 AS "updatedAt"
    FROM app.user_cloud_authorizations
    WHERE org_id = ${args.organizationId} AND user_id = ${args.userId}
  `;
}

export async function markCloudAuthorizationNeedsReauth(
  db: Sql | TransactionSql,
  args: {
    organizationId: string;
    userId: string;
    provider: CloudImportProvider;
  },
): Promise<void> {
  await db`
    UPDATE app.user_cloud_authorizations SET
      status = 'needs-reauth', updated_at_ms = ${Date.now()}
    WHERE org_id = ${args.organizationId} AND user_id = ${args.userId}
      AND provider = ${args.provider}
  `;
}

/** Owner-only revoke: the sealed payload is dropped, not just flagged. */
export async function revokeCloudAuthorization(
  sql: Sql,
  args: {
    organizationId: string;
    userId: string;
    provider: CloudImportProvider;
  },
): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    UPDATE app.user_cloud_authorizations SET
      status = 'revoked',
      encrypted_data = ${sql.json(
        toJson(encryptSecret(JSON.stringify({ revoked: true }))),
      )},
      updated_at_ms = ${Date.now()}
    WHERE org_id = ${args.organizationId} AND user_id = ${args.userId}
      AND provider = ${args.provider} AND status <> 'revoked'
    RETURNING id
  `;
  return rows.length > 0;
}

// ------------------------------------------------------------------ resolve

/**
 * Decrypt a grant and refresh when near expiry — the 0.4
 * `resolveAccessToken` twin. Only for Knowledge paths owned by that user;
 * agents never resolve these rows.
 */
export async function resolveCloudAccessToken(
  sql: Sql,
  args: {
    organizationId: string;
    userId: string;
    provider: CloudImportProvider;
  },
): Promise<ResolveCloudTokenResult> {
  const rows = await sql<{ encryptedData: EncryptedSecret; status: string }[]>`
    SELECT encrypted_data AS "encryptedData", status
    FROM app.user_cloud_authorizations
    WHERE org_id = ${args.organizationId} AND user_id = ${args.userId}
      AND provider = ${args.provider}
    LIMIT 1
  `;
  const row = rows[0];
  if (!row || row.status !== 'active') {
    return {
      success: false,
      error: 'Cloud import is not authorized for this provider',
      needsReauth: true,
    };
  }

  let payload: ConnectorSecretPayload;
  try {
    const plaintext = decryptSecret(row.encryptedData);
    payload = parseSecretPayload('oauth2', JSON.parse(plaintext));
  } catch (error) {
    // An unreadable envelope is a deployment event (a rotated
    // ENCRYPTION_SECRET_HEX, a corrupted row), not a user action — name the
    // cause for the operator, and flag the row so the UI stops calling a
    // grant "connected" that every sync fails on.
    console.error(
      `[cloud-import] stored ${args.provider} authorization for user ${args.userId} in org ${args.organizationId} is unreadable:`,
      error instanceof Error ? error.message : error,
    );
    await markCloudAuthorizationNeedsReauth(sql, args);
    return {
      success: false,
      error:
        error instanceof KeyRotatedError
          ? 'Stored cloud authorization was encrypted under a previous ENCRYPTION_SECRET_HEX and cannot be decrypted — reconnect to continue'
          : 'Stored cloud authorization could not be decrypted — reconnect to continue',
      needsReauth: true,
    };
  }
  if (payload.authMethod !== 'oauth2') {
    return { success: false, error: 'Invalid cloud authorization payload' };
  }

  const needsRefresh =
    payload.expiresAt !== undefined &&
    payload.expiresAt < Date.now() + REFRESH_BUFFER_MS;
  if (!needsRefresh) {
    return { success: true, accessToken: payload.accessToken };
  }

  if (!payload.refreshToken) {
    await markCloudAuthorizationNeedsReauth(sql, args);
    return {
      success: false,
      error: 'Cloud authorization expired — reconnect to continue',
      needsReauth: true,
    };
  }

  const app = await resolveCloudImportApp(
    sql,
    args.organizationId,
    args.provider,
  );
  if (!app) {
    return {
      success: false,
      error: 'Cloud import OAuth app is not configured for this organization',
    };
  }

  let refreshed: TokenRefreshResult;
  if (args.provider === 'onedrive') {
    // An org app refreshes against ITS tenant; the deployment chain only
    // backs the env-app fallback.
    const tenantId = app.tenantId ?? resolveMicrosoftCloudImportTenantId();
    if (!tenantId) {
      return {
        success: false,
        error:
          'Cloud import Microsoft tenant is not configured on this deployment',
      };
    }
    refreshed = await refreshMicrosoftAccessToken({
      refreshToken: payload.refreshToken,
      clientId: app.clientId,
      clientSecret: app.clientSecret,
      tenantId,
    });
  } else {
    refreshed = await refreshGoogleAccessToken({
      refreshToken: payload.refreshToken,
      clientId: app.clientId,
      clientSecret: app.clientSecret,
    });
  }

  if (!refreshed.ok) {
    // Only a dead grant is the user's to fix. A throttle, an outage, or a
    // misconfigured OAuth app is reported and left retryable: the grant
    // stays 'active' and the sync engine's error → retry posture gets its
    // chance on the next scan.
    if (refreshed.kind === 'dead_grant') {
      await markCloudAuthorizationNeedsReauth(sql, args);
      return {
        success: false,
        error: 'Failed to refresh cloud authorization — reconnect to continue',
        needsReauth: true,
      };
    }
    console.warn(
      `[cloud-import] ${args.provider} token refresh unavailable for user ${args.userId} in org ${args.organizationId}: ${refreshed.detail}`,
    );
    return {
      success: false,
      error: `Cloud authorization could not be refreshed right now (${refreshed.detail}) — the next sync retries`,
      needsReauth: false,
    };
  }

  const nextDocument = {
    accessToken: refreshed.tokens.accessToken,
    refreshToken: refreshed.tokens.refreshToken ?? payload.refreshToken,
    ...(refreshed.tokens.expiresAt !== undefined
      ? { expiresAt: refreshed.tokens.expiresAt }
      : {}),
    ...(payload.scopes !== undefined ? { scopes: [...payload.scopes] } : {}),
  };
  await upsertAuthorization(sql, {
    organizationId: args.organizationId,
    userId: args.userId,
    provider: args.provider,
    encryptedData: encryptSecret(JSON.stringify(nextDocument)),
    scopes: payload.scopes !== undefined ? [...payload.scopes] : [],
  });
  return { success: true, accessToken: refreshed.tokens.accessToken };
}
