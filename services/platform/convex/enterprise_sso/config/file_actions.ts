'use node';

/**
 * Enterprise SSO file I/O actions — per organization.
 *
 * The org's single SSO connection is stored as files (the source of truth):
 *   <orgSlug>/governance/sso/connection.yml           (non-secret config)
 *   <orgSlug>/governance/sso/connection.secrets.json  (plaintext secrets)
 * Every admin write goes through here: snapshot history → atomic write →
 * mirror the non-secret half into `configCache` (domain `sso`, key
 * `connection`) so V8 readers observe it → audit. V8 code can't touch the
 * filesystem, so these are `'use node'` internal actions invoked by the
 * admin-gated public actions in `config/actions.ts`.
 *
 * Reads resolve the connection through the shared yml-then-json helper
 * (`connection.json` is the pre-conversion fallback while org trees are
 * converted to YAML); writes emit `connection.yml` and then delete the
 * superseded `.json` sibling so exactly one authoritative file remains. The
 * secrets sidecar stays `connection.secrets.json`: secrets sidecars are
 * excluded from the YAML conversion across the board (their content is
 * opaque secret material, not schema-shaped config), so their name and
 * format never change out from under the sign-in adapters.
 *
 * Secrets are reused-on-omit (an update that doesn't re-send the client secret /
 * SP key keeps the stored one) and read back only here — never returned to the
 * client, never mirrored into the cache.
 */

import { mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { ConvexError, v } from 'convex/values';

import {
  type SsoConnectionFile,
  type SsoConnectionSecrets,
} from '../../../lib/shared/schemas/enterprise_sso';
import { internal } from '../../_generated/api';
import { type ActionCtx, internalAction } from '../../_generated/server';
import { readDomainConfigFile } from '../../lib/config_store/read_domain_file';
import {
  atomicWrite,
  atomicWriteSecret,
  errnoCode,
  generateHistoryTimestamp,
  pruneHistory,
  readFileSafe,
  removeFileSafe,
} from '../../lib/file_io';
import { orgSlugFromId } from '../../lib/helpers/org_slug';
import {
  MAX_FILE_SIZE_BYTES,
  parseSsoSecretsJson,
  resolveSsoConnectionFilePath,
  resolveSsoConnectionSecretsFilePath,
  resolveSsoConnectionYamlFilePath,
  resolveSsoDir,
  resolveSsoHistoryDir,
  serializeSsoConnectionYaml,
  serializeSsoSecretsJson,
  SSO_CONFIG_DOMAIN,
  SSO_CONNECTION_KEY,
  validateSsoConnectionData,
} from '../file_utils';
import {
  attributeMappingValidator,
  platformRoleValidator,
  roleMappingRuleValidator,
  ssoProviderIdValidator,
} from '../validators';

const MAX_HISTORY_ENTRIES = 50;

const provisioningArgs = {
  autoProvisionRole: v.boolean(),
  defaultRole: platformRoleValidator,
  roleMappingRules: v.array(roleMappingRuleValidator),
  autoProvisionTeam: v.boolean(),
  excludeGroups: v.array(v.string()),
};

const actorArgs = {
  actorId: v.string(),
  actorEmail: v.optional(v.string()),
  actorRole: v.optional(v.string()),
};

interface Existing {
  config: SsoConnectionFile | null;
  secrets: SsoConnectionSecrets;
}

async function readExisting(orgSlug: string): Promise<Existing> {
  // yml first, json fallback — a corrupt file throws (writes must not
  // proceed as if no connection existed and clobber it).
  const configResult = await readDomainConfigFile(
    resolveSsoDir(orgSlug),
    SSO_CONNECTION_KEY,
    MAX_FILE_SIZE_BYTES,
    validateSsoConnectionData,
  );
  if (!configResult.ok && configResult.error !== 'not_found') {
    throw new Error(configResult.message);
  }
  const secretsRaw = await readFileSafe(
    resolveSsoConnectionSecretsFilePath(orgSlug),
  );
  return {
    config: configResult.ok ? configResult.data : null,
    secrets: secretsRaw ? parseSsoSecretsJson(secretsRaw) : {},
  };
}

/**
 * Re-derive the non-secret connection config into `configCache` for V8 readers
 * by re-reading the just-written `connection.json` through the generic,
 * registry-driven file→cache sync (domain `sso`). Using the shared path — the
 * same one governance and every other `v8-sync` domain use — keeps SSO inside
 * the cron `reconcileAllConfigCaches` + org-create/reseed safety nets instead
 * of a bespoke mirror that only ran on an admin save. A removed
 * `connection.json` yields zero entries, so this also clears the cache row on
 * delete.
 */
async function resyncCache(
  ctx: ActionCtx,
  organizationId: string,
): Promise<void> {
  await ctx.runAction(
    internal.lib.config_cache.actions.syncConfigDomainFromFiles,
    { organizationId, domain: SSO_CONFIG_DOMAIN },
  );
}

/**
 * Snapshot → atomic write of both files → cache sync. Writes the canonical
 * `connection.yml` and deletes the superseded `connection.json` only after
 * the write succeeded; the history snapshot keeps the current file's own
 * format under its own extension. The secrets sidecar stays `.secrets.json`
 * (see the file header).
 */
async function persist(
  ctx: ActionCtx,
  organizationId: string,
  orgSlug: string,
  config: SsoConnectionFile,
  secrets: SsoConnectionSecrets,
): Promise<void> {
  const yamlPath = resolveSsoConnectionYamlFilePath(orgSlug);
  const jsonPath = resolveSsoConnectionFilePath(orgSlug);
  const currentYaml = await readFileSafe(yamlPath);
  const current = currentYaml ?? (await readFileSafe(jsonPath));
  if (current) {
    const historyDir = resolveSsoHistoryDir(orgSlug);
    await mkdir(historyDir, { recursive: true });
    await atomicWrite(
      path.join(
        historyDir,
        `${generateHistoryTimestamp()}.${currentYaml ? 'yml' : 'json'}`,
      ),
      current,
    );
    await pruneHistory(historyDir, MAX_HISTORY_ENTRIES);
  }
  await atomicWrite(yamlPath, serializeSsoConnectionYaml(config));
  await removeFileSafe(jsonPath);
  await atomicWriteSecret(
    resolveSsoConnectionSecretsFilePath(orgSlug),
    serializeSsoSecretsJson(secrets),
  );
  await resyncCache(ctx, organizationId);
}

function provisioningFrom(args: {
  autoProvisionRole: boolean;
  defaultRole: SsoConnectionFile['provisioning']['defaultRole'];
  roleMappingRules: SsoConnectionFile['provisioning']['roleMappingRules'];
  autoProvisionTeam: boolean;
  excludeGroups: string[];
}): SsoConnectionFile['provisioning'] {
  return {
    autoProvisionRole: args.autoProvisionRole,
    defaultRole: args.defaultRole,
    roleMappingRules: args.roleMappingRules,
    autoProvisionTeam: args.autoProvisionTeam,
    excludeGroups: args.excludeGroups,
  };
}

async function audit(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    actorId: string;
    actorEmail?: string;
    actorRole?: string;
  },
  action: 'sso_configure' | 'sso_enabled' | 'sso_disabled' | 'sso_removed',
  newState?: Record<string, unknown>,
): Promise<void> {
  await ctx.runMutation(
    internal.enterprise_sso.config.internal_mutations.logSsoConfigAudit,
    {
      organizationId: args.organizationId,
      actorId: args.actorId,
      actorEmail: args.actorEmail,
      actorRole: args.actorRole,
      action,
      newState,
    },
  );
}

/** Configure (or update) an OIDC / OAuth2 sign-in connection + provisioning. */
export const writeOidcConnection = internalAction({
  args: {
    organizationId: v.string(),
    ...actorArgs,
    displayName: v.string(),
    domain: v.optional(v.string()),
    providerId: ssoProviderIdValidator,
    issuer: v.string(),
    authorizationEndpoint: v.optional(v.string()),
    tokenEndpoint: v.optional(v.string()),
    userinfoEndpoint: v.optional(v.string()),
    clientId: v.string(),
    clientSecret: v.optional(v.string()),
    scopes: v.array(v.string()),
    pkce: v.optional(v.boolean()),
    claimMappings: v.optional(attributeMappingValidator),
    domainHint: v.optional(v.string()),
    enableOneDriveAccess: v.optional(v.boolean()),
    ...provisioningArgs,
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const orgSlug = await orgSlugFromId(ctx, args.organizationId);
    const existing = await readExisting(orgSlug);

    const clientSecret = args.clientSecret ?? existing.secrets.clientSecret;
    if (!clientSecret) {
      // Coded + localizable (the client maps the code to a translated string);
      // a raw Error would be redacted to a generic "Server Error" in prod (#2057).
      throw new ConvexError({
        code: 'sso_client_secret_required',
        message: 'Client secret is required.',
        userMessage: 'Client secret is required.',
      });
    }

    const protocol = args.providerId === 'oauth2' ? 'oauth2' : 'oidc';
    const config: SsoConnectionFile = {
      enabled: true,
      protocol,
      displayName: args.displayName,
      domain: args.domain,
      oidc: {
        providerId: args.providerId,
        issuer: args.issuer,
        authorizationEndpoint: args.authorizationEndpoint,
        tokenEndpoint: args.tokenEndpoint,
        userinfoEndpoint: args.userinfoEndpoint,
        scopes: args.scopes,
        pkce: args.pkce,
        domainHint: args.domainHint,
        claimMappings: args.claimMappings,
        enableOneDriveAccess: args.enableOneDriveAccess,
      },
      provisioning: provisioningFrom(args),
    };
    const secrets: SsoConnectionSecrets = {
      ...existing.secrets,
      clientId: args.clientId,
      clientSecret,
    };

    await persist(ctx, args.organizationId, orgSlug, config, secrets);
    await audit(ctx, args, 'sso_configure', {
      protocol,
      providerId: args.providerId,
    });
    return null;
  },
});

/** Configure (or update) a SAML 2.0 sign-in connection + provisioning. */
export const writeSamlConnection = internalAction({
  args: {
    organizationId: v.string(),
    ...actorArgs,
    displayName: v.string(),
    domain: v.optional(v.string()),
    idpEntityId: v.string(),
    idpSsoUrl: v.string(),
    idpCertificate: v.string(),
    spPrivateKey: v.optional(v.string()),
    spCertificate: v.optional(v.string()),
    wantAssertionsSigned: v.optional(v.boolean()),
    wantAssertionsEncrypted: v.optional(v.boolean()),
    attributeMappings: v.optional(attributeMappingValidator),
    ...provisioningArgs,
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const orgSlug = await orgSlugFromId(ctx, args.organizationId);
    const existing = await readExisting(orgSlug);

    const spPrivateKey = args.spPrivateKey ?? existing.secrets.spPrivateKey;

    const config: SsoConnectionFile = {
      enabled: true,
      protocol: 'saml',
      displayName: args.displayName,
      domain: args.domain,
      saml: {
        idpEntityId: args.idpEntityId,
        idpSsoUrl: args.idpSsoUrl,
        idpCertificate: args.idpCertificate,
        spCertificate: args.spCertificate,
        wantAssertionsSigned: args.wantAssertionsSigned,
        wantAssertionsEncrypted: args.wantAssertionsEncrypted,
        attributeMappings: args.attributeMappings,
      },
      provisioning: provisioningFrom(args),
    };
    const secrets: SsoConnectionSecrets = {
      ...existing.secrets,
      ...(spPrivateKey ? { spPrivateKey } : {}),
    };

    await persist(ctx, args.organizationId, orgSlug, config, secrets);
    await audit(ctx, args, 'sso_configure', { protocol: 'saml' });
    return null;
  },
});

/** Update only the provisioning policy (role mapping + team sync). */
export const writeProvisioning = internalAction({
  args: { organizationId: v.string(), ...actorArgs, ...provisioningArgs },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const orgSlug = await orgSlugFromId(ctx, args.organizationId);
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
    await persist(ctx, args.organizationId, orgSlug, config, existing.secrets);
    await audit(ctx, args, 'sso_configure', { provisioning: true });
    return null;
  },
});

/** Enable / disable SSO sign-in (keeps the config + secrets for re-enable). */
export const setEnabled = internalAction({
  args: { organizationId: v.string(), ...actorArgs, enabled: v.boolean() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const orgSlug = await orgSlugFromId(ctx, args.organizationId);
    const existing = await readExisting(orgSlug);
    if (!existing.config) return null;
    const config: SsoConnectionFile = {
      ...existing.config,
      enabled: args.enabled,
    };
    await persist(ctx, args.organizationId, orgSlug, config, existing.secrets);
    await audit(ctx, args, args.enabled ? 'sso_enabled' : 'sso_disabled');
    return null;
  },
});

/** Remove the entire connection (config + secrets + history + cache row). */
export const removeConnection = internalAction({
  args: { organizationId: v.string(), ...actorArgs },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const orgSlug = await orgSlugFromId(ctx, args.organizationId);
    const ignoreMissing = (err: unknown) => {
      if (errnoCode(err) !== 'ENOENT') throw err;
    };
    // Both formats: the canonical .yml plus any pre-conversion .json.
    await rm(resolveSsoConnectionYamlFilePath(orgSlug)).catch(ignoreMissing);
    await rm(resolveSsoConnectionFilePath(orgSlug)).catch(ignoreMissing);
    await rm(resolveSsoConnectionSecretsFilePath(orgSlug)).catch(ignoreMissing);
    await rm(resolveSsoHistoryDir(orgSlug), { recursive: true, force: true });
    await rm(resolveSsoDir(orgSlug), { force: true }).catch(() => {
      // Dir may be non-empty / shared; best-effort only.
    });
    // Files are gone → the generic sync mirrors zero entries → cache row cleared.
    await resyncCache(ctx, args.organizationId);
    await audit(ctx, args, 'sso_removed');
    return null;
  },
});

/**
 * Re-derive the `configCache` mirror (domain `sso`) from the org's
 * `connection.json` on disk via the generic, registry-driven
 * `syncConfigDomainFromFiles` — `sso` is now a registered `v8-sync` domain, so
 * this is the same code path governance uses. Public entry point for the SSO
 * cutover migration (which writes files, then asks for a re-derive); idempotent,
 * and clears the cache row when no file exists.
 */
export const syncConnectionCache = internalAction({
  args: { organizationId: v.string() },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    await resyncCache(ctx, args.organizationId);
    return null;
  },
});

/** Reveal the stored client id for the edit form (admin-gated upstream). */
export const revealClientId = internalAction({
  args: { organizationId: v.string() },
  returns: v.union(v.string(), v.null()),
  handler: async (ctx, args): Promise<string | null> => {
    const orgSlug = await orgSlugFromId(ctx, args.organizationId);
    const existing = await readExisting(orgSlug);
    return existing.secrets.clientId ?? null;
  },
});

/**
 * Read the org's SSO secrets (clientId / clientSecret / spPrivateKey) for the
 * `'use node'` sign-in adapters. Internal only — secrets never leave the
 * backend. The non-secret config the adapters also need is read separately from
 * `configCache` (V8).
 */
export const getConnectionSecrets = internalAction({
  args: { organizationId: v.string() },
  returns: v.object({
    clientId: v.optional(v.string()),
    clientSecret: v.optional(v.string()),
    spPrivateKey: v.optional(v.string()),
  }),
  handler: async (ctx, args): Promise<SsoConnectionSecrets> => {
    const orgSlug = await orgSlugFromId(ctx, args.organizationId);
    const { secrets } = await readExisting(orgSlug);
    return secrets;
  },
});
