'use node';

/**
 * Agent file I/O actions.
 *
 * All agent config reads/writes go through these actions.
 * Uses atomic writes (temp → fsync → rename) for data safety.
 * History snapshots use epoch-ms filenames with 100-entry retention.
 */

import { mkdir, readdir, rm, unlink } from 'node:fs/promises';
import path from 'node:path';

import { ConvexError, v } from 'convex/values';
import { ZodError } from 'zod/v4';

import { PROTECTED_AGENT_NAMES } from '../../lib/shared/constants/agents';
import { agentJsonSchema } from '../../lib/shared/schemas/agents';
import { parseModelRef } from '../../lib/shared/utils/model-ref';
import { normalizeAgentConfig } from '../../lib/shared/utils/normalize-agent-config';
import { resolveAgentLocale } from '../../lib/shared/utils/resolve-agent-locale';
import { internal } from '../_generated/api';
import { action, internalAction } from '../_generated/server';
import { authComponent } from '../auth';
import type { SerializableAgentConfig } from '../lib/agent_chat/types';
import {
  atomicWrite,
  generateHistoryTimestamp,
  pruneHistory,
  readFileSafe,
  readJsonFile,
  sha256,
} from '../lib/file_io';
import { stripNulls } from '../lib/strip_nulls';
import type { AgentJsonConfig, AgentReadResult } from './file_utils';
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
            primaryBehavior: result.config.primaryBehavior,
            supportedModels: result.config.supportedModels,
            toolNames: result.config.toolNames,
            integrationBindings: result.config.integrationBindings,
            roleRestriction: result.config.roleRestriction,
            conversationStarters: result.config.conversationStarters,
            composerMode: result.config.composerMode,
            i18n: result.config.i18n,
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
    isNew: v.optional(v.boolean()),
    oldAgentName: v.optional(v.string()),
    /**
     * Better Auth organization ID — used to resolve the org's `defaultLocale`
     * so the write-boundary normalization retires top-level translatables
     * against the right locale. Optional for backward compat; when omitted,
     * normalization falls back to the app default locale (`en`).
     */
    organizationId: v.optional(v.string()),
  },
  returns: v.object({
    hash: v.string(),
    warnings: v.optional(v.array(v.string())),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ hash: string; warnings?: string[] }> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    if (!validateAgentName(args.agentName)) {
      throw new Error(`Invalid agent name: ${args.agentName}`);
    }

    let config;
    try {
      config = agentJsonSchema.parse(stripNulls(args.config));
    } catch (err) {
      if (err instanceof ZodError) {
        throw new ConvexError({
          code: 'VALIDATION_ERROR',
          message: 'Invalid agent configuration',
          fieldErrors: err.flatten().fieldErrors,
        });
      }
      throw err;
    }

    // Cross-validate supportedModels against provider model lists.
    // Qualified entries ("provider:model") must resolve strictly;
    // unqualified entries that match multiple providers produce a soft warning.
    // Use the secrets-free configured-models list: a provider config existing
    // without an API key yet is a legitimate state and shouldn't block save.
    // Runtime invocation enforces key availability separately.
    const allModels = await ctx.runAction(
      internal.providers.file_actions.getAllConfiguredModelIds,
      { orgSlug: args.orgSlug },
    );
    const byProvider = new Map<string, Set<string>>();
    const modelTagLookup = new Map<string, string[]>();
    for (const m of allModels) {
      let set = byProvider.get(m.providerName);
      if (!set) {
        set = new Set();
        byProvider.set(m.providerName, set);
      }
      set.add(m.id);
      modelTagLookup.set(`${m.providerName}:${m.id}`, m.tags);
    }

    const requireImageGenerationTag =
      config.primaryBehavior === 'image-generation';
    const warnings: string[] = [];
    for (const ref of config.supportedModels) {
      const { providerName, modelId } = parseModelRef(ref);
      let resolvedProviderName = providerName;
      if (providerName) {
        const set = byProvider.get(providerName);
        if (!set) {
          throw new ConvexError({
            code: 'UNKNOWN_PROVIDER',
            message: `Provider "${providerName}" not found`,
          });
        }
        if (!set.has(modelId)) {
          throw new ConvexError({
            code: 'UNKNOWN_MODEL',
            message: `Model "${modelId}" not defined in provider "${providerName}"`,
          });
        }
      } else {
        const matches = [...byProvider.entries()]
          .filter(([, s]) => s.has(modelId))
          .map(([p]) => p);
        if (matches.length > 1) {
          warnings.push(
            `"${modelId}" matches ${matches.length} providers (${matches.join(', ')}); pinning to "${matches[0]}". Use "${matches[0]}:${modelId}" to pin explicitly.`,
          );
        }
        resolvedProviderName = matches[0];
      }

      if (requireImageGenerationTag && resolvedProviderName) {
        const tags = modelTagLookup.get(`${resolvedProviderName}:${modelId}`);
        if (!tags || !tags.includes('image-generation')) {
          throw new ConvexError({
            code: 'VALIDATION_ERROR',
            message: `Model "${ref}" is missing the "image-generation" tag and cannot be used by an image-generation agent.`,
          });
        }
      }
    }

    // Normalize at the write boundary — single chokepoint that enforces:
    // (1) no empty-string / empty-array placeholders in i18n, and
    // (2) mutual exclusion between top-level and i18n[defaultLocale] per
    // translatable field. Lets the UI write "naive" payloads (both layers
    // populated); the server is the single source of truth for canonicalization.
    const orgLocale = args.organizationId
      ? await ctx.runQuery(
          internal.organizations.internal_queries.getOrganizationDefaultLocale,
          { organizationId: args.organizationId },
        )
      : undefined;
    const normalized = normalizeAgentConfig(config, orgLocale);
    if (JSON.stringify(config) !== JSON.stringify(normalized)) {
      console.warn('[saveAgent] normalized config before write', {
        orgSlug: args.orgSlug,
        agentName: args.agentName,
      });
    }

    const content = serializeAgentJson(normalized);
    const filePath = resolveAgentFilePath(args.orgSlug, args.agentName);

    if (args.isNew) {
      const existing = await readFileSafe(filePath);
      if (existing !== null) {
        throw new ConvexError({
          code: 'DUPLICATE_NAME',
          message: `Agent '${args.agentName}' already exists`,
        });
      }
    }

    if (
      !args.isNew &&
      args.oldAgentName &&
      args.oldAgentName !== args.agentName
    ) {
      const existing = await readFileSafe(filePath);
      if (existing !== null) {
        throw new ConvexError({
          code: 'DUPLICATE_NAME',
          message: `Agent '${args.agentName}' already exists`,
        });
      }
      const oldFilePath = resolveAgentFilePath(args.orgSlug, args.oldAgentName);
      await unlink(oldFilePath).catch(() => {});
    }

    await atomicWrite(filePath, content);

    return {
      hash: sha256(content),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
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
    /** See `saveAgent`. */
    organizationId: v.optional(v.string()),
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

    const orgLocale = args.organizationId
      ? await ctx.runQuery(
          internal.organizations.internal_queries.getOrganizationDefaultLocale,
          { organizationId: args.organizationId },
        )
      : undefined;

    // Suffix each populated i18n displayName so the copy is visibly a copy in
    // every locale the source agent has. Top-level displayName is only used
    // as a fallback for legacy agents; we suffix it when present so resolver
    // consumers see "X (Copy)" in pre-normalized states, and normalization
    // will strip it again if i18n[defaultLocale] carries content.
    const suffix = ' (Copy)';
    const nextI18n = source.config.i18n
      ? Object.fromEntries(
          Object.entries(source.config.i18n).map(([loc, overrides]) => [
            loc,
            overrides.displayName
              ? {
                  ...overrides,
                  displayName: `${overrides.displayName}${suffix}`,
                }
              : overrides,
          ]),
        )
      : undefined;

    const legacyDisplayName = source.config.displayName;
    const suffixedTopLevel = legacyDisplayName
      ? `${legacyDisplayName}${suffix}`
      : undefined;

    const draft: AgentJsonConfig = {
      ...source.config,
      ...(suffixedTopLevel !== undefined
        ? { displayName: suffixedTopLevel }
        : {}),
      ...(nextI18n ? { i18n: nextI18n } : {}),
      visibleInChat: false,
    };

    // If neither the legacy top-level nor any i18n locale had a displayName,
    // schema validation would fail. Fall back to the agent filename so the
    // copy is always saveable and never silently becomes "undefined (Copy)".
    const hasAnyDisplayName =
      !!draft.displayName ||
      Object.values(draft.i18n ?? {}).some(
        (overrides) =>
          overrides.displayName && overrides.displayName.length > 0,
      );
    if (!hasAnyDisplayName) {
      const resolved = resolveAgentLocale(
        source.config,
        orgLocale ?? 'en',
      ).displayName;
      draft.displayName = `${resolved || args.agentName}${suffix}`;
    }

    const normalized = normalizeAgentConfig(draft, orgLocale);
    const content = serializeAgentJson(normalized);
    const filePath = resolveAgentFilePath(args.orgSlug, newName);
    await atomicWrite(filePath, content);

    return { newAgentName: newName };
  },
});

export const deleteAgent = action({
  args: {
    orgSlug: v.string(),
    agentName: v.string(),
    organizationId: v.optional(v.string()),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    if ((PROTECTED_AGENT_NAMES as readonly string[]).includes(args.agentName)) {
      throw new Error(`Agent '${args.agentName}' cannot be deleted`);
    }

    const filePath = resolveAgentFilePath(args.orgSlug, args.agentName);
    const historyDir = resolveHistoryDir(args.orgSlug, args.agentName);

    await unlink(filePath).catch((err) => {
      if (err instanceof Error && 'code' in err && err.code !== 'ENOENT') {
        throw err;
      }
    });
    await rm(historyDir, { recursive: true, force: true });

    if (args.organizationId) {
      await ctx.runMutation(internal.agents.mutations.cleanupAgentBinding, {
        organizationId: args.organizationId,
        agentSlug: args.agentName,
      });
    }

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

    // Restore bit-faithfully. Only require that the snapshot is parseable
    // JSON; if it fails the current schema's refinements (e.g. a pre-i18n
    // snapshot from before a newly-tightened rule), we still restore — the
    // next saveAgent will normalize it into compliance. Fail loudly only on
    // corrupt bytes so we never overwrite the agent with unreadable content.
    try {
      JSON.parse(historyContent);
    } catch {
      throw new Error('History entry is corrupt JSON');
    }
    try {
      parseAgentJson(historyContent);
    } catch (err) {
      console.warn(
        '[restoreFromHistory] snapshot does not pass current schema; restoring as-is',
        err instanceof Error ? err.message : err,
      );
    }

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

/**
 * Read agent config from filesystem, fetch DB binding, and return
 * a fully resolved SerializableAgentConfig ready for the agent pipeline.
 *
 * This centralizes the read-parse-convert pattern so callers don't need
 * Node.js filesystem access.
 */
export const resolveAgentConfig = internalAction({
  args: {
    orgSlug: v.string(),
    agentSlug: v.string(),
    organizationId: v.string(),
    modelId: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<SerializableAgentConfig> => {
    const [result, binding, orgLocale] = await Promise.all([
      readAgentFile(args.orgSlug, args.agentSlug),
      ctx.runQuery(internal.agents.internal_queries.getBindingByAgent, {
        organizationId: args.organizationId,
        agentSlug: args.agentSlug,
      }),
      ctx.runQuery(
        internal.organizations.internal_queries.getOrganizationDefaultLocale,
        { organizationId: args.organizationId },
      ),
    ]);
    if (!result.ok) {
      throw new Error(`Agent not found: ${args.agentSlug} — ${result.message}`);
    }

    // Cross-validate supportedModels against provider model lists so the
    // user is never presented with models that cannot be resolved. Both
    // qualified ("provider:model") and unqualified entries are supported.
    const allModels = await ctx.runAction(
      internal.providers.file_actions.getAllModelIds,
      { orgSlug: args.orgSlug },
    );

    const byProvider = new Map<string, Set<string>>();
    const chatByProvider = new Map<string, Set<string>>();
    for (const m of allModels) {
      let set = byProvider.get(m.providerName);
      let chatSet = chatByProvider.get(m.providerName);
      if (!set) {
        set = new Set();
        chatSet = new Set();
        byProvider.set(m.providerName, set);
        chatByProvider.set(m.providerName, chatSet);
      }
      set.add(m.id);
      if (m.tags.includes('chat') && chatSet) {
        chatSet.add(m.id);
      }
    }

    const validatedModels = result.config.supportedModels.filter((ref) => {
      const { providerName, modelId } = parseModelRef(ref);
      if (providerName) {
        const set = byProvider.get(providerName);
        if (!set?.has(modelId)) {
          console.warn(
            `[resolveAgentConfig] Agent "${args.agentSlug}": model "${ref}" not found in provider "${providerName}", filtering out.`,
          );
          return false;
        }
        if (!chatByProvider.get(providerName)?.has(modelId)) {
          console.warn(
            `[resolveAgentConfig] Agent "${args.agentSlug}": model "${ref}" lacks the "chat" tag in provider "${providerName}", filtering out.`,
          );
          return false;
        }
        return true;
      }
      const anyMatch = [...byProvider.values()].some((s) => s.has(modelId));
      if (!anyMatch) {
        console.warn(
          `[resolveAgentConfig] Agent "${args.agentSlug}": model "${modelId}" not found in any provider, filtering out.`,
        );
        return false;
      }
      const anyChat = [...chatByProvider.values()].some((s) => s.has(modelId));
      if (!anyChat) {
        console.warn(
          `[resolveAgentConfig] Agent "${args.agentSlug}": model "${modelId}" lacks the "chat" tag, filtering out.`,
        );
        return false;
      }
      return true;
    });

    // Use validated models but fall back to original if all were filtered out
    const effectiveConfig = {
      ...result.config,
      supportedModels:
        validatedModels.length > 0
          ? validatedModels
          : result.config.supportedModels,
    };

    const { toSerializableConfig, applyModelOverride } =
      await import('./config');
    const config = toSerializableConfig(
      args.agentSlug,
      effectiveConfig,
      binding
        ? {
            teamId: binding.teamId ?? undefined,
            sharedWithTeamIds: binding.sharedWithTeamIds ?? undefined,
            knowledgeFiles: binding.knowledgeFiles ?? undefined,
          }
        : undefined,
      orgLocale,
    );

    if (args.modelId) {
      applyModelOverride(config, args.modelId, result.config.supportedModels);
    }

    return config;
  },
});

// ---------------------------------------------------------------------------
// AI-assisted translation for agent content fields
// ---------------------------------------------------------------------------

export const translateAgentFields = action({
  args: {
    fields: v.record(v.string(), v.union(v.string(), v.array(v.string()))),
    targetLocale: v.string(),
  },
  returns: v.object({
    translated: v.record(v.string(), v.union(v.string(), v.array(v.string()))),
    error: v.optional(v.string()),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{
    translated: Record<string, string | string[]>;
    error?: string;
  }> => {
    const authUser = await authComponent.getAuthUser(ctx);
    if (!authUser) throw new Error('Unauthenticated');

    const { translateFields } = await import('./translate_fields');
    return translateFields(ctx, args);
  },
});
