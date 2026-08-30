import type { Sql } from 'postgres';

import {
  persistFiles,
  readExisting,
  removeConnectionFiles,
} from '../../../convex/enterprise_sso/config/file_store.ts';
import { withoutGraphFileScopes } from '../../../convex/enterprise_sso/entra_id/constants.ts';
import { getAdapter } from '../../../convex/enterprise_sso/registry.ts';
import { fetchAndParseIdpMetadataImpl } from '../../../convex/enterprise_sso/saml/parse_metadata.ts';
import { getPublicHttpApiUrl } from '../../../convex/lib/helpers/public_storage_url.ts';
import type {
  SsoConnectionFile,
  SsoConnectionSecrets,
} from '../../../lib/shared/schemas/enterprise_sso.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { getScimStatus } from '../scim/service.ts';
import { readSsoConnection } from './config.ts';

/**
 * The admin config-write surface for the file-backed SSO connection — the
 * 0.5 twin of `enterprise_sso/config/{actions,file_actions,queries}`, with
 * the file mechanics REUSED whole (`config/file_store.ts`: snapshot history
 * → atomic yml write → superseded-json delete → secrets sidecar) and the
 * configCache mirror DROPPED (rule 5 — the 0.5 sign-in reads the files
 * directly). Secrets are reused-on-omit and revealed only through the
 * dedicated client-id door; they never ride the view.
 */

export class SsoAdminError extends Error {
  readonly code: string;
  readonly status: 400 | 404 | 409;

  constructor(code: string, message: string, status: 400 | 404 | 409 = 400) {
    super(message);
    this.name = 'SsoAdminError';
    this.code = code;
    this.status = status;
  }
}

export interface SsoActor {
  userId: string;
  email?: string;
  role?: string;
}

async function requireOrgSlug(
  sql: Sql,
  organizationId: string,
): Promise<string> {
  const slug = await resolveOrgSlug(sql, organizationId);
  if (!slug) {
    throw new SsoAdminError('org_not_found', 'Organization not found', 404);
  }
  return slug;
}

async function audit(
  sql: Sql,
  organizationId: string,
  actor: SsoActor,
  action: 'sso_configure' | 'sso_enabled' | 'sso_disabled' | 'sso_removed',
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
      resourceType: 'sso',
      resourceId: organizationId,
      ...(newState !== undefined ? { newState } : {}),
      status: 'success',
    }),
  );
}

export interface SsoProvisioningInput {
  autoProvisionRole: boolean;
  defaultRole: SsoConnectionFile['provisioning']['defaultRole'];
  roleMappingRules: SsoConnectionFile['provisioning']['roleMappingRules'];
  autoProvisionTeam: boolean;
  excludeGroups: string[];
}

function provisioningFrom(
  args: SsoProvisioningInput,
): SsoConnectionFile['provisioning'] {
  return {
    autoProvisionRole: args.autoProvisionRole,
    defaultRole: args.defaultRole,
    roleMappingRules: args.roleMappingRules,
    autoProvisionTeam: args.autoProvisionTeam,
    excludeGroups: args.excludeGroups,
  };
}

export interface UpsertOidcArgs extends SsoProvisioningInput {
  displayName: string;
  domain?: string;
  providerId: 'entra-id' | 'generic-oidc' | 'oauth2';
  issuer: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  userinfoEndpoint?: string;
  clientId: string;
  clientSecret?: string;
  scopes: string[];
  pkce?: boolean;
  claimMappings?: SsoConnectionFile['oidc'] extends infer O
    ? O extends { claimMappings?: infer M }
      ? M
      : never
    : never;
  domainHint?: string;
}

/** Configure (or update) an OIDC / OAuth2 sign-in connection. */
export async function upsertOidcConnection(
  sql: Sql,
  organizationId: string,
  actor: SsoActor,
  args: UpsertOidcArgs,
): Promise<void> {
  const orgSlug = await requireOrgSlug(sql, organizationId);
  const existing = await readExisting(orgSlug);

  const clientSecret = args.clientSecret ?? existing.secrets.clientSecret;
  if (!clientSecret) {
    throw new SsoAdminError(
      'sso_client_secret_required',
      'Client secret is required.',
    );
  }

  const protocol = args.providerId === 'oauth2' ? 'oauth2' : 'oidc';
  const config: SsoConnectionFile = {
    enabled: true,
    protocol,
    displayName: args.displayName,
    ...(args.domain !== undefined ? { domain: args.domain } : {}),
    oidc: {
      providerId: args.providerId,
      issuer: args.issuer,
      ...(args.authorizationEndpoint !== undefined
        ? { authorizationEndpoint: args.authorizationEndpoint }
        : {}),
      ...(args.tokenEndpoint !== undefined
        ? { tokenEndpoint: args.tokenEndpoint }
        : {}),
      ...(args.userinfoEndpoint !== undefined
        ? { userinfoEndpoint: args.userinfoEndpoint }
        : {}),
      scopes: withoutGraphFileScopes(args.scopes),
      ...(args.pkce !== undefined ? { pkce: args.pkce } : {}),
      ...(args.domainHint !== undefined ? { domainHint: args.domainHint } : {}),
      ...(args.claimMappings !== undefined
        ? { claimMappings: args.claimMappings }
        : {}),
      // Deprecated SSO flag — never request Graph file scopes on sign-in.
      enableOneDriveAccess: false,
    },
    provisioning: provisioningFrom(args),
  };
  const secrets: SsoConnectionSecrets = {
    ...existing.secrets,
    clientId: args.clientId,
    clientSecret,
  };

  await persistFiles(orgSlug, config, secrets);
  await audit(sql, organizationId, actor, 'sso_configure', {
    protocol,
    providerId: args.providerId,
  });
}

export interface UpsertSamlArgs extends SsoProvisioningInput {
  displayName: string;
  domain?: string;
  idpEntityId: string;
  idpSsoUrl: string;
  idpCertificate: string;
  spPrivateKey?: string;
  spCertificate?: string;
  wantAssertionsSigned?: boolean;
  wantAssertionsEncrypted?: boolean;
  attributeMappings?: NonNullable<
    SsoConnectionFile['saml']
  >['attributeMappings'];
}

/** Configure (or update) a SAML 2.0 sign-in connection. */
export async function upsertSamlConnection(
  sql: Sql,
  organizationId: string,
  actor: SsoActor,
  args: UpsertSamlArgs,
): Promise<void> {
  const orgSlug = await requireOrgSlug(sql, organizationId);
  const existing = await readExisting(orgSlug);

  const spPrivateKey = args.spPrivateKey ?? existing.secrets.spPrivateKey;

  const config: SsoConnectionFile = {
    enabled: true,
    protocol: 'saml',
    displayName: args.displayName,
    ...(args.domain !== undefined ? { domain: args.domain } : {}),
    saml: {
      idpEntityId: args.idpEntityId,
      idpSsoUrl: args.idpSsoUrl,
      idpCertificate: args.idpCertificate,
      ...(args.spCertificate !== undefined
        ? { spCertificate: args.spCertificate }
        : {}),
      ...(args.wantAssertionsSigned !== undefined
        ? { wantAssertionsSigned: args.wantAssertionsSigned }
        : {}),
      ...(args.wantAssertionsEncrypted !== undefined
        ? { wantAssertionsEncrypted: args.wantAssertionsEncrypted }
        : {}),
      ...(args.attributeMappings !== undefined
        ? { attributeMappings: args.attributeMappings }
        : {}),
    },
    provisioning: provisioningFrom(args),
  };
  const secrets: SsoConnectionSecrets = {
    ...existing.secrets,
    ...(spPrivateKey ? { spPrivateKey } : {}),
  };

  await persistFiles(orgSlug, config, secrets);
  await audit(sql, organizationId, actor, 'sso_configure', {
    protocol: 'saml',
  });
}

/** Update only the provisioning policy (role mapping + team sync). */
export async function setSsoProvisioning(
  sql: Sql,
  organizationId: string,
  actor: SsoActor,
  args: SsoProvisioningInput,
): Promise<void> {
  const orgSlug = await requireOrgSlug(sql, organizationId);
  const existing = await readExisting(orgSlug);
  const base: SsoConnectionFile = existing.config ?? {
    enabled: false,
    displayName: 'Enterprise SSO',
    provisioning: provisioningFrom(args),
  };
  const config: SsoConnectionFile = {
    ...base,
    provisioning: provisioningFrom(args),
  };
  await persistFiles(orgSlug, config, existing.secrets);
  await audit(sql, organizationId, actor, 'sso_configure', {
    provisioning: true,
  });
}

/** Enable / disable SSO sign-in (keeps config + secrets for re-enable). */
export async function setSsoEnabled(
  sql: Sql,
  organizationId: string,
  actor: SsoActor,
  enabled: boolean,
): Promise<void> {
  const orgSlug = await requireOrgSlug(sql, organizationId);
  const existing = await readExisting(orgSlug);
  if (!existing.config) return;
  const config: SsoConnectionFile = { ...existing.config, enabled };
  await persistFiles(orgSlug, config, existing.secrets);
  await audit(
    sql,
    organizationId,
    actor,
    enabled ? 'sso_enabled' : 'sso_disabled',
  );
}

/** Remove the entire connection (config + secrets + history). */
export async function removeSsoConnection(
  sql: Sql,
  organizationId: string,
  actor: SsoActor,
): Promise<void> {
  const orgSlug = await requireOrgSlug(sql, organizationId);
  await removeConnectionFiles(orgSlug);
  await audit(sql, organizationId, actor, 'sso_removed');
}

/** Reveal the stored client id for the edit form (admin-gated upstream). */
export async function revealSsoClientId(
  sql: Sql,
  organizationId: string,
): Promise<string | null> {
  const orgSlug = await requireOrgSlug(sql, organizationId);
  const existing = await readExisting(orgSlug);
  return existing.secrets.clientId ?? null;
}

/** Validate an OIDC/OAuth2 config via the provider adapter (discovery). */
export async function testSsoConnection(args: {
  providerId: 'entra-id' | 'generic-oidc' | 'oauth2';
  issuer: string;
  authorizationEndpoint?: string;
  tokenEndpoint?: string;
  userinfoEndpoint?: string;
  clientId: string;
  scopes: string[];
}): Promise<{ valid: boolean; error?: string }> {
  const adapter = getAdapter(args.providerId);
  if (!adapter) return { valid: false, error: 'Unknown provider' };
  return adapter.validateConfig(args);
}

/** Parse IdP federation metadata (exactly one of url / xml). */
export async function parseSsoIdpMetadata(args: {
  url?: string;
  xml?: string;
}): Promise<{
  idpEntityId: string;
  idpSsoUrl: string;
  idpCertificate: string;
}> {
  if ((args.url === undefined) === (args.xml === undefined)) {
    throw new SsoAdminError(
      'sso_metadata_invalid',
      'Provide exactly one of url or xml',
    );
  }
  const result = await fetchAndParseIdpMetadataImpl(args);
  if (
    !result.ok ||
    result.idpEntityId === undefined ||
    result.idpSsoUrl === undefined ||
    result.idpCertificate === undefined
  ) {
    throw new SsoAdminError(
      `sso_metadata_${result.error ?? 'invalid'}`,
      'Could not read IdP metadata',
    );
  }
  return {
    idpEntityId: result.idpEntityId,
    idpSsoUrl: result.idpSsoUrl,
    idpCertificate: result.idpCertificate,
  };
}

function publicBase(): string | null {
  try {
    return getPublicHttpApiUrl();
  } catch {
    return null;
  }
}

/** True when any OTHER org on this deployment has an enabled connection —
 * the multi-org state where a domain-less connection is unroutable by email
 * and only reachable via the login page's manual picker. */
async function otherOrgsHaveEnabledConnections(
  sql: Sql,
  organizationId: string,
): Promise<boolean> {
  const orgs = await sql<{ id: string }[]>`
    SELECT "id" FROM "organization" WHERE "id" <> ${organizationId}
  `;
  for (const org of orgs) {
    const conn = await readSsoConnection(sql, org.id);
    if (conn !== null && conn.config.enabled) return true;
  }
  return false;
}

/** The admin settings view — the 0.4 `config/queries.get` twin: non-secret
 * config from the FILE, SCIM token state from the DB, deployment URLs from
 * the env. Secrets never ride this. */
export async function getSsoConnectionView(
  sql: Sql,
  organizationId: string,
): Promise<Record<string, unknown>> {
  const base = publicBase();
  const scim = await getScimStatus(sql, organizationId);
  const loaded = await readSsoConnection(sql, organizationId);
  const config = loaded?.config ?? null;
  const shared = {
    scim: {
      enabled: scim.enabled,
      tokenPrefix: scim.enabled ? (scim.tokenPrefix ?? null) : null,
      tokenGeneratedAt: scim.enabled ? (scim.generatedAt ?? null) : null,
      lastUsedAt: scim.lastUsedAt ?? null,
      baseUrl: base ? `${base}/scim/v2` : null,
    },
    samlSpMetadataUrl: base ? `${base}/api/sso/saml/metadata` : null,
    samlAcsUrl: base ? `${base}/api/sso/saml/acs` : null,
    oidcCallbackUrl: base ? `${base}/api/sso/callback` : null,
    deployment: {
      siteUrlSet: !!process.env.SITE_URL,
      basePathSet: process.env.BASE_PATH !== undefined,
      authSecretSet: !!process.env.BETTER_AUTH_SECRET,
    },
    otherOrgsEnabled: await otherOrgsHaveEnabledConnections(
      sql,
      organizationId,
    ),
  };
  if (!config) {
    return {
      configured: false,
      enabled: false,
      protocol: null,
      displayName: null,
      domain: null,
      oidc: null,
      saml: null,
      provisioning: {
        autoProvisionRole: false,
        defaultRole: 'member',
        roleMappingRules: [],
        autoProvisionTeam: false,
        excludeGroups: [],
      },
      ...shared,
    };
  }
  return {
    configured: true,
    enabled: config.enabled,
    protocol: config.protocol ?? null,
    displayName: config.displayName,
    domain: config.domain ?? null,
    oidc: config.oidc
      ? {
          providerId: config.oidc.providerId,
          issuer: config.oidc.issuer,
          authorizationEndpoint: config.oidc.authorizationEndpoint,
          tokenEndpoint: config.oidc.tokenEndpoint,
          userinfoEndpoint: config.oidc.userinfoEndpoint,
          scopes: config.oidc.scopes,
          pkce: config.oidc.pkce,
          domainHint: config.oidc.domainHint,
          claimMappings: config.oidc.claimMappings,
          enableOneDriveAccess: config.oidc.enableOneDriveAccess,
        }
      : null,
    saml: config.saml
      ? {
          idpEntityId: config.saml.idpEntityId,
          idpSsoUrl: config.saml.idpSsoUrl,
          idpCertificate: config.saml.idpCertificate,
          wantAssertionsSigned: config.saml.wantAssertionsSigned,
          wantAssertionsEncrypted: config.saml.wantAssertionsEncrypted,
          // The SP private key lives in the secrets sidecar; a configured
          // public SP certificate signals the keypair exists.
          hasSpKeypair: !!config.saml.spCertificate,
          spCertificate: config.saml.spCertificate,
          attributeMappings: config.saml.attributeMappings,
        }
      : null,
    provisioning: {
      autoProvisionRole: config.provisioning.autoProvisionRole,
      defaultRole: config.provisioning.defaultRole,
      roleMappingRules: config.provisioning.roleMappingRules,
      autoProvisionTeam: config.provisioning.autoProvisionTeam,
      excludeGroups: config.provisioning.excludeGroups,
    },
    ...shared,
  };
}
