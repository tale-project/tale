import type { Sql } from 'postgres';

import type {
  SsoConnectionFile,
  SsoConnectionSecrets,
} from '../../../lib/shared/schemas/enterprise_sso.ts';
import {
  persistFiles,
  readExisting,
  removeConnectionFiles,
  type ExistingSsoFiles,
} from '../../core/enterprise_sso/config/file_store.ts';
import { withoutGraphFileScopes } from '../../core/enterprise_sso/entra_id/constants.ts';
import { getAdapter } from '../../core/enterprise_sso/registry.ts';
import { fetchAndParseIdpMetadataImpl } from '../../core/enterprise_sso/saml/parse_metadata.ts';
import {
  publicHttpApiUrlFor,
  siteOrigins,
} from '../../core/lib/helpers/public_origin.ts';
import { getPublicHttpApiUrl } from '../../core/lib/helpers/public_storage_url.ts';
import { resolveOrgSlug } from '../../lib/org-config.ts';
import { createAuditLog } from '../audit_logs/service.ts';
import { getScimStatus } from '../scim/service.ts';
import { readSsoConnection, readSsoSecrets } from './config.ts';

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

/**
 * The connection files, or a readable refusal. `readExisting` throws on a
 * corrupt `connection.yml` (a save must not proceed as if no connection
 * existed and clobber it); through an admin door that throw is a bare 500,
 * so map it to a 409 that names the file the operator has to repair.
 */
async function readFilesReadably<T>(
  orgSlug: string,
  read: () => Promise<T>,
): Promise<T> {
  try {
    return await read();
  } catch (error) {
    // The cause stays in the log: a JSON.parse message quotes the source
    // text, which for the secrets sidecar could echo a stored secret.
    console.error('[sso] connection files unreadable', { orgSlug, error });
    throw new SsoAdminError(
      'sso_config_unreadable',
      `The SSO connection files for ${orgSlug} are unreadable; see the server log.`,
      409,
    );
  }
}

/** `readExisting` behind the readable refusal — every admin door's read. */
function readExistingReadably(orgSlug: string): Promise<ExistingSsoFiles> {
  return readFilesReadably(orgSlug, () => readExisting(orgSlug));
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
  const existing = await readExistingReadably(orgSlug);

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
  const existing = await readExistingReadably(orgSlug);

  const spPrivateKey = args.spPrivateKey ?? existing.secrets.spPrivateKey;
  // Requiring encrypted assertions without the key that decrypts them would
  // persist a connection that refuses every SAML login (node-saml throws on
  // an encrypted assertion with no decryption key) — refuse the save instead,
  // under the field the admin has to fill.
  if (args.wantAssertionsEncrypted === true && !spPrivateKey) {
    throw new SsoAdminError(
      'sso_sp_key_required',
      'An SP private key is required to require encrypted assertions.',
    );
  }

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
  const existing = await readExistingReadably(orgSlug);
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
  const existing = await readExistingReadably(orgSlug);
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
  const existing = await readExistingReadably(orgSlug);
  return existing.secrets.clientId ?? null;
}

/**
 * Validate an OIDC/OAuth2 config via the provider adapter: discovery, plus
 * the credential probe where the adapter has one (Entra's client-credentials
 * grant maps a wrong or expired secret to a readable reason). The secret is
 * the one the admin just typed, or — reuse-on-omit, the save's own posture —
 * the stored one, so "Test connection" on an existing connection checks the
 * credentials that will actually sign users in.
 */
export async function testSsoConnection(
  sql: Sql,
  organizationId: string,
  args: {
    providerId: 'entra-id' | 'generic-oidc' | 'oauth2';
    issuer: string;
    authorizationEndpoint?: string;
    tokenEndpoint?: string;
    userinfoEndpoint?: string;
    clientId: string;
    clientSecret?: string;
    scopes: string[];
  },
): Promise<{ valid: boolean; error?: string }> {
  const adapter = getAdapter(args.providerId);
  if (!adapter) return { valid: false, error: 'Unknown provider' };
  // The files are consulted only for the stored secret, so a typed secret
  // keeps the probe independent of them (a corrupt file is the save's
  // problem, reported there).
  const clientSecret =
    args.clientSecret ||
    (await readExistingReadably(await requireOrgSlug(sql, organizationId)))
      .secrets.clientSecret;
  return adapter.validateConfig({
    ...args,
    ...(clientSecret ? { clientSecret } : {}),
  });
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

/**
 * The `/http_api` bases of the NON-canonical site origins — the extra
 * domains whose callback/ACS URLs the admin must register alongside the
 * canonical pair. Empty on a single-domain deployment.
 */
function extraHttpApiBases(): string[] {
  return siteOrigins().slice(1).map(publicHttpApiUrlFor);
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
  // The SP private key lives in the secrets sidecar and never rides the
  // view; the form only needs to know one is stored (blank field = keep it),
  // which is exactly what `upsertSamlConnection`'s encryption guard checks.
  const hasSpKeypair =
    loaded?.config.saml !== undefined
      ? !!(
          await readFilesReadably(loaded.orgSlug, () =>
            readSsoSecrets(sql, organizationId),
          )
        ).spPrivateKey
      : false;
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
    // Every domain this deployment answers on — the admin registers one
    // callback/ACS per domain on the IdP, since a browser signing in on one
    // is returned to that same one. Canonical first; a single-domain
    // deployment lists exactly the two URLs above.
    additionalCallbackUrls: extraHttpApiBases().map(
      (extra) => `${extra}/api/sso/callback`,
    ),
    additionalSamlAcsUrls: extraHttpApiBases().map(
      (extra) => `${extra}/api/sso/saml/acs`,
    ),
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
          hasSpKeypair,
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
