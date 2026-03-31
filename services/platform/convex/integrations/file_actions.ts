'use node';

/**
 * Integration file I/O actions.
 *
 * All integration config reads/writes go through these actions.
 * Uses atomic writes (temp -> fsync -> rename) for data safety.
 * Supports compare-and-swap via expectedHash to prevent lost updates.
 */

import { v } from 'convex/values';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import type { IntegrationJsonConfig } from '../../lib/shared/schemas/integrations';
import type { IntegrationReadResult } from './file_utils';

import { internal } from '../_generated/api';
import { action, internalAction } from '../_generated/server';
import { authComponent } from '../auth';
import {
  atomicWrite,
  readFileSafe,
  readJsonFile,
  sha256,
} from '../lib/file_io';
import {
  MAX_FILE_SIZE_BYTES,
  parseIntegrationJson,
  resolveConfigPath,
  resolveConnectorPath,
  resolveIntegrationDir,
  resolveIntegrationsDir,
  serializeIntegrationJson,
  validateIntegrationSlug,
} from './file_utils';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function readIntegrationConfigFile(
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
    orgSlug: v.string(),
    slug: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    const configResult = await readIntegrationConfigFile(
      args.orgSlug,
      args.slug,
    );
    if (!configResult.ok) return configResult;
    const connectorCode = await readConnectorCode(args.orgSlug, args.slug);
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
    orgSlug: v.string(),
    filter: v.optional(
      v.union(v.literal('installed'), v.literal('templates'), v.literal('all')),
    ),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const filterMode = args.filter ?? 'all';
    const dir = resolveIntegrationsDir(args.orgSlug);

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

    const results = await Promise.all(
      dirs.map(async (slug) => {
        const result = await readIntegrationConfigFile(args.orgSlug, slug);
        if (result.ok) {
          const installed = result.config.installed ?? false;
          if (filterMode === 'installed' && !installed) return null;
          if (filterMode === 'templates' && installed) return null;

          return {
            slug,
            title: result.config.title,
            description: result.config.description,
            installed,
            type: result.config.type,
            authMethod: result.config.authMethod,
            supportedAuthMethods: result.config.supportedAuthMethods,
            secretBindings: result.config.secretBindings,
            allowedHosts: result.config.allowedHosts,
            operations: result.config.operations,
            connectionConfig: result.config.connectionConfig,
            capabilities: result.config.capabilities,
            oauth2Config: result.config.oauth2Config,
            sqlConnectionConfig: result.config.sqlConnectionConfig,
            sqlOperations: result.config.sqlOperations,
            operationCount: result.config.operations?.length ?? 0,
            metadata: result.config.metadata,
            hash: result.hash,
          };
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

/**
 * Save an integration config with an atomic write.
 * Optionally performs compare-and-swap via expectedHash.
 */
export const saveIntegrationConfig = action({
  args: {
    orgSlug: v.string(),
    slug: v.string(),
    config: v.any(),
    expectedHash: v.optional(v.string()),
  },
  returns: v.object({ hash: v.string() }),
  handler: async (ctx, args): Promise<{ hash: string }> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    if (!validateIntegrationSlug(args.slug)) {
      throw new Error(`Invalid integration slug: ${args.slug}`);
    }

    const config = parseIntegrationJson(JSON.stringify(args.config));
    const newContent = serializeIntegrationJson(config);
    const filePath = resolveConfigPath(args.orgSlug, args.slug);

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
    orgSlug: v.string(),
    slug: v.string(),
    organizationId: v.string(),
  },
  returns: v.object({ hash: v.string() }),
  handler: async (ctx, args): Promise<{ hash: string }> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    if (!validateIntegrationSlug(args.slug)) {
      throw new Error(`Invalid integration slug: ${args.slug}`);
    }

    const result = await readIntegrationConfigFile(args.orgSlug, args.slug);
    if (!result.ok) {
      throw new Error(`Cannot install integration: ${result.message}`);
    }

    // Ensure credential record exists in DB (inactive until user configures credentials)
    const existing = await ctx.runQuery(
      internal.integrations.credential_queries.getBySlugInternal,
      { organizationId: args.organizationId, slug: args.slug },
    );

    if (!existing) {
      await ctx.runMutation(
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
    }

    if (result.config.installed) {
      return { hash: result.hash };
    }

    // Set installed: true in config.json
    const updatedConfig: IntegrationJsonConfig = {
      ...result.config,
      installed: true,
    };

    const newContent = serializeIntegrationJson(updatedConfig);
    const filePath = resolveConfigPath(args.orgSlug, args.slug);
    await atomicWrite(filePath, newContent);

    return { hash: sha256(newContent) };
  },
});

export const uninstallIntegration = action({
  args: {
    orgSlug: v.string(),
    slug: v.string(),
  },
  returns: v.object({ hash: v.string() }),
  handler: async (ctx, args): Promise<{ hash: string }> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    if (!validateIntegrationSlug(args.slug)) {
      throw new Error(`Invalid integration slug: ${args.slug}`);
    }

    const result = await readIntegrationConfigFile(args.orgSlug, args.slug);
    if (!result.ok) {
      throw new Error(`Cannot uninstall integration: ${result.message}`);
    }

    if (!result.config.installed) {
      return { hash: result.hash };
    }

    const updatedConfig: IntegrationJsonConfig = {
      ...result.config,
      installed: false,
    };

    const newContent = serializeIntegrationJson(updatedConfig);
    const filePath = resolveConfigPath(args.orgSlug, args.slug);
    await atomicWrite(filePath, newContent);

    return { hash: sha256(newContent) };
  },
});

/**
 * Write integration files to disk for a custom upload.
 */
export const writeIntegrationFiles = action({
  args: {
    orgSlug: v.string(),
    slug: v.string(),
    config: v.any(),
    connectorCode: v.optional(v.string()),
  },
  returns: v.object({ hash: v.string() }),
  handler: async (ctx, args): Promise<{ hash: string }> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    if (!validateIntegrationSlug(args.slug)) {
      throw new Error(`Invalid integration slug: ${args.slug}`);
    }

    const config = parseIntegrationJson(JSON.stringify(args.config));
    const configContent = serializeIntegrationJson(config);
    const integrationDir = resolveIntegrationDir(args.orgSlug, args.slug);

    const { mkdir } = await import('node:fs/promises');
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

export const listIntegrationsForAgent = internalAction({
  args: {
    orgSlug: v.string(),
  },
  returns: v.any(),
  handler: async (_ctx, args) => {
    const dir = resolveIntegrationsDir(args.orgSlug);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return [];
    }

    const dirs = entries.filter(
      (e) => !e.startsWith('.') && validateIntegrationSlug(e),
    );

    const results = await Promise.all(
      dirs.map(async (slug) => {
        const result = await readIntegrationConfigFile(args.orgSlug, slug);
        if (result.ok && result.config.installed) {
          return {
            slug,
            title: result.config.title,
            description: result.config.description,
            type: result.config.type,
            operationCount: result.config.operations?.length ?? 0,
          };
        }
        return null;
      }),
    );

    return results.filter(Boolean);
  },
});
