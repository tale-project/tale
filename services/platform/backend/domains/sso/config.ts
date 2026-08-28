import type { Sql } from 'postgres';

import {
  MAX_FILE_SIZE_BYTES,
  resolveSsoConnectionSecretsFilePath,
  resolveSsoDir,
  SSO_CONNECTION_KEY,
  parseSsoSecretsJson,
  validateSsoConnectionData,
  type SsoConnectionFile,
  type SsoConnectionSecrets,
} from '../../../convex/enterprise_sso/file_utils.ts';
import { readDomainConfigFile } from '../../../convex/lib/config_store/read_domain_file.ts';
import { readFileSafe } from '../../../convex/lib/file_io.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';

/**
 * SSO connection config reads — the 0.5 twin of
 * `enterprise_sso/internal_queries.ts` + `config/file_actions.getConnectionSecrets`.
 *
 * The org's single connection lives on disk (the source of truth):
 *   <orgSlug>/governance/sso/connection.yml           (non-secret config)
 *   <orgSlug>/governance/sso/connection.secrets.json  (plaintext secrets)
 * 0.4 mirrored the non-secret half into `configCache` because V8 readers
 * couldn't touch the filesystem; 0.5 reads the files directly (rule 5 —
 * the mirror existed only for the Convex runtime split), through the SAME
 * shared reader + zod validation, so the on-disk contract is unchanged.
 */

export interface LoadedSsoConnection {
  organizationId: string;
  orgSlug: string;
  config: SsoConnectionFile;
}

export async function readSsoConnection(
  sql: Sql,
  organizationId: string,
): Promise<LoadedSsoConnection | null> {
  const orgSlug = await resolveOrgSlug(sql, organizationId);
  if (!orgSlug) return null;
  const result = await readDomainConfigFile(
    resolveSsoDir(orgSlug),
    SSO_CONNECTION_KEY,
    MAX_FILE_SIZE_BYTES,
    validateSsoConnectionData,
  );
  if (!result.ok) return null;
  return { organizationId, orgSlug, config: result.data };
}

/**
 * The ONLY enabled connection across orgs (single-org deployments). With two
 * or more enabled there is no right answer without org context — return
 * `'ambiguous'`; guessing sent users to another org's IdP.
 */
export async function loadSingleEnabled(
  sql: Sql,
): Promise<LoadedSsoConnection | 'ambiguous' | null> {
  const orgs = await sql<{ id: string }[]>`
    SELECT "id" FROM "organization"
  `;
  let found: LoadedSsoConnection | null = null;
  for (const org of orgs) {
    const conn = await readSsoConnection(sql, org.id);
    if (conn === null || !conn.config.enabled) continue;
    if (found) return 'ambiguous';
    found = conn;
  }
  return found;
}

async function loadConnection(
  sql: Sql,
  organizationId: string | undefined,
): Promise<LoadedSsoConnection | 'ambiguous' | null> {
  return organizationId !== undefined
    ? readSsoConnection(sql, organizationId)
    : loadSingleEnabled(sql);
}

/** The 0.4 `resolveSignInConfig` projection (OIDC/OAuth2, NON-secret). */
export async function resolveSignInConfig(
  sql: Sql,
  organizationId: string | undefined,
): Promise<Record<string, unknown> | 'ambiguous' | null> {
  const conn = await loadConnection(sql, organizationId);
  if (conn === 'ambiguous') return 'ambiguous';
  if (!conn || !conn.config.enabled || !conn.config.oidc) return null;
  const c = conn.config.oidc;
  const p = conn.config.provisioning;
  return {
    organizationId: conn.organizationId,
    providerId: c.providerId,
    issuer: c.issuer,
    authorizationEndpoint: c.authorizationEndpoint,
    tokenEndpoint: c.tokenEndpoint,
    userinfoEndpoint: c.userinfoEndpoint,
    scopes: c.scopes,
    pkce: c.pkce ?? false,
    claimMappings: c.claimMappings,
    domainHint: c.domainHint,
    enableOneDriveAccess: c.enableOneDriveAccess,
    autoProvisionRole: p.autoProvisionRole,
    roleMappingRules: p.roleMappingRules,
    defaultRole: p.defaultRole,
    autoProvisionTeam: p.autoProvisionTeam,
    excludeGroups: p.excludeGroups,
  };
}

export interface ResolvedProvisioning {
  organizationId: string;
  autoProvisionRole: boolean;
  defaultRole: SsoConnectionFile['provisioning']['defaultRole'];
  roleMappingRules: SsoConnectionFile['provisioning']['roleMappingRules'];
  autoProvisionTeam: boolean;
  excludeGroups: string[];
}

/** Provisioning policy regardless of protocol; safe defaults when absent. */
export async function resolveProvisioning(
  sql: Sql,
  organizationId: string,
): Promise<ResolvedProvisioning> {
  const conn = await readSsoConnection(sql, organizationId);
  const p = conn?.config.provisioning;
  return {
    organizationId,
    autoProvisionRole: p?.autoProvisionRole ?? false,
    defaultRole: p?.defaultRole ?? 'member',
    roleMappingRules: p?.roleMappingRules ?? [],
    autoProvisionTeam: p?.autoProvisionTeam ?? false,
    excludeGroups: p?.excludeGroups ?? [],
  };
}

/** The 0.4 `resolveSamlConfig` projection (NON-secret). */
export async function resolveSamlConfig(
  sql: Sql,
  organizationId: string | undefined,
): Promise<Record<string, unknown> | 'ambiguous' | null> {
  const conn = await loadConnection(sql, organizationId);
  if (conn === 'ambiguous') return 'ambiguous';
  if (!conn || !conn.config.enabled || !conn.config.saml) return null;
  const s = conn.config.saml;
  return {
    organizationId: conn.organizationId,
    idpEntityId: s.idpEntityId,
    idpSsoUrl: s.idpSsoUrl,
    idpCertificate: s.idpCertificate,
    spCertificate: s.spCertificate,
    wantAssertionsSigned: s.wantAssertionsSigned,
    wantAssertionsEncrypted: s.wantAssertionsEncrypted,
    attributeMappings: s.attributeMappings,
  };
}

/** The 0.4 `discoverByEmail` routing (deprecated endpoint, kept for parity):
 * domain match wins; else the single enabled connection; else null. */
export async function discoverByEmail(
  sql: Sql,
  email: string,
): Promise<{ organizationId: string; protocol: string } | null> {
  const domain = email.split('@')[1]?.toLowerCase();
  const orgs = await sql<{ id: string }[]>`
    SELECT "id" FROM "organization"
  `;
  let firstEnabled: LoadedSsoConnection | null = null;
  let enabledCount = 0;
  let domainMatch: LoadedSsoConnection | null = null;
  for (const org of orgs) {
    const conn = await readSsoConnection(sql, org.id);
    if (!conn || !conn.config.enabled || !conn.config.protocol) {
      continue;
    }
    enabledCount += 1;
    firstEnabled ??= conn;
    if (domain !== undefined && conn.config.domain?.toLowerCase() === domain) {
      domainMatch = conn;
      break;
    }
  }
  const chosen = domainMatch ?? (enabledCount === 1 ? firstEnabled : null);
  if (!chosen?.config.protocol) return null;
  return {
    organizationId: chosen.organizationId,
    protocol: chosen.config.protocol,
  };
}

/** Secrets sidecar (client secret / SP key) — read-only, never served. */
export async function readSsoSecrets(
  sql: Sql,
  organizationId: string,
): Promise<SsoConnectionSecrets> {
  const orgSlug = await resolveOrgSlug(sql, organizationId);
  if (!orgSlug) return {};
  const raw = await readFileSafe(resolveSsoConnectionSecretsFilePath(orgSlug));
  return raw ? parseSsoSecretsJson(raw) : {};
}
