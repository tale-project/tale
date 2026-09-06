import type { Sql, TransactionSql } from 'postgres';
import { z } from 'zod';

import { resolveCloudImportOauthApp } from '../../core/cloud_import/deployment_config.ts';
import type { CloudImportProvider } from '../../core/cloud_import/types.ts';
import { maskSecret } from '../../core/connector_credentials/masking.ts';
import { resolveOauthAppCredentials } from '../../core/http_connectors/deployment_config.ts';
import {
  decryptSecret,
  encryptSecret,
  type EncryptedSecret,
} from '../../core/lib/secret_box.ts';
import { toJson } from '../../db/sql.ts';
import { createAuditLog } from '../audit_logs/service.ts';

/**
 * Org-level connector OAuth apps — the org's OWN registration with a vendor,
 * stored in `app.connector_oauth_apps` (client secret sealed in a
 * `secret_box` envelope) and resolved BEFORE the deployment's
 * `CONNECTOR_OAUTH_<SLUG>_*` / `CLOUD_IMPORT_*` env vars. The env vars stay
 * the deployment-wide default; an org row overrides them for that org only,
 * which is what lets orgs on a multi-org deployment bring their own vendor
 * apps (the capability the pre-#2857 integrations system had).
 *
 * Rows are keyed by the OAuth surface's slug: a connector slug, or the
 * Knowledge cloud-import provider `onedrive`. `google-drive` serves both the
 * connector lane and cloud-import — one vendor app, two registered redirect
 * URIs. Slack is deliberately NOT org-configurable: its inbound Events
 * signature check runs before any org is known.
 */

/** Knowledge cloud-import providers map onto oauth-app slugs 1:1 today —
 * `google-drive` shares the connector's row, `onedrive` has its own. */
export const CLOUD_IMPORT_APP_SLUGS: Record<CloudImportProvider, string> = {
  'google-drive': 'google-drive',
  onedrive: 'onedrive',
};

export class OauthAppError extends Error {
  readonly code: string;
  readonly status: 400 | 403 | 404 | 409;

  constructor(
    code: string,
    message: string,
    status: 400 | 403 | 404 | 409 = 400,
  ) {
    super(message);
    this.name = 'OauthAppError';
    this.code = code;
    this.status = status;
  }
}

export interface OauthAppActor {
  userId: string;
  email?: string;
  role?: string;
}

/** The list/detail shape — never carries the secret. */
export interface OauthAppView {
  slug: string;
  clientId: string;
  maskedPreview: string | null;
  tenantId: string | null;
  updatedAtMs: number;
}

export interface ResolvedOauthApp {
  clientId: string;
  clientSecret: string;
  /** Microsoft-family directory (tenant) id, org rows only. */
  tenantId?: string;
  source: 'org' | 'env';
}

interface OauthAppRow {
  slug: string;
  clientId: string;
  encryptedData: EncryptedSecret;
  config: { tenantId?: string } | null;
  maskedPreview: string | null;
  updatedAtMs: string | number;
}

const ROW_COLUMNS = `slug, client_id AS "clientId", encrypted_data AS "encryptedData",
  config, masked_preview AS "maskedPreview", updated_at_ms AS "updatedAtMs"`;

function toView(row: OauthAppRow): OauthAppView {
  return {
    slug: row.slug,
    clientId: row.clientId,
    maskedPreview: row.maskedPreview,
    tenantId: row.config?.tenantId ?? null,
    updatedAtMs: Number(row.updatedAtMs),
  };
}

type Db = Sql | TransactionSql;

async function readRow(
  sql: Db,
  organizationId: string,
  slug: string,
): Promise<OauthAppRow | null> {
  const rows = await sql<OauthAppRow[]>`
    SELECT ${sql.unsafe(ROW_COLUMNS)} FROM app.connector_oauth_apps
    WHERE org_id = ${organizationId} AND slug = ${slug} LIMIT 1
  `;
  return rows[0] ?? null;
}

export async function listOauthApps(
  sql: Sql,
  organizationId: string,
): Promise<OauthAppView[]> {
  const rows = await sql<OauthAppRow[]>`
    SELECT ${sql.unsafe(ROW_COLUMNS)} FROM app.connector_oauth_apps
    WHERE org_id = ${organizationId} ORDER BY slug
  `;
  return rows.map(toView);
}

async function audit(
  sql: Sql,
  organizationId: string,
  actor: OauthAppActor,
  action: 'connector_oauth_app_configure' | 'connector_oauth_app_removed',
  slug: string,
  newState?: Record<string, unknown>,
): Promise<void> {
  await sql.begin((tx) =>
    createAuditLog(tx, {
      organizationId,
      actorId: actor.userId,
      ...(actor.email !== undefined ? { actorEmail: actor.email } : {}),
      ...(actor.role !== undefined ? { actorRole: actor.role } : {}),
      actorType: 'user',
      action,
      category: 'security',
      resourceType: 'connector_oauth_app',
      resourceId: slug,
      ...(newState !== undefined ? { newState } : {}),
      status: 'success',
    }),
  );
}

/**
 * Create or replace the org's app for one slug. `clientSecret` may be
 * omitted on an update to keep the stored one (the SSO reuse-on-omit
 * contract) — a first configure without a secret is refused.
 */
export async function upsertOauthApp(
  sql: Sql,
  args: {
    organizationId: string;
    slug: string;
    clientId: string;
    clientSecret?: string;
    tenantId?: string;
    actor: OauthAppActor;
    /** Audit marker for credentials copied from another surface rather than
     * typed in — today only the Enterprise SSO reuse flow. */
    copiedFrom?: 'enterprise-sso';
  },
): Promise<OauthAppView> {
  const clientId = args.clientId.trim();
  if (!clientId) {
    throw new OauthAppError('client_id_required', 'Client ID is required.');
  }
  const tenantId = args.tenantId?.trim() || undefined;
  const secret = args.clientSecret?.trim() || undefined;

  const row = await sql.begin(async (tx) => {
    const existing = await readRow(tx, args.organizationId, args.slug);
    let envelope: EncryptedSecret;
    let maskedPreview: string | null;
    if (secret !== undefined) {
      envelope = encryptSecret(JSON.stringify({ clientSecret: secret }));
      maskedPreview = maskSecret(secret) ?? null;
    } else if (existing) {
      envelope = existing.encryptedData;
      maskedPreview = existing.maskedPreview;
    } else {
      throw new OauthAppError(
        'client_secret_required',
        'Client secret is required.',
      );
    }
    const now = Date.now();
    const config = tenantId ? { tenantId } : null;
    const rows = await tx<OauthAppRow[]>`
      INSERT INTO app.connector_oauth_apps (
        org_id, slug, client_id, encrypted_data, config, masked_preview,
        created_by, created_at_ms, updated_at_ms
      ) VALUES (
        ${args.organizationId}, ${args.slug}, ${clientId},
        ${tx.json(toJson(envelope))},
        ${config === null ? null : tx.json(toJson(config))},
        ${maskedPreview}, ${args.actor.userId}, ${now}, ${now}
      )
      ON CONFLICT (org_id, slug) DO UPDATE SET
        client_id = EXCLUDED.client_id,
        encrypted_data = EXCLUDED.encrypted_data,
        config = EXCLUDED.config,
        masked_preview = EXCLUDED.masked_preview,
        updated_at_ms = EXCLUDED.updated_at_ms
      RETURNING ${tx.unsafe(ROW_COLUMNS)}
    `;
    return rows[0];
  });
  if (!row) {
    throw new OauthAppError('write_failed', 'Could not store the OAuth app.');
  }
  await audit(
    sql,
    args.organizationId,
    args.actor,
    'connector_oauth_app_configure',
    args.slug,
    {
      slug: args.slug,
      clientId,
      ...(tenantId ? { tenantId } : {}),
      ...(args.copiedFrom ? { copiedFrom: args.copiedFrom } : {}),
    },
  );
  return toView(row);
}

export async function deleteOauthApp(
  sql: Sql,
  args: { organizationId: string; slug: string; actor: OauthAppActor },
): Promise<boolean> {
  const rows = await sql<{ slug: string }[]>`
    DELETE FROM app.connector_oauth_apps
    WHERE org_id = ${args.organizationId} AND slug = ${args.slug}
    RETURNING slug
  `;
  if (rows.length === 0) return false;
  await audit(
    sql,
    args.organizationId,
    args.actor,
    'connector_oauth_app_removed',
    args.slug,
  );
  return true;
}

const envelopeDocument = z.object({ clientSecret: z.string().min(1) });

function decryptRow(row: OauthAppRow): ResolvedOauthApp | null {
  let clientSecret: string;
  try {
    const parsed = envelopeDocument.safeParse(
      JSON.parse(decryptSecret(row.encryptedData)),
    );
    if (!parsed.success) return null;
    clientSecret = parsed.data.clientSecret;
  } catch (error) {
    console.error(
      `[connectors:oauth-apps] failed to open the secret envelope for "${row.slug}" (${
        error instanceof Error ? error.name : 'unknown'
      })`,
    );
    return null;
  }
  return {
    clientId: row.clientId,
    clientSecret,
    ...(row.config?.tenantId ? { tenantId: row.config.tenantId } : {}),
    source: 'org',
  };
}

/**
 * The connector lane's app for one org: org row first, deployment env
 * second. An org row that cannot be opened (key rotated away) logs and
 * falls THROUGH to env rather than failing the flow closed on a stale row.
 */
export async function resolveConnectorOauthApp(
  sql: Sql,
  organizationId: string,
  connectorSlug: string,
): Promise<ResolvedOauthApp | null> {
  const row = await readRow(sql, organizationId, connectorSlug);
  if (row) {
    const resolved = decryptRow(row);
    if (resolved) return resolved;
  }
  const env = resolveOauthAppCredentials(connectorSlug);
  return env ? { ...env, source: 'env' } : null;
}

/** The Knowledge cloud-import twin: org row (per the slug map) first, then
 * the existing env chain (which itself falls back to the Microsoft login
 * app for `onedrive`). */
export async function resolveCloudImportApp(
  sql: Sql,
  organizationId: string,
  provider: CloudImportProvider,
): Promise<ResolvedOauthApp | null> {
  const row = await readRow(
    sql,
    organizationId,
    CLOUD_IMPORT_APP_SLUGS[provider],
  );
  if (row) {
    const resolved = decryptRow(row);
    if (resolved) return resolved;
  }
  const env = resolveCloudImportOauthApp(provider);
  return env ? { ...env, source: 'env' } : null;
}

/** The cloud-import twin — same org row, but the env half consults the
 * CLOUD_IMPORT_* chain (google-drive's two lanes have different env names,
 * so the lanes report their own truth). */
export async function getCloudImportAppStatus(
  sql: Sql,
  organizationId: string,
  provider: CloudImportProvider,
): Promise<{ configured: boolean; source: 'org' | 'env' | null }> {
  const row = await readRow(
    sql,
    organizationId,
    CLOUD_IMPORT_APP_SLUGS[provider],
  );
  if (row) return { configured: true, source: 'org' };
  if (resolveCloudImportOauthApp(provider) !== null) {
    return { configured: true, source: 'env' };
  }
  return { configured: false, source: null };
}

/**
 * Rewrite a Microsoft authorize/token URL onto the org app's tenant. The
 * catalog ships `/common/` endpoints (multi-tenant); a single-tenant org
 * registration rejects those with AADSTS50194, so the org's `tenantId`
 * replaces the tenant path segment. Non-Microsoft URLs pass through.
 */
export function applyMicrosoftTenant(url: string, tenantId?: string): string {
  if (!tenantId) return url;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return url;
  }
  if (parsed.hostname !== 'login.microsoftonline.com') return url;
  parsed.pathname = parsed.pathname.replace(
    /^\/(common|organizations|consumers)(\/|$)/,
    `/${encodeURIComponent(tenantId)}$2`,
  );
  return parsed.toString();
}
