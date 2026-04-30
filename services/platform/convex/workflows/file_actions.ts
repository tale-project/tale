'use node';

/**
 * Workflow file I/O actions.
 *
 * All workflow config reads/writes go through these actions.
 * Uses atomic writes (temp → fsync → rename) for data safety.
 * History snapshots use epoch-ms filenames with 100-entry retention.
 * Supports compare-and-swap via expectedHash to prevent lost updates.
 */

import { mkdir, readdir, rm, unlink } from 'node:fs/promises';
import path from 'node:path';

import { v } from 'convex/values';

import type { WorkflowJsonConfig } from '../../lib/shared/schemas/workflows';
import { workflowJsonSchema } from '../../lib/shared/schemas/workflows';
import { internal } from '../_generated/api';
import { action, internalAction } from '../_generated/server';
import { authComponent } from '../auth';
import {
  atomicWrite,
  generateHistoryTimestamp,
  pruneHistory,
  readFileSafe,
  readJsonFile,
  readdirSafe,
  sha256,
  verifyPathWithinBase,
} from '../lib/file_io';
import { resolveOrgSlug } from '../organizations/resolve_org_slug';
import type { WorkflowReadResult } from './file_utils';
import {
  MAX_FILE_SIZE_BYTES,
  MAX_HISTORY_ENTRIES,
  parseWorkflowJson,
  resolveHistoryDir,
  resolveWorkflowFilePath,
  resolveWorkflowsDir,
  serializeWorkflowJson,
  validateWorkflowSlug,
  workflowSlugFromRelativePath,
} from './file_utils';

// ---------------------------------------------------------------------------
// Internal helpers
// ---------------------------------------------------------------------------

async function readWorkflowFile(
  orgSlug: string,
  workflowSlug: string,
): Promise<WorkflowReadResult> {
  const filePath = resolveWorkflowFilePath(orgSlug, workflowSlug);
  const result = await readJsonFile<WorkflowJsonConfig>(
    filePath,
    MAX_FILE_SIZE_BYTES,
    parseWorkflowJson,
  );
  if (result.ok) {
    return { ok: true, config: result.data, hash: result.hash };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public actions (called from frontend)
// ---------------------------------------------------------------------------

export const readWorkflow = action({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<WorkflowReadResult> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    return readWorkflowFile(orgSlug, args.workflowSlug);
  },
});

export const listWorkflows = action({
  args: {
    organizationId: v.string(),
    filter: v.optional(
      v.union(v.literal('installed'), v.literal('templates'), v.literal('all')),
    ),
  },
  returns: v.any(),
  // oxlint-disable-next-line typescript/no-explicit-any -- listWorkflows returns heterogeneous shapes; v.any() at API boundary
  handler: async (ctx, args): Promise<any[]> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    const filterMode = args.filter ?? 'all';
    const dir = resolveWorkflowsDir(orgSlug);
    let entries: { name: string; parentPath: string; isDirectory: boolean }[];
    try {
      const raw = await readdir(dir, { recursive: true, withFileTypes: true });
      entries = raw.map((e) => ({
        name: e.name,
        parentPath: e.parentPath ?? '',
        isDirectory: e.isDirectory(),
      }));
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        return [];
      }
      throw new Error(
        `Workflows directory inaccessible: ${err instanceof Error ? err.message : String(err)}`,
        { cause: err },
      );
    }

    const jsonFiles = entries.filter(
      (e) =>
        !e.isDirectory &&
        e.name.endsWith('.json') &&
        !e.name.startsWith('.') &&
        !e.parentPath.includes('.history'),
    );

    const installedRaw: string[] = await ctx.runQuery(
      internal.workflows.installations.listInstalledSlugs,
      { organizationId: args.organizationId },
    );
    const installedSlugs = new Set<string>(installedRaw);

    const results = await Promise.all(
      jsonFiles.map(async (entry) => {
        const relativePath = path
          .relative(dir, path.join(entry.parentPath, entry.name))
          .replace(/\\/g, '/');
        const slug = workflowSlugFromRelativePath(relativePath);

        if (!validateWorkflowSlug(slug)) return null;

        const result = await readWorkflowFile(orgSlug, slug);
        if (result.ok) {
          const installed = installedSlugs.has(slug);
          if (filterMode === 'installed' && !installed) return null;
          if (filterMode === 'templates' && installed) return null;

          return {
            slug,
            name: result.config.name,
            description: result.config.description,
            installed,
            version: result.config.version,
            stepCount: result.config.steps.length,
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
 * Save a workflow with an atomic snapshot-then-write operation.
 * Optionally performs compare-and-swap via expectedHash.
 */
export const saveWorkflowWithSnapshot = action({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
    config: v.any(),
    expectedHash: v.optional(v.string()),
  },
  returns: v.object({ hash: v.string() }),
  handler: async (ctx, args): Promise<{ hash: string }> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    if (!validateWorkflowSlug(args.workflowSlug)) {
      throw new Error(`Invalid workflow slug: ${args.workflowSlug}`);
    }

    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    const config = workflowJsonSchema.parse(args.config);
    const newContent = serializeWorkflowJson(config);
    const filePath = resolveWorkflowFilePath(orgSlug, args.workflowSlug);

    const currentContent = await readFileSafe(filePath);

    if (args.expectedHash && currentContent) {
      const currentHash = sha256(currentContent);
      if (currentHash !== args.expectedHash) {
        throw new Error(
          'Conflict: workflow was modified externally. Please refresh and try again.',
        );
      }
    }

    if (currentContent) {
      const historyDir = resolveHistoryDir(orgSlug, args.workflowSlug);
      await mkdir(historyDir, { recursive: true });
      const timestamp = generateHistoryTimestamp();
      await atomicWrite(
        path.join(historyDir, `${timestamp}.json`),
        currentContent,
      );
      await pruneHistory(historyDir, MAX_HISTORY_ENTRIES);
    }

    await atomicWrite(filePath, newContent);

    return { hash: sha256(newContent) };
  },
});

export const deleteWorkflow = action({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    if (!validateWorkflowSlug(args.workflowSlug)) {
      throw new Error(`Invalid workflow slug: ${args.workflowSlug}`);
    }

    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    const filePath = resolveWorkflowFilePath(orgSlug, args.workflowSlug);
    const historyDir = resolveHistoryDir(orgSlug, args.workflowSlug);

    await unlink(filePath).catch((err) => {
      if (err instanceof Error && 'code' in err && err.code !== 'ENOENT') {
        throw err;
      }
    });
    await rm(historyDir, { recursive: true, force: true });

    await ctx.runMutation(internal.workflows.installations.deleteInstallation, {
      organizationId: args.organizationId,
      workflowSlug: args.workflowSlug,
    });

    return null;
  },
});

export const installWorkflow = action({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
  },
  returns: v.object({ hash: v.string() }),
  handler: async (ctx, args): Promise<{ hash: string }> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    if (!validateWorkflowSlug(args.workflowSlug)) {
      throw new Error(`Invalid workflow slug: ${args.workflowSlug}`);
    }

    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    const result = await readWorkflowFile(orgSlug, args.workflowSlug);
    if (!result.ok) {
      throw new Error(`Cannot install workflow: ${result.message}`);
    }

    await ctx.runMutation(internal.workflows.installations.upsertInstallation, {
      organizationId: args.organizationId,
      workflowSlug: args.workflowSlug,
      installedBy: authUser.email ?? String(authUser._id),
      contentHash: result.hash,
    });

    return { hash: result.hash };
  },
});

export const uninstallWorkflow = action({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    if (!validateWorkflowSlug(args.workflowSlug)) {
      throw new Error(`Invalid workflow slug: ${args.workflowSlug}`);
    }

    await ctx.runMutation(internal.workflows.installations.deleteInstallation, {
      organizationId: args.organizationId,
      workflowSlug: args.workflowSlug,
    });

    return null;
  },
});

export const duplicateWorkflow = action({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
  },
  returns: v.object({ newSlug: v.string() }),
  handler: async (ctx, args): Promise<{ newSlug: string }> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    const source = await readWorkflowFile(orgSlug, args.workflowSlug);
    if (!source.ok) {
      throw new Error(`Cannot duplicate: ${source.message}`);
    }

    const parts = args.workflowSlug.split('/');
    const baseName = parts.pop() ?? args.workflowSlug;
    const folderPrefix = parts.length > 0 ? parts.join('/') + '/' : '';

    const dir = resolveWorkflowsDir(orgSlug);
    const targetDir = folderPrefix.length > 0 ? path.join(dir, ...parts) : dir;
    const existingFiles = await readdirSafe(targetDir);
    const existingNames = new Set(
      existingFiles
        .filter((e) => e.endsWith('.json'))
        .map((e) => e.replace(/\.json$/, '')),
    );

    let newBaseName = `${baseName}-copy`;
    let counter = 2;
    while (existingNames.has(newBaseName)) {
      newBaseName = `${baseName}-copy-${counter}`;
      counter++;
    }

    const newSlug = `${folderPrefix}${newBaseName}`;
    const newConfig: WorkflowJsonConfig = {
      ...source.config,
      name: `${source.config.name} (Copy)`,
    };

    const content = serializeWorkflowJson(newConfig);
    const filePath = resolveWorkflowFilePath(orgSlug, newSlug);
    await atomicWrite(filePath, content);

    await ctx.runMutation(internal.workflows.installations.upsertInstallation, {
      organizationId: args.organizationId,
      workflowSlug: newSlug,
      installedBy: authUser.email ?? String(authUser._id),
      contentHash: sha256(content),
    });

    return { newSlug };
  },
});

export const renameWorkflow = action({
  args: {
    organizationId: v.string(),
    oldSlug: v.string(),
    newSlug: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    if (!validateWorkflowSlug(args.oldSlug)) {
      throw new Error(`Invalid old slug: ${args.oldSlug}`);
    }
    if (!validateWorkflowSlug(args.newSlug)) {
      throw new Error(`Invalid new slug: ${args.newSlug}`);
    }

    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    const oldPath = resolveWorkflowFilePath(orgSlug, args.oldSlug);
    const newPath = resolveWorkflowFilePath(orgSlug, args.newSlug);
    const baseDir = resolveWorkflowsDir(orgSlug);

    await verifyPathWithinBase(oldPath, baseDir);
    await verifyPathWithinBase(newPath, baseDir);

    const content = await readFileSafe(oldPath);
    if (!content) throw new Error('Workflow not found');
    parseWorkflowJson(content);

    await mkdir(path.dirname(newPath), { recursive: true });
    await atomicWrite(newPath, content);
    await unlink(oldPath);

    const oldHistoryDir = resolveHistoryDir(orgSlug, args.oldSlug);
    const newHistoryDir = resolveHistoryDir(orgSlug, args.newSlug);
    try {
      await mkdir(path.dirname(newHistoryDir), { recursive: true });
      const { rename: fsRename } = await import('node:fs/promises');
      await fsRename(oldHistoryDir, newHistoryDir);
    } catch (err) {
      console.warn('[renameWorkflow] history move failed', err);
    }

    const existingInstallation = await ctx.runQuery(
      internal.workflows.installations.getInstallationInternal,
      {
        organizationId: args.organizationId,
        workflowSlug: args.oldSlug,
      },
    );
    if (existingInstallation) {
      await ctx.runMutation(
        internal.workflows.installations.deleteInstallation,
        {
          organizationId: args.organizationId,
          workflowSlug: args.oldSlug,
        },
      );
      await ctx.runMutation(
        internal.workflows.installations.upsertInstallation,
        {
          organizationId: args.organizationId,
          workflowSlug: args.newSlug,
          installedBy: existingInstallation.installedBy,
          contentHash: existingInstallation.contentHash,
        },
      );
    }

    return null;
  },
});

export const listHistory = action({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    const historyDir = resolveHistoryDir(orgSlug, args.workflowSlug);
    const entries = await readdirSafe(historyDir);

    return entries
      .filter((e) => e.endsWith('.json'))
      .map((e) => {
        const ts = e.replace('.json', '');
        const numericPart = ts.split('-')[0];
        return {
          timestamp: ts,
          date: new Date(Number(numericPart)).toISOString(),
        };
      })
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp));
  },
});

export const readHistoryEntry = action({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
    timestamp: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    const historyDir = resolveHistoryDir(orgSlug, args.workflowSlug);
    const filePath = path.join(historyDir, `${args.timestamp}.json`);

    const resolved = path.resolve(filePath);
    if (!resolved.startsWith(path.resolve(historyDir))) {
      throw new Error('Path traversal detected');
    }

    const content = await readFileSafe(filePath);
    if (!content) {
      return {
        ok: false,
        message: `History entry not found: ${args.timestamp}`,
      };
    }
    try {
      return { ok: true, config: parseWorkflowJson(content) };
    } catch (err) {
      return {
        ok: false,
        message: `Corrupted history entry: ${err instanceof Error ? err.message : String(err)}`,
      };
    }
  },
});

export const restoreFromHistory = action({
  args: {
    organizationId: v.string(),
    workflowSlug: v.string(),
    timestamp: v.string(),
  },
  returns: v.object({ hash: v.string() }),
  handler: async (ctx, args): Promise<{ hash: string }> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    const historyDir = resolveHistoryDir(orgSlug, args.workflowSlug);
    const historyPath = path.join(historyDir, `${args.timestamp}.json`);
    const workflowPath = resolveWorkflowFilePath(orgSlug, args.workflowSlug);

    const resolved = path.resolve(historyPath);
    if (!resolved.startsWith(path.resolve(historyDir))) {
      throw new Error('Path traversal detected');
    }

    const historyContent = await readFileSafe(historyPath);
    if (!historyContent) throw new Error('History entry not found');
    parseWorkflowJson(historyContent);

    // Snapshot current state before overwriting
    const currentContent = await readFileSafe(workflowPath);

    // Write the restored version
    await atomicWrite(workflowPath, historyContent);

    // Snapshot the previous state (best-effort)
    if (currentContent) {
      await mkdir(historyDir, { recursive: true });
      const ts = generateHistoryTimestamp();
      await atomicWrite(path.join(historyDir, `${ts}.json`), currentContent);
      await pruneHistory(historyDir, MAX_HISTORY_ENTRIES);
    }

    return { hash: sha256(historyContent) };
  },
});

// ---------------------------------------------------------------------------
// Internal actions (for engine and agent tools — no auth check)
// ---------------------------------------------------------------------------

export const saveWorkflowForExecution = internalAction({
  args: {
    orgSlug: v.string(),
    workflowSlug: v.string(),
    config: v.any(),
  },
  returns: v.object({ hash: v.string() }),
  handler: async (_ctx, args): Promise<{ hash: string }> => {
    if (!validateWorkflowSlug(args.workflowSlug)) {
      throw new Error(`Invalid workflow slug: ${args.workflowSlug}`);
    }

    const config = workflowJsonSchema.parse(args.config);
    const newContent = serializeWorkflowJson(config);
    const filePath = resolveWorkflowFilePath(args.orgSlug, args.workflowSlug);

    const currentContent = await readFileSafe(filePath);

    if (currentContent) {
      const historyDir = resolveHistoryDir(args.orgSlug, args.workflowSlug);
      await mkdir(historyDir, { recursive: true });
      const timestamp = generateHistoryTimestamp();
      await atomicWrite(
        path.join(historyDir, `${timestamp}.json`),
        currentContent,
      );
      await pruneHistory(historyDir, MAX_HISTORY_ENTRIES);
    } else {
      const dir = path.dirname(filePath);
      await mkdir(dir, { recursive: true });
    }

    await atomicWrite(filePath, newContent);

    return { hash: sha256(newContent) };
  },
});

export const readWorkflowForExecution = internalAction({
  args: {
    orgSlug: v.string(),
    workflowSlug: v.string(),
  },
  returns: v.any(),
  handler: async (_ctx, args): Promise<WorkflowReadResult> => {
    return readWorkflowFile(args.orgSlug, args.workflowSlug);
  },
});

export const listWorkflowsForAgent = internalAction({
  args: {
    orgSlug: v.string(),
    organizationId: v.string(),
  },
  returns: v.any(),
  // oxlint-disable-next-line typescript/no-explicit-any -- v.any() at API boundary
  handler: async (ctx, args): Promise<any[]> => {
    const dir = resolveWorkflowsDir(args.orgSlug);
    let raw;
    try {
      raw = await readdir(dir, { recursive: true, withFileTypes: true });
    } catch {
      return [];
    }

    const jsonFiles = raw.filter(
      (e) =>
        !e.isDirectory() &&
        e.name.endsWith('.json') &&
        !e.name.startsWith('.') &&
        !(e.parentPath ?? '').includes('.history'),
    );

    const installedRaw: string[] = await ctx.runQuery(
      internal.workflows.installations.listInstalledSlugs,
      { organizationId: args.organizationId },
    );
    const installedSlugs = new Set<string>(installedRaw);

    const results = await Promise.all(
      jsonFiles.map(async (entry) => {
        const parentPath = entry.parentPath ?? '';
        const relativePath = path
          .relative(dir, path.join(parentPath, entry.name))
          .replace(/\\/g, '/');
        const slug = workflowSlugFromRelativePath(relativePath);

        if (!validateWorkflowSlug(slug)) return null;
        if (!installedSlugs.has(slug)) return null;

        const result = await readWorkflowFile(args.orgSlug, slug);
        if (result.ok) {
          return {
            slug,
            name: result.config.name,
            description: result.config.description,
            stepCount: result.config.steps.length,
          };
        }
        return null;
      }),
    );

    return results.filter(Boolean);
  },
});

export const getAvailableWorkflows = action({
  args: {
    organizationId: v.string(),
  },
  returns: v.array(
    v.object({
      id: v.string(),
      name: v.string(),
      description: v.optional(v.string()),
    }),
  ),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) return [];

    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    const dir = resolveWorkflowsDir(orgSlug);
    let raw;
    try {
      raw = await readdir(dir, { recursive: true, withFileTypes: true });
    } catch {
      return [];
    }

    const jsonFiles = raw.filter(
      (e) =>
        !e.isDirectory() &&
        e.name.endsWith('.json') &&
        !e.name.startsWith('.') &&
        !(e.parentPath ?? '').includes('.history'),
    );

    const installedRaw: string[] = await ctx.runQuery(
      internal.workflows.installations.listInstalledSlugs,
      { organizationId: args.organizationId },
    );
    const installedSlugs = new Set<string>(installedRaw);

    const workflows: Array<{
      id: string;
      name: string;
      description?: string;
    }> = [];

    for (const entry of jsonFiles) {
      const parentPath = entry.parentPath ?? '';
      const relativePath = path
        .relative(dir, path.join(parentPath, entry.name))
        .replace(/\\/g, '/');
      const slug = workflowSlugFromRelativePath(relativePath);

      if (!validateWorkflowSlug(slug)) continue;
      if (!installedSlugs.has(slug)) continue;

      const result = await readWorkflowFile(orgSlug, slug);
      if (result.ok) {
        workflows.push({
          id: slug,
          name: result.config.name,
          ...(result.config.description && {
            description: result.config.description,
          }),
        });
      }
    }

    return workflows;
  },
});
