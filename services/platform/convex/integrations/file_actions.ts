'use node';

/**
 * Integration file I/O actions.
 *
 * All integration config reads/writes go through these actions.
 * Uses atomic writes (temp -> fsync -> rename) for data safety.
 * Supports compare-and-swap via expectedHash to prevent lost updates.
 */

import { mkdir, readdir, rm } from 'node:fs/promises';
import path from 'node:path';

import { v } from 'convex/values';
import JSZip from 'jszip';

import {
  isDuplicableIntegration,
  type IntegrationJsonConfig,
} from '../../lib/shared/schemas/integrations';
import { internal } from '../_generated/api';
import type { Id } from '../_generated/dataModel';
import { type ActionCtx, action, internalAction } from '../_generated/server';
import {
  cleanupReboundAutomations,
  rebindBundledAutomations,
} from '../automations/duplicate_rebind';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import {
  atomicWrite,
  atomicWriteBuffer,
  readFileBufferSafe,
  readFileSafe,
  readJsonFile,
  sha256,
} from '../lib/file_io';
import { requireDeveloperSettingsAccessById } from '../providers/auth';
import type { IntegrationReadResult } from './file_utils';
import {
  deriveNextSlug,
  isBuiltinIntegrationSlug,
  MAX_FILE_SIZE_BYTES,
  parseIntegrationJson,
  resolveConfigPath,
  resolveConnectorPath,
  resolveIconPath,
  resolveIntegrationDir,
  resolveIntegrationsDir,
  serializeIntegrationJson,
  validateIntegrationSlug,
} from './file_utils';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

export async function readIntegrationConfigFile(
  orgSlug: string,
  slug: string,
): Promise<IntegrationReadResult> {
  const filePath = resolveConfigPath(orgSlug, slug);
  const result = await readJsonFile<IntegrationJsonConfig>(
    filePath,
    MAX_FILE_SIZE_BYTES,
    parseIntegrationJson,
  );
  if (result.ok) {
    return { ok: true, config: result.data, hash: result.hash };
  }
  return result;
}

async function readConnectorCode(
  orgSlug: string,
  slug: string,
): Promise<string | null> {
  const filePath = resolveConnectorPath(orgSlug, slug);
  return readFileSafe(filePath);
}

// ---------------------------------------------------------------------------
// Public actions (called from frontend)
// ---------------------------------------------------------------------------

export const readIntegration = action({
  args: {
    organizationId: v.string(),
    slug: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );
    const configResult = await readIntegrationConfigFile(orgSlug, args.slug);
    if (!configResult.ok) return configResult;
    const connectorCode = await readConnectorCode(orgSlug, args.slug);
    return {
      ok: true,
      config: configResult.config,
      connectorCode,
      hash: configResult.hash,
    };
  },
});

export const listIntegrations = action({
  args: {
    organizationId: v.string(),
    filter: v.optional(
      v.union(v.literal('installed'), v.literal('templates'), v.literal('all')),
    ),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );
    const filterMode = args.filter ?? 'all';
    const dir = resolveIntegrationsDir(orgSlug);

    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        return [];
      }
      throw new Error(
        `Integrations directory inaccessible: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }

    // Filter to directories only (skip hidden dirs like .history)
    const dirs = entries.filter(
      (e) => !e.startsWith('.') && validateIntegrationSlug(e),
    );

    // `installed` is derived from the DB: an integration is installed iff a
    // credential row exists for its slug in this organization. Fetching the
    // credential set once avoids N queries inside the dir.map loop.
    const installedSlugs = new Set<string>();
    const credentials = await ctx.runQuery(
      internal.integrations.credential_queries.listInternal,
      { organizationId: args.organizationId },
    );
    for (const cred of credentials as Array<{ slug: string }>) {
      installedSlugs.add(cred.slug);
    }

    const results = await Promise.all(
      dirs.map(async (slug) => {
        const result = await readIntegrationConfigFile(orgSlug, slug);
        if (result.ok) {
          const installed = installedSlugs.has(slug);
          if (filterMode === 'installed' && !installed) return null;
          if (filterMode === 'templates' && installed) return null;

          // Read icon.svg as data URI if it exists
          const iconPath = path.join(
            resolveIntegrationDir(orgSlug, slug),
            'icon.svg',
          );
          const iconContent = await readFileSafe(iconPath);
          const iconUrl = iconContent
            ? `data:image/svg+xml;base64,${Buffer.from(iconContent).toString('base64')}`
            : undefined;

          const entry: Record<string, unknown> = {
            slug,
            // Only a base builtin template spawns instances; an instance
            // (a duplicate like imap_smtp-2) is a leaf — not itself duplicable.
            duplicable:
              isBuiltinIntegrationSlug(slug) &&
              isDuplicableIntegration({
                slug,
                authMethod: result.config.authMethod,
              }),
            // A non-builtin instance (a duplicate like imap_smtp-2, or an
            // uploaded connector) — its org-owned dir is fully deletable, unlike
            // a seeded builtin template (which is only disconnected). Independent
            // of connection state (a never-connected duplicate is deletable).
            removable: !isBuiltinIntegrationSlug(slug),
            title: result.config.title,
            description: result.config.description,
            labels: result.config.labels,
            type: result.config.type,
            authMethod: result.config.authMethod,
            supportedAuthMethods: result.config.supportedAuthMethods,
            secretBindings: result.config.secretBindings,
            allowedHosts: result.config.allowedHosts,
            operations: result.config.operations,
            connectionConfig: result.config.connectionConfig,
            capabilities: result.config.capabilities,
            exposeAsCapability: result.config.exposeAsCapability,
            oauth2Config: result.config.oauth2Config,
            sqlConnectionConfig: result.config.sqlConnectionConfig,
            sqlOperations: result.config.sqlOperations,
            operationCount: result.config.operations?.length ?? 0,
            metadata: result.config.metadata,
            setupGuide: result.config.setupGuide,
            hash: result.hash,
          };
          if (iconUrl) {
            entry.iconUrl = iconUrl;
          }
          return entry;
        }
        return {
          slug,
          status: result.error,
          message: result.message,
        };
      }),
    );

    return results.filter(Boolean);
  },
});

/** Minimal catalog shape for the dispatch readers + skill materialization. */
export interface IntegrationCatalogEntry {
  slug: string;
  title?: string;
  description?: string;
  operations?: Array<{
    name: string;
    description?: string;
    operationType?: string;
  }>;
}

/**
 * Non-auth internal catalog enumerator — every integration directory for an
 * org with its title, description, and operations. Mirrors `listIntegrations`
 * minus the membership gate; callers (the dispatch httpAction + skill
 * materialization, already authenticated by the session token) pass an orgSlug
 * resolved from a trusted organizationId.
 */
export const listIntegrationsInternal = internalAction({
  args: { orgSlug: v.string() },
  returns: v.array(
    v.object({
      slug: v.string(),
      title: v.optional(v.string()),
      description: v.optional(v.string()),
      operations: v.optional(
        v.array(
          v.object({
            name: v.string(),
            description: v.optional(v.string()),
            operationType: v.optional(v.string()),
          }),
        ),
      ),
    }),
  ),
  handler: async (_ctx, args): Promise<IntegrationCatalogEntry[]> => {
    const dir = resolveIntegrationsDir(args.orgSlug);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        return [];
      }
      throw err;
    }
    const dirs = entries.filter(
      (e) => !e.startsWith('.') && validateIntegrationSlug(e),
    );
    const results = await Promise.all(
      dirs.map(async (slug): Promise<IntegrationCatalogEntry | null> => {
        const result = await readIntegrationConfigFile(args.orgSlug, slug);
        if (!result.ok) return null;
        const operations = (result.config.operations ?? []).map((op) => {
          const o: {
            name: string;
            description?: string;
            operationType?: string;
          } = { name: op.name };
          if (op.description !== undefined) o.description = op.description;
          if (op.operationType !== undefined)
            o.operationType = op.operationType;
          return o;
        });
        const entry: IntegrationCatalogEntry = {
          slug,
          title: result.config.title,
          operations,
        };
        if (result.config.description !== undefined) {
          entry.description = result.config.description;
        }
        return entry;
      }),
    );
    return results.filter((r): r is IntegrationCatalogEntry => r !== null);
  },
});

/**
 * Save an integration config with an atomic write.
 * Optionally performs compare-and-swap via expectedHash.
 */
export const saveIntegrationConfig = action({
  args: {
    organizationId: v.string(),
    slug: v.string(),
    config: v.any(),
    expectedHash: v.optional(v.string()),
  },
  returns: v.object({ hash: v.string() }),
  handler: async (ctx, args): Promise<{ hash: string }> => {
    if (!validateIntegrationSlug(args.slug)) {
      throw new Error(`Invalid integration slug: ${args.slug}`);
    }

    // Writing an integration config is a capability-bearing edit the rest of
    // the codebase treats as `developerSettings` work. A plain `member` is
    // hidden from the integrations UI by `cannot('read','developerSettings')`
    // but could previously drive this action directly via the Convex client.
    const { orgSlug } = await requireDeveloperSettingsAccessById(
      ctx,
      args.organizationId,
    );
    const config = parseIntegrationJson(JSON.stringify(args.config));
    const newContent = serializeIntegrationJson(config);
    const filePath = resolveConfigPath(orgSlug, args.slug);

    // Compare-and-swap
    if (args.expectedHash) {
      const currentContent = await readFileSafe(filePath);
      if (currentContent) {
        const currentHash = sha256(currentContent);
        if (currentHash !== args.expectedHash) {
          throw new Error(
            'Conflict: integration config was modified externally. Please refresh and try again.',
          );
        }
      }
    }

    await atomicWrite(filePath, newContent);
    return { hash: sha256(newContent) };
  },
});

export const installIntegration = action({
  args: {
    slug: v.string(),
    organizationId: v.string(),
  },
  returns: v.object({
    hash: v.string(),
    credentialId: v.id('integrationCredentials'),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ hash: string; credentialId: Id<'integrationCredentials'> }> => {
    if (!validateIntegrationSlug(args.slug)) {
      throw new Error(`Invalid integration slug: ${args.slug}`);
    }

    // Connecting an integration creates its credential record —
    // `developerSettings` work elsewhere. Gate it on the same capability
    // rather than admitting any non-disabled member.
    const { orgSlug } = await requireDeveloperSettingsAccessById(
      ctx,
      args.organizationId,
    );
    const result = await readIntegrationConfigFile(orgSlug, args.slug);
    if (!result.ok) {
      throw new Error(`Cannot install integration: ${result.message}`);
    }

    // Ensure credential record exists in DB (inactive until user configures credentials)
    const existing = await ctx.runQuery(
      internal.integrations.credential_queries.getBySlugInternal,
      { organizationId: args.organizationId, slug: args.slug },
    );

    let credentialId: Id<'integrationCredentials'>;

    if (!existing) {
      credentialId = await ctx.runMutation(
        internal.integrations.credential_mutations.createCredentials,
        {
          organizationId: args.organizationId,
          slug: args.slug,
          status: 'inactive',
          isActive: false,
          authMethod: result.config.authMethod,
          supportedAuthMethods: result.config.supportedAuthMethods,
          capabilities: result.config.capabilities,
        },
      );
    } else {
      credentialId = existing._id;
    }

    return { hash: result.hash, credentialId };
  },
});

export const uninstallIntegration = action({
  args: {
    slug: v.string(),
    organizationId: v.string(),
  },
  returns: v.object({ deleted: v.boolean() }),
  handler: async (ctx, args): Promise<{ deleted: boolean }> => {
    if (!validateIntegrationSlug(args.slug)) {
      throw new Error(`Invalid integration slug: ${args.slug}`);
    }

    // Uninstalling deletes the credential record and its stored icon/secrets —
    // the same destructive outcome as the now-gated `deleteCredentials`
    // mutation. Without this gate a plain `member` rejected by
    // `deleteCredentials` could simply call `uninstallIntegration` instead.
    await requireDeveloperSettingsAccessById(ctx, args.organizationId);

    const existing = await ctx.runQuery(
      internal.integrations.credential_queries.getBySlugInternal,
      { organizationId: args.organizationId, slug: args.slug },
    );

    if (!existing) {
      return { deleted: false };
    }

    await ctx.runMutation(
      internal.integrations.credential_mutations.deleteCredentialsInternal,
      { credentialId: existing._id },
    );

    return { deleted: true };
  },
});

/**
 * Write integration files to disk for a custom upload.
 */
export const writeIntegrationFiles = action({
  args: {
    organizationId: v.string(),
    slug: v.string(),
    config: v.any(),
    connectorCode: v.optional(v.string()),
  },
  returns: v.object({ hash: v.string() }),
  handler: async (ctx, args): Promise<{ hash: string }> => {
    if (!validateIntegrationSlug(args.slug)) {
      throw new Error(`Invalid integration slug: ${args.slug}`);
    }

    // Custom uploads write integration config AND executable connector code to
    // disk — at least as capability-bearing as the credential paths gated
    // above. Require the `developerSettings` capability, not plain membership.
    const { orgSlug } = await requireDeveloperSettingsAccessById(
      ctx,
      args.organizationId,
    );
    const config = parseIntegrationJson(JSON.stringify(args.config));
    const configContent = serializeIntegrationJson(config);
    const integrationDir = resolveIntegrationDir(orgSlug, args.slug);

    await mkdir(integrationDir, { recursive: true });

    await atomicWrite(path.join(integrationDir, 'config.json'), configContent);

    if (args.connectorCode) {
      await atomicWrite(
        path.join(integrationDir, 'connector.ts'),
        args.connectorCode,
      );
    }

    return { hash: sha256(configContent) };
  },
});

/**
 * Package an installed integration's on-disk files (config.json + optional
 * connector.ts + optional icon.svg) into a downloadable `.zip`, returned
 * base64-encoded. The inverse of the custom-upload path. Gated on the same
 * developer-settings capability as the other integration writes, since the
 * connector code it bundles is capability-bearing.
 */
export const exportIntegration = action({
  args: {
    organizationId: v.string(),
    slug: v.string(),
  },
  returns: v.object({
    ok: v.literal(true),
    filename: v.string(),
    dataBase64: v.string(),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ ok: true; filename: string; dataBase64: string }> => {
    if (!validateIntegrationSlug(args.slug)) {
      throw new Error(`Invalid integration slug: ${args.slug}`);
    }
    const { orgSlug } = await requireDeveloperSettingsAccessById(
      ctx,
      args.organizationId,
    );

    const configBuf = await readFileBufferSafe(
      resolveConfigPath(orgSlug, args.slug),
    );
    if (configBuf === null) {
      throw new Error(`Integration "${args.slug}" does not exist`);
    }

    const zip = new JSZip();
    zip.file('config.json', configBuf);

    // connector.ts and icon.svg are absent for SQL/IMAP integrations and for
    // integrations that never uploaded an icon — both are optional in the zip.
    const connectorBuf = await readFileBufferSafe(
      resolveConnectorPath(orgSlug, args.slug),
    );
    if (connectorBuf !== null) {
      zip.file('connector.ts', connectorBuf);
    }
    const iconBuf = await readFileBufferSafe(
      resolveIconPath(orgSlug, args.slug),
    );
    if (iconBuf !== null) {
      zip.file('icon.svg', iconBuf);
    }

    const dataBase64 = await zip.generateAsync({ type: 'base64' });
    return {
      ok: true as const,
      filename: `${args.slug}.zip`,
      dataBase64,
    };
  },
});

/**
 * Best-effort teardown for a failed {@link duplicateIntegration}, in reverse of
 * creation order: remove any rebound automations, delete the credential, then
 * remove the integration dir — so a retry re-derives the same slug from a clean
 * slate. Never throws (each step is logged); the caller rethrows the original
 * error.
 */
async function cleanupDuplicatedIntegration(
  ctx: ActionCtx,
  args: {
    organizationId: string;
    orgSlug: string;
    newSlug: string;
    newDir: string;
    credentialId: Id<'integrationCredentials'> | null;
  },
): Promise<void> {
  const { organizationId, orgSlug, newSlug, newDir, credentialId } = args;
  await cleanupReboundAutomations(ctx, {
    organizationId,
    orgSlug,
    integrationSlug: newSlug,
  }).catch((error: unknown) => {
    console.error(
      `[duplicateIntegration] rebound-automation cleanup for "${newSlug}" failed:`,
      error,
    );
  });
  if (credentialId) {
    await ctx
      .runMutation(
        internal.integrations.credential_mutations.deleteCredentialsInternal,
        { credentialId },
      )
      .catch((error: unknown) => {
        console.error(
          `[duplicateIntegration] credential cleanup for "${newSlug}" failed:`,
          error,
        );
      });
  }
  await rm(newDir, { recursive: true, force: true }).catch((error: unknown) => {
    console.error(
      `[duplicateIntegration] dir cleanup for "${newSlug}" failed:`,
      error,
    );
  });
}

/**
 * Duplicate an integration under a new, unique slug: clone its config dir
 * (config.json + optional connector.ts + icon.svg) with a distinguishing
 * "<title> (N)" title, create an inactive/blank credential, and rebind any
 * bundled sync automation to the new slug so the copy gets its own sync + inbox.
 * General to any duplication-safe integration ({@link isDuplicableIntegration});
 * the automation rebind is a no-op for integrations without a bundled one
 * (REST / SQL). Gated on the same `developerSettings` capability as the other
 * integration writes.
 *
 * Multi-step (files + DB rows + automation install) with no cross-boundary
 * transaction, so on any failure it best-effort tears down in reverse order and
 * rethrows — a retry then re-derives the same slug from a clean slate.
 */
export const duplicateIntegration = action({
  args: {
    organizationId: v.string(),
    slug: v.string(),
  },
  returns: v.object({
    newSlug: v.string(),
    credentialId: v.id('integrationCredentials'),
    reboundAutomations: v.array(
      v.object({ sourceSlug: v.string(), newSlug: v.string() }),
    ),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    newSlug: string;
    credentialId: Id<'integrationCredentials'>;
    reboundAutomations: Array<{ sourceSlug: string; newSlug: string }>;
  }> => {
    if (!validateIntegrationSlug(args.slug)) {
      throw new Error(`Invalid integration slug: ${args.slug}`);
    }
    const { orgSlug, userId, email } = await requireDeveloperSettingsAccessById(
      ctx,
      args.organizationId,
    );
    const installedBy = email ? email : userId;

    const source = await readIntegrationConfigFile(orgSlug, args.slug);
    if (!source.ok) {
      throw new Error(`Cannot duplicate integration: ${source.message}`);
    }
    // Server-side duplicability guard behind the UI gate: OAuth / slug-bound
    // integrations can't be safely cloned under a new slug.
    if (
      !isDuplicableIntegration({
        slug: args.slug,
        authMethod: source.config.authMethod,
      })
    ) {
      throw new Error(
        `Integration "${args.slug}" cannot be duplicated (OAuth or provider-bound).`,
      );
    }
    // Duplicate the base template, not an instance — a duplicate is a leaf.
    if (!isBuiltinIntegrationSlug(args.slug)) {
      throw new Error(
        `Integration "${args.slug}" is already an instance; duplicate the base integration instead.`,
      );
    }

    const connectorCode = await readConnectorCode(orgSlug, args.slug);
    const iconBuf = await readFileBufferSafe(
      resolveIconPath(orgSlug, args.slug),
    );

    // Derive a unique new slug across on-disk dirs AND credential rows.
    const dirNames = await readdir(resolveIntegrationsDir(orgSlug)).catch(
      () => [] as string[],
    );
    const credentials = (await ctx.runQuery(
      internal.integrations.credential_queries.listInternal,
      { organizationId: args.organizationId },
    )) as Array<{ slug: string }>;
    const newSlug = deriveNextSlug(args.slug, [
      ...dirNames.filter(
        (e) => !e.startsWith('.') && validateIntegrationSlug(e),
      ),
      ...credentials.map((c) => c.slug),
    ]);
    if (!validateIntegrationSlug(newSlug)) {
      throw new Error(`Derived integration slug is invalid: ${newSlug}`);
    }
    // deriveNextSlug always appends `-<n>`; that trailing number distinguishes
    // the copy's title so the two show apart in the inbox channel picker.
    const suffix = newSlug.slice(newSlug.lastIndexOf('-') + 1);

    const newDir = resolveIntegrationDir(orgSlug, newSlug);
    let credentialId: Id<'integrationCredentials'> | null = null;
    try {
      await mkdir(newDir, { recursive: true });
      const dupConfig: IntegrationJsonConfig = {
        ...source.config,
        title: `${source.config.title} (${suffix})`,
      };
      await atomicWrite(
        resolveConfigPath(orgSlug, newSlug),
        serializeIntegrationJson(dupConfig),
      );
      if (connectorCode) {
        await atomicWrite(
          resolveConnectorPath(orgSlug, newSlug),
          connectorCode,
        );
      }
      // writeIntegrationFiles omits the icon; copy it byte-for-byte here.
      if (iconBuf) {
        await atomicWriteBuffer(resolveIconPath(orgSlug, newSlug), iconBuf);
      }

      // Inactive, blank credential — NO secrets, NO connectionConfig (the blank
      // config-file templates ride along in the copied config.json; the
      // operator fills in this instance's login).
      credentialId = await ctx.runMutation(
        internal.integrations.credential_mutations.createCredentials,
        {
          organizationId: args.organizationId,
          slug: newSlug,
          status: 'inactive',
          isActive: false,
          authMethod: source.config.authMethod,
          supportedAuthMethods: source.config.supportedAuthMethods,
          capabilities: source.config.capabilities,
        },
      );

      const reboundAutomations = await rebindBundledAutomations(ctx, {
        organizationId: args.organizationId,
        orgSlug,
        sourceIntegrationSlug: args.slug,
        newIntegrationSlug: newSlug,
        installedBy,
      });

      return { newSlug, credentialId, reboundAutomations };
    } catch (error) {
      await cleanupDuplicatedIntegration(ctx, {
        organizationId: args.organizationId,
        orgSlug,
        newSlug,
        newDir,
        credentialId,
      });
      throw error;
    }
  },
});

/**
 * Fully delete a DUPLICATED integration instance: remove its rebound automations,
 * its credential, and its config dir — the inverse of `duplicateIntegration`,
 * available while the instance is disconnected. Only a user-created duplicate
 * (marked `metadata.duplicatedFrom`) may be deleted this way; a builtin template
 * is refused (disconnect keeps the seeded template). Gated on the same
 * `developerSettings` capability as the other integration writes.
 */
export const deleteIntegrationInstance = action({
  args: { organizationId: v.string(), slug: v.string() },
  returns: v.object({ deleted: v.boolean() }),
  handler: async (ctx, args): Promise<{ deleted: boolean }> => {
    if (!validateIntegrationSlug(args.slug)) {
      throw new Error(`Invalid integration slug: ${args.slug}`);
    }
    const { orgSlug } = await requireDeveloperSettingsAccessById(
      ctx,
      args.organizationId,
    );
    // Safety: never fully delete a builtin template — that would take the seeded
    // template dir with it. A non-builtin instance (a duplicate or an uploaded
    // connector) is org-owned and deletable whether or not it was ever
    // connected; a builtin is only disconnected.
    if (isBuiltinIntegrationSlug(args.slug)) {
      throw new Error(
        `Integration "${args.slug}" is a built-in template; disconnect it instead of deleting.`,
      );
    }

    // Reverse the instance footprint, in creation-reverse order: rebound
    // automations, then the credential, then the config dir.
    await cleanupReboundAutomations(ctx, {
      organizationId: args.organizationId,
      orgSlug,
      integrationSlug: args.slug,
    });
    const existing = await ctx.runQuery(
      internal.integrations.credential_queries.getBySlugInternal,
      { organizationId: args.organizationId, slug: args.slug },
    );
    if (existing) {
      await ctx.runMutation(
        internal.integrations.credential_mutations.deleteCredentialsInternal,
        { credentialId: existing._id },
      );
    }
    await rm(resolveIntegrationDir(orgSlug, args.slug), {
      recursive: true,
      force: true,
    });

    return { deleted: true };
  },
});

// ---------------------------------------------------------------------------
// Internal actions (for engine and agent tools — no auth check)
// ---------------------------------------------------------------------------

export const readIntegrationForExecution = internalAction({
  args: {
    orgSlug: v.string(),
    slug: v.string(),
  },
  returns: v.any(),
  handler: async (_ctx, args) => {
    const configResult = await readIntegrationConfigFile(
      args.orgSlug,
      args.slug,
    );
    if (!configResult.ok) {
      return {
        ok: false,
        error: configResult.error,
        message: configResult.message,
      };
    }

    const connectorCode = await readConnectorCode(args.orgSlug, args.slug);

    return {
      ok: true,
      config: configResult.config,
      connectorCode,
      hash: configResult.hash,
    };
  },
});
