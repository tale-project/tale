'use node';

/**
 * Agent file I/O actions.
 *
 * All agent config reads/writes go through these actions.
 * Uses atomic writes (temp → fsync → rename) for data safety.
 * History snapshots use epoch-ms filenames with 100-entry retention.
 */

import { v } from 'convex/values';
import { mkdir, readdir, rm, unlink } from 'node:fs/promises';
import path from 'node:path';

import type { AgentJsonConfig, AgentReadResult } from './file_utils';

import { agentJsonSchema } from '../../lib/shared/schemas/agents';
import { action, internalAction } from '../_generated/server';
import { authComponent } from '../auth';
import {
  atomicWrite,
  generateHistoryTimestamp,
  pruneHistory,
  readFileSafe,
  readJsonFile,
  sha256,
} from '../lib/file_io';
import {
  MAX_FILE_SIZE_BYTES,
  MAX_HISTORY_ENTRIES,
  agentNameFromFileName,
  parseAgentJson,
  resolveAgentFilePath,
  resolveAgentsDir,
  resolveHistoryDir,
  serializeAgentJson,
  validateAgentName,
} from './file_utils';

async function readAgentFile(
  orgSlug: string,
  agentName: string,
): Promise<AgentReadResult> {
  const filePath = resolveAgentFilePath(orgSlug, agentName);
  const result = await readJsonFile<AgentJsonConfig>(
    filePath,
    MAX_FILE_SIZE_BYTES,
    parseAgentJson,
  );
  if (result.ok) {
    return { ok: true, config: result.data, hash: result.hash };
  }
  return result;
}

// ---------------------------------------------------------------------------
// Public actions (called from frontend)
// ---------------------------------------------------------------------------

export const readAgent = action({
  args: {
    orgSlug: v.string(),
    agentName: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<AgentReadResult> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');
    return readAgentFile(args.orgSlug, args.agentName);
  },
});

export const listAgents = action({
  args: {
    orgSlug: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const dir = resolveAgentsDir(args.orgSlug);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      return [];
    }

    const jsonFiles = entries.filter(
      (e) => e.endsWith('.json') && !e.startsWith('.'),
    );

    const results = await Promise.all(
      jsonFiles.map(async (fileName) => {
        const agentName = agentNameFromFileName(fileName);
        if (!validateAgentName(agentName)) return null;
        const result = await readAgentFile(args.orgSlug, agentName);
        if (result.ok) {
          return {
            name: agentName,
            displayName: result.config.displayName,
            description: result.config.description,
            visibleInChat: result.config.visibleInChat,
            modelPreset: result.config.modelPreset,
            toolNames: result.config.toolNames,
            roleRestriction: result.config.roleRestriction,
            conversationStarters: result.config.conversationStarters,
          };
        }
        return {
          name: agentName,
          status: result.error,
          message: result.message,
        };
      }),
    );

    return results.filter(Boolean);
  },
});

export const saveAgent = action({
  args: {
    orgSlug: v.string(),
    agentName: v.string(),
    config: v.any(),
  },
  returns: v.object({ hash: v.string() }),
  handler: async (ctx, args): Promise<{ hash: string }> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    if (!validateAgentName(args.agentName)) {
      throw new Error(`Invalid agent name: ${args.agentName}`);
    }

    const config = agentJsonSchema.parse(args.config);
    const content = serializeAgentJson(config);
    const filePath = resolveAgentFilePath(args.orgSlug, args.agentName);

    // Write new data FIRST (critical path)
    await atomicWrite(filePath, content);

    // Snapshot previous state to history SECOND (best-effort)
    // Note: we snapshot the NEW content as a history record of this save.
    // The actual "previous" content was the file before this write.
    // For simplicity, we read back what we just wrote — the caller should
    // pass the previous content if they want true pre-save snapshots.
    // In practice, the UI sends the full new config, so we snapshot the
    // file that existed before by reading it before writing.
    // Let's fix the order: snapshot first, then write.

    // Actually, per review findings: write first, snapshot second.
    // The snapshot is of the PREVIOUS file content, but since we already
    // overwrote it, we need a different approach.
    // The correct flow: the caller reads current state before editing,
    // so the UI holds the "before" state. We just write the new state.
    // History is created by snapshotToHistory action called separately.

    return { hash: sha256(content) };
  },
});

export const snapshotToHistory = action({
  args: {
    orgSlug: v.string(),
    agentName: v.string(),
  },
  returns: v.union(v.object({ timestamp: v.string() }), v.null()),
  handler: async (ctx, args): Promise<{ timestamp: string } | null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const filePath = resolveAgentFilePath(args.orgSlug, args.agentName);
    const currentContent = await readFileSafe(filePath);
    if (!currentContent) return null;

    const historyDir = resolveHistoryDir(args.orgSlug, args.agentName);
    await mkdir(historyDir, { recursive: true });

    const timestamp = generateHistoryTimestamp();
    const historyPath = path.join(historyDir, `${timestamp}.json`);
    await atomicWrite(historyPath, currentContent);

    await pruneHistory(historyDir, MAX_HISTORY_ENTRIES);

    return { timestamp };
  },
});

export const duplicateAgent = action({
  args: {
    orgSlug: v.string(),
    agentName: v.string(),
  },
  returns: v.object({ newAgentName: v.string() }),
  handler: async (ctx, args): Promise<{ newAgentName: string }> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const source = await readAgentFile(args.orgSlug, args.agentName);
    if (!source.ok) {
      throw new Error(`Cannot duplicate: ${source.message}`);
    }

    const dir = resolveAgentsDir(args.orgSlug);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch {
      entries = [];
    }
    const existingNames = new Set(
      entries
        .filter((e) => e.endsWith('.json'))
        .map((e) => agentNameFromFileName(e)),
    );

    let newName = `${args.agentName}-copy`;
    let counter = 2;
    while (existingNames.has(newName)) {
      newName = `${args.agentName}-copy-${counter}`;
      counter++;
    }

    const newConfig: AgentJsonConfig = {
      ...source.config,
      displayName: `${source.config.displayName} (Copy)`,
      visibleInChat: false,
    };

    const content = serializeAgentJson(newConfig);
    const filePath = resolveAgentFilePath(args.orgSlug, newName);
    await atomicWrite(filePath, content);

    return { newAgentName: newName };
  },
});

export const deleteAgent = action({
  args: {
    orgSlug: v.string(),
    agentName: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const filePath = resolveAgentFilePath(args.orgSlug, args.agentName);
    const historyDir = resolveHistoryDir(args.orgSlug, args.agentName);

    await unlink(filePath).catch(() => {});
    await rm(historyDir, { recursive: true, force: true }).catch(() => {});

    return null;
  },
});

export const listHistory = action({
  args: {
    orgSlug: v.string(),
    agentName: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const historyDir = resolveHistoryDir(args.orgSlug, args.agentName);
    let entries: string[];
    try {
      entries = await readdir(historyDir);
    } catch {
      return [];
    }

    return entries
      .filter((e) => e.endsWith('.json'))
      .map((e) => {
        const ts = e.replace('.json', '');
        const epochMs = Number(ts.split('-')[0]);
        return { timestamp: ts, date: new Date(epochMs).toISOString() };
      })
      .sort((a, b) => Number(b.timestamp) - Number(a.timestamp));
  },
});

export const readHistoryEntry = action({
  args: {
    orgSlug: v.string(),
    agentName: v.string(),
    timestamp: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const historyDir = resolveHistoryDir(args.orgSlug, args.agentName);
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
      return { ok: true, config: parseAgentJson(content) };
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
    agentName: v.string(),
    timestamp: v.string(),
  },
  returns: v.object({ hash: v.string() }),
  handler: async (ctx, args): Promise<{ hash: string }> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const historyDir = resolveHistoryDir(args.orgSlug, args.agentName);
    const historyPath = path.join(historyDir, `${args.timestamp}.json`);
    const agentPath = resolveAgentFilePath(args.orgSlug, args.agentName);

    const resolved = path.resolve(historyPath);
    if (!resolved.startsWith(path.resolve(historyDir))) {
      throw new Error('Path traversal detected');
    }

    const historyContent = await readFileSafe(historyPath);
    if (!historyContent) throw new Error('History entry not found');
    parseAgentJson(historyContent);

    // Snapshot current state before overwriting
    const currentContent = await readFileSafe(agentPath);

    // Write the restored version
    await atomicWrite(agentPath, historyContent);

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
// Internal action for reading agent config during chat execution
// ---------------------------------------------------------------------------

export const readAgentForChat = internalAction({
  args: {
    orgSlug: v.string(),
    agentName: v.string(),
  },
  returns: v.any(),
  handler: async (_ctx, args): Promise<AgentReadResult> => {
    return readAgentFile(args.orgSlug, args.agentName);
  },
});
