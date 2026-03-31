'use node';

/**
 * Workflow file I/O actions.
 *
 * All workflow config reads/writes go through these actions.
 * Uses atomic writes (temp → fsync → rename) for data safety.
 * History snapshots use epoch-ms filenames with 100-entry retention.
 * Supports compare-and-swap via expectedHash to prevent lost updates.
 */

import { v } from 'convex/values';
import { mkdir, readdir, rm, unlink } from 'node:fs/promises';
import path from 'node:path';

import type { WorkflowJsonConfig } from '../../lib/shared/schemas/workflows';
import type { WorkflowReadResult } from './file_utils';

import { workflowJsonSchema } from '../../lib/shared/schemas/workflows';
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
    orgSlug: v.string(),
    workflowSlug: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<WorkflowReadResult> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    return readWorkflowFile(args.orgSlug, args.workflowSlug);
  },
});

export const listWorkflows = action({
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
    const dir = resolveWorkflowsDir(args.orgSlug);
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

    const results = await Promise.all(
      jsonFiles.map(async (entry) => {
        const relativePath = path
          .relative(dir, path.join(entry.parentPath, entry.name))
          .replace(/\\/g, '/');
        const slug = workflowSlugFromRelativePath(relativePath);

        if (!validateWorkflowSlug(slug)) return null;

        const result = await readWorkflowFile(args.orgSlug, slug);
        if (result.ok) {
          const installed = result.config.installed ?? false;
          if (filterMode === 'installed' && !installed) return null;
          if (filterMode === 'templates' && installed) return null;

          return {
            slug,
            name: result.config.name,
            description: result.config.description,
            installed,
            enabled: result.config.enabled,
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
    orgSlug: v.string(),
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

    const config = workflowJsonSchema.parse(args.config);
    const newContent = serializeWorkflowJson(config);
    const filePath = resolveWorkflowFilePath(args.orgSlug, args.workflowSlug);

    // Read current file for snapshot and CAS check
    const currentContent = await readFileSafe(filePath);

    // Compare-and-swap: reject if file changed since client last read it
    if (args.expectedHash && currentContent) {
      const currentHash = sha256(currentContent);
      if (currentHash !== args.expectedHash) {
        throw new Error(
          'Conflict: workflow was modified externally. Please refresh and try again.',
        );
      }
    }

    // Snapshot current content to history before overwriting
    if (currentContent) {
      const historyDir = resolveHistoryDir(args.orgSlug, args.workflowSlug);
      await mkdir(historyDir, { recursive: true });
      const timestamp = generateHistoryTimestamp();
      await atomicWrite(
        path.join(historyDir, `${timestamp}.json`),
        currentContent,
      );
      await pruneHistory(historyDir, MAX_HISTORY_ENTRIES);
    }

    // Write new content atomically
    await atomicWrite(filePath, newContent);

    return { hash: sha256(newContent) };
  },
});

export const deleteWorkflow = action({
  args: {
    orgSlug: v.string(),
    workflowSlug: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    if (!validateWorkflowSlug(args.workflowSlug)) {
      throw new Error(`Invalid workflow slug: ${args.workflowSlug}`);
    }

    const filePath = resolveWorkflowFilePath(args.orgSlug, args.workflowSlug);
    const historyDir = resolveHistoryDir(args.orgSlug, args.workflowSlug);

    await unlink(filePath).catch((err) => {
      if (err instanceof Error && 'code' in err && err.code !== 'ENOENT') {
        throw err;
      }
    });
    await rm(historyDir, { recursive: true, force: true });

    return null;
  },
});

export const installWorkflow = action({
  args: {
    orgSlug: v.string(),
    workflowSlug: v.string(),
  },
  returns: v.object({ hash: v.string() }),
  handler: async (ctx, args): Promise<{ hash: string }> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    if (!validateWorkflowSlug(args.workflowSlug)) {
      throw new Error(`Invalid workflow slug: ${args.workflowSlug}`);
    }

    const result = await readWorkflowFile(args.orgSlug, args.workflowSlug);
    if (!result.ok) {
      throw new Error(`Cannot install workflow: ${result.message}`);
    }

    if (result.config.installed) {
      return { hash: result.hash };
    }

    const updatedConfig: WorkflowJsonConfig = {
      ...result.config,
      installed: true,
    };

    const newContent = serializeWorkflowJson(updatedConfig);
    const filePath = resolveWorkflowFilePath(args.orgSlug, args.workflowSlug);

    const historyDir = resolveHistoryDir(args.orgSlug, args.workflowSlug);
    await mkdir(historyDir, { recursive: true });
    const currentContent = await readFileSafe(filePath);
    if (currentContent) {
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

export const duplicateWorkflow = action({
  args: {
    orgSlug: v.string(),
    workflowSlug: v.string(),
  },
  returns: v.object({ newSlug: v.string() }),
  handler: async (ctx, args): Promise<{ newSlug: string }> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const source = await readWorkflowFile(args.orgSlug, args.workflowSlug);
    if (!source.ok) {
      throw new Error(`Cannot duplicate: ${source.message}`);
    }

    // Determine the folder prefix and base name
    const parts = args.workflowSlug.split('/');
    const baseName = parts.pop() ?? args.workflowSlug;
    const folderPrefix = parts.length > 0 ? parts.join('/') + '/' : '';

    // Find a unique name
    const dir = resolveWorkflowsDir(args.orgSlug);
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
      installed: true,
      enabled: false,
    };

    const content = serializeWorkflowJson(newConfig);
    const filePath = resolveWorkflowFilePath(args.orgSlug, newSlug);
    await atomicWrite(filePath, content);

    return { newSlug };
  },
});

export const renameWorkflow = action({
  args: {
    orgSlug: v.string(),
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

    const oldPath = resolveWorkflowFilePath(args.orgSlug, args.oldSlug);
    const newPath = resolveWorkflowFilePath(args.orgSlug, args.newSlug);
    const baseDir = resolveWorkflowsDir(args.orgSlug);

    await verifyPathWithinBase(oldPath, baseDir);
    await verifyPathWithinBase(newPath, baseDir);

    // Read, validate, then write to new location
    const content = await readFileSafe(oldPath);
    if (!content) throw new Error('Workflow not found');
    parseWorkflowJson(content);

    await mkdir(path.dirname(newPath), { recursive: true });
    await atomicWrite(newPath, content);
    await unlink(oldPath);

    // Move history directory
    const oldHistoryDir = resolveHistoryDir(args.orgSlug, args.oldSlug);
    const newHistoryDir = resolveHistoryDir(args.orgSlug, args.newSlug);
    try {
      await mkdir(path.dirname(newHistoryDir), { recursive: true });
      const { rename: fsRename } = await import('node:fs/promises');
      await fsRename(oldHistoryDir, newHistoryDir);
    } catch {
      // History migration is best-effort
    }

    return null;
  },
});

export const listHistory = action({
  args: {
    orgSlug: v.string(),
    workflowSlug: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const historyDir = resolveHistoryDir(args.orgSlug, args.workflowSlug);
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
    orgSlug: v.string(),
    workflowSlug: v.string(),
    timestamp: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const historyDir = resolveHistoryDir(args.orgSlug, args.workflowSlug);
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
    orgSlug: v.string(),
    workflowSlug: v.string(),
    timestamp: v.string(),
  },
  returns: v.object({ hash: v.string() }),
  handler: async (ctx, args): Promise<{ hash: string }> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const historyDir = resolveHistoryDir(args.orgSlug, args.workflowSlug);
    const historyPath = path.join(historyDir, `${args.timestamp}.json`);
    const workflowPath = resolveWorkflowFilePath(
      args.orgSlug,
      args.workflowSlug,
    );

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
  },
  returns: v.any(),
  handler: async (_ctx, args) => {
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

    const results = await Promise.all(
      jsonFiles.map(async (entry) => {
        const parentPath = entry.parentPath ?? '';
        const relativePath = path
          .relative(dir, path.join(parentPath, entry.name))
          .replace(/\\/g, '/');
        const slug = workflowSlugFromRelativePath(relativePath);

        if (!validateWorkflowSlug(slug)) return null;

        const result = await readWorkflowFile(args.orgSlug, slug);
        if (result.ok && result.config.installed) {
          return {
            slug,
            name: result.config.name,
            description: result.config.description,
            enabled: result.config.enabled,
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
  handler: async (ctx, _args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) return [];

    const dir = resolveWorkflowsDir('default');
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

      const result = await readWorkflowFile('default', slug);
      if (result.ok && result.config.installed && result.config.enabled) {
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
