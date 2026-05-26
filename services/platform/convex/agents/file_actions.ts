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
import { action, internalAction, type ActionCtx } from '../_generated/server';
import type { SerializableAgentConfig } from '../lib/agent_chat/types';
import { requireOrgAdminOrDeveloper } from '../lib/auth/require_org_admin_or_developer';
import {
  requireOrgMembershipById,
  type OrgMembershipAuth,
} from '../lib/auth/require_org_membership';
import {
  atomicWrite,
  generateHistoryTimestamp,
  pruneHistory,
  readFileSafe,
  readJsonFile,
  sha256,
} from '../lib/file_io';
import { stripNulls } from '../lib/strip_nulls';
import { resolveOrgSlug } from '../organizations/resolve_org_slug';
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

type AgentAuditAction =
  | 'create_agent'
  | 'update_agent'
  | 'duplicate_agent'
  | 'delete_agent'
  | 'restore_agent';

/**
 * Best-effort audit emit for agent writes — never blocks the user-visible
 * operation. Mirrors `logSkillAudit` in skills/file_actions.ts. Capability
 * fields (toolNames, integrationBindings, workflowBindings, skillBindings,
 * delegates, roleRestriction) belong in the state diff so a reviewer can
 * see exactly what changed; the agent-side audit was previously absent
 * altogether, making skillBindings widening invisible.
 */
async function logAgentAudit(
  ctx: ActionCtx,
  auth: OrgMembershipAuth,
  auditAction: AgentAuditAction,
  agentName: string,
  states: {
    resourceName?: string;
    previousState?: Record<string, unknown>;
    newState?: Record<string, unknown>;
  } = {},
): Promise<void> {
  try {
    await ctx.runMutation(internal.agents.audit_mutations.logAgentAuditEvent, {
      organizationId: auth.orgId,
      actorId: auth.userId,
      ...(auth.email ? { actorEmail: auth.email } : {}),
      actorRole: auth.member.role,
      action: auditAction,
      resourceId: agentName,
      ...(states.resourceName !== undefined && {
        resourceName: states.resourceName,
      }),
      ...(states.previousState !== undefined && {
        previousState: states.previousState,
      }),
      ...(states.newState !== undefined && { newState: states.newState }),
    });
  } catch (err) {
    console.warn('[agents.audit] logAgentAuditEvent failed:', err);
  }
}

/**
 * Project an agent config to the capability fields the audit row records.
 * Keeps the audit payload tight (no full prose copies) while surfacing
 * every transitive grant a reviewer might care about.
 */
function captureCapability(
  config: AgentJsonConfig | undefined,
): Record<string, unknown> | undefined {
  if (!config) return undefined;
  return {
    ...(config.toolNames && { toolNames: config.toolNames }),
    ...(config.integrationBindings && {
      integrationBindings: config.integrationBindings,
    }),
    ...(config.workflows && { workflows: config.workflows }),
    ...(config.delegates && { delegates: config.delegates }),
    ...(config.skillBindings && { skillBindings: config.skillBindings }),
    ...(config.roleRestriction && { roleRestriction: config.roleRestriction }),
  };
}

// ---------------------------------------------------------------------------
// Public actions (called from frontend)
// ---------------------------------------------------------------------------

export const readAgent = action({
  args: {
    organizationId: v.string(),
    agentName: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<AgentReadResult> => {
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );
    return readAgentFile(orgSlug, args.agentName);
  },
});

export const listAgents = action({
  args: {
    organizationId: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );
    const dir = resolveAgentsDir(orgSlug);
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
        const result = await readAgentFile(orgSlug, agentName);
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
    organizationId: v.string(),
    agentName: v.string(),
    config: v.any(),
    isNew: v.optional(v.boolean()),
    oldAgentName: v.optional(v.string()),
  },
  returns: v.object({
    hash: v.string(),
    warnings: v.optional(v.array(v.string())),
  }),
  handler: async (
    ctx,
    args,
  ): Promise<{ hash: string; warnings?: string[] }> => {
    if (!validateAgentName(args.agentName)) {
      throw new Error(`Invalid agent name: ${args.agentName}`);
    }

    const memberAuth = await requireOrgMembershipById(ctx, args.organizationId);
    const { orgSlug } = memberAuth;

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

    // Capability-change gate — changing any field that widens (or rebinds)
    // the agent's reachable surface requires admin/developer auth.
    // `skillBindings` belongs here because each bound skill is reachable
    // material the agent will read at chat time.
    const arrayEq = (
      a: readonly string[] | undefined,
      b: readonly string[] | undefined,
    ): boolean => {
      const aArr = a ?? [];
      const bArr = b ?? [];
      if (aArr.length !== bArr.length) return false;
      const aSorted = [...aArr].sort();
      const bSorted = [...bArr].sort();
      return aSorted.every((value, idx) => value === bSorted[idx]);
    };

    const prevAgent = await readAgentFile(
      orgSlug,
      args.oldAgentName ?? args.agentName,
    );
    const isCapabilityChange =
      args.isNew === true ||
      !prevAgent.ok ||
      !arrayEq(prevAgent.config.toolNames, config.toolNames) ||
      !arrayEq(
        prevAgent.config.integrationBindings,
        config.integrationBindings,
      ) ||
      !arrayEq(prevAgent.config.workflows, config.workflows) ||
      !arrayEq(prevAgent.config.delegates, config.delegates) ||
      !arrayEq(prevAgent.config.skillBindings, config.skillBindings);

    const writeAuth: OrgMembershipAuth = isCapabilityChange
      ? await requireOrgAdminOrDeveloper(ctx, args.organizationId)
      : memberAuth;

    // `skillBindingsResolved` is a legacy snapshot from the old transitive
    // tool-grant model — never write it again. `skillBindings` itself is now
    // a hard allowlist and is persisted as-is.
    config = {
      ...config,
      skillBindingsResolved: undefined,
    };

    // Cross-validate supportedModels against provider model lists.
    // Qualified entries ("provider:model") must resolve strictly;
    // unqualified entries that match multiple providers produce a soft warning.
    // Use the secrets-free configured-models list: a provider config existing
    // without an API key yet is a legitimate state and shouldn't block save.
    // Runtime invocation enforces key availability separately.
    const allModels = await ctx.runAction(
      internal.providers.file_actions.getAllConfiguredModelIds,
      { organizationId: args.organizationId },
    );
    const byProvider = new Map<string, Set<string>>();
    const modelTagLookup = new Map<string, string[]>();
    const modelQuantsLookup = new Map<string, string[] | undefined>();
    for (const m of allModels) {
      let set = byProvider.get(m.providerName);
      if (!set) {
        set = new Set();
        byProvider.set(m.providerName, set);
      }
      set.add(m.id);
      modelTagLookup.set(`${m.providerName}:${m.id}`, m.tags);
      modelQuantsLookup.set(`${m.providerName}:${m.id}`, m.quantizations);
    }

    const requireImageGenerationTag =
      config.primaryBehavior === 'image-generation';
    const warnings: string[] = [];
    for (const ref of config.supportedModels) {
      const { providerName, modelId, quantization } = parseModelRef(ref);
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

      if (quantization && resolvedProviderName) {
        const declared = modelQuantsLookup.get(
          `${resolvedProviderName}:${modelId}`,
        );
        if (!declared || !declared.includes(quantization)) {
          const available = declared?.length ? declared.join(', ') : '(none)';
          throw new ConvexError({
            code: 'UNKNOWN_MODEL_VARIANT',
            message: `Model "${modelId}" has no quantization "${quantization}". Available: ${available}`,
          });
        }
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
    const orgLocale = await ctx.runQuery(
      internal.organizations.internal_queries.getOrganizationDefaultLocale,
      { organizationId: args.organizationId },
    );
    const normalized = normalizeAgentConfig(config, orgLocale);
    if (JSON.stringify(config) !== JSON.stringify(normalized)) {
      console.warn('[saveAgent] normalized config before write', {
        orgSlug,
        agentName: args.agentName,
      });
    }

    const content = serializeAgentJson(normalized);
    const filePath = resolveAgentFilePath(orgSlug, args.agentName);

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
      const oldFilePath = resolveAgentFilePath(orgSlug, args.oldAgentName);
      await unlink(oldFilePath).catch(() => {});
    }

    await atomicWrite(filePath, content);

    await logAgentAudit(
      ctx,
      writeAuth,
      args.isNew === true ? 'create_agent' : 'update_agent',
      args.agentName,
      {
        resourceName: args.agentName,
        ...(prevAgent.ok && {
          previousState: captureCapability(prevAgent.config),
        }),
        newState: captureCapability(normalized),
      },
    );

    return {
      hash: sha256(content),
      ...(warnings.length > 0 ? { warnings } : {}),
    };
  },
});

export const snapshotToHistory = action({
  args: {
    organizationId: v.string(),
    agentName: v.string(),
  },
  returns: v.union(v.object({ timestamp: v.string() }), v.null()),
  handler: async (ctx, args): Promise<{ timestamp: string } | null> => {
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );
    const filePath = resolveAgentFilePath(orgSlug, args.agentName);
    const currentContent = await readFileSafe(filePath);
    if (!currentContent) return null;

    const historyDir = resolveHistoryDir(orgSlug, args.agentName);
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
    organizationId: v.string(),
    agentName: v.string(),
  },
  returns: v.object({ newAgentName: v.string() }),
  handler: async (ctx, args): Promise<{ newAgentName: string }> => {
    // Duplicating an agent that has any capability-bearing field (skill
    // bindings, tools, integrations, workflows) creates a NEW agent with
    // the same grants. The legacy `skillBindingsResolved` snapshot is
    // stripped on write (see `skillBindingsResolved: undefined` below);
    // `skillBindings` itself carries forward as-is. The duplicate-vs-save
    // trust boundary must match saveAgent — both create reachable grants,
    // both gate on developerSettings.
    const auth = await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    const { orgSlug } = auth;
    const source = await readAgentFile(orgSlug, args.agentName);
    if (!source.ok) {
      throw new Error(`Cannot duplicate: ${source.message}`);
    }

    const dir = resolveAgentsDir(orgSlug);
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

    const orgLocale = await ctx.runQuery(
      internal.organizations.internal_queries.getOrganizationDefaultLocale,
      { organizationId: args.organizationId },
    );

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

    // `skillBindings` carries over to the copy (the copy should have the
    // same skill surface as the source). `skillBindingsResolved` is the
    // legacy transitive-grant snapshot and is dropped.
    const draft: AgentJsonConfig = {
      ...source.config,
      ...(suffixedTopLevel !== undefined
        ? { displayName: suffixedTopLevel }
        : {}),
      ...(nextI18n ? { i18n: nextI18n } : {}),
      visibleInChat: false,
      skillBindingsResolved: undefined,
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
    const filePath = resolveAgentFilePath(orgSlug, newName);
    await atomicWrite(filePath, content);

    await logAgentAudit(ctx, auth, 'duplicate_agent', newName, {
      resourceName: newName,
      previousState: {
        sourceAgent: args.agentName,
        ...captureCapability(source.config),
      },
      newState: captureCapability(normalized),
    });

    return { newAgentName: newName };
  },
});

export const deleteAgent = action({
  args: {
    organizationId: v.string(),
    agentName: v.string(),
  },
  returns: v.null(),
  handler: async (ctx, args): Promise<null> => {
    if ((PROTECTED_AGENT_NAMES as readonly string[]).includes(args.agentName)) {
      throw new Error(`Agent '${args.agentName}' cannot be deleted`);
    }

    const auth = await requireOrgMembershipById(ctx, args.organizationId);
    const { orgSlug } = auth;
    const filePath = resolveAgentFilePath(orgSlug, args.agentName);
    const historyDir = resolveHistoryDir(orgSlug, args.agentName);

    // Capture pre-delete capability snapshot for the audit row — agents
    // bound to expensive integrations or skill-laundered grants leave
    // the system at delete time; the audit is the only post-mortem trail.
    // Best-effort: any failure (missing file, parse error, mocked test
    // harness) yields a delete with an audit row that lacks previousState
    // rather than aborting the operation.
    let preDelete: AgentReadResult | undefined;
    try {
      preDelete = await readAgentFile(orgSlug, args.agentName);
    } catch {
      preDelete = undefined;
    }

    await unlink(filePath).catch((err) => {
      if (err instanceof Error && 'code' in err && err.code !== 'ENOENT') {
        throw err;
      }
    });
    await rm(historyDir, { recursive: true, force: true });

    await ctx.runMutation(internal.agents.mutations.cleanupAgentBinding, {
      organizationId: args.organizationId,
      agentSlug: args.agentName,
    });

    await logAgentAudit(ctx, auth, 'delete_agent', args.agentName, {
      resourceName: args.agentName,
      ...(preDelete?.ok && {
        previousState: captureCapability(preDelete.config),
      }),
    });

    return null;
  },
});

export const listHistory = action({
  args: {
    organizationId: v.string(),
    agentName: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );
    const historyDir = resolveHistoryDir(orgSlug, args.agentName);
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
    organizationId: v.string(),
    agentName: v.string(),
    timestamp: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );
    const historyDir = resolveHistoryDir(orgSlug, args.agentName);
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
    organizationId: v.string(),
    agentName: v.string(),
    timestamp: v.string(),
  },
  returns: v.object({ hash: v.string() }),
  handler: async (ctx, args): Promise<{ hash: string }> => {
    const auth = await requireOrgMembershipById(ctx, args.organizationId);
    const { orgSlug } = auth;
    const historyDir = resolveHistoryDir(orgSlug, args.agentName);
    const historyPath = path.join(historyDir, `${args.timestamp}.json`);
    const agentPath = resolveAgentFilePath(orgSlug, args.agentName);

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

    // Audit-log the restore. previousState reflects the now-overwritten
    // config (parsed best-effort — corrupt JSON would have thrown above);
    // newState reflects the restored snapshot. Both surface capability
    // fields so a reviewer can see whether the restore changed grants.
    let prevCapture: Record<string, unknown> | undefined;
    if (currentContent) {
      try {
        prevCapture = captureCapability(parseAgentJson(currentContent));
      } catch {
        // Pre-restore config didn't pass current schema — skip diff
        // rather than abort the audit row.
      }
    }
    let newCapture: Record<string, unknown> | undefined;
    try {
      newCapture = captureCapability(parseAgentJson(historyContent));
    } catch {
      // Restored snapshot may pre-date current schema; restore proceeded
      // bit-faithfully above. Audit row still lands without the diff.
    }
    await logAgentAudit(ctx, auth, 'restore_agent', args.agentName, {
      resourceName: args.agentName,
      ...(prevCapture && { previousState: prevCapture }),
      ...(newCapture && { newState: newCapture }),
    });

    return { hash: sha256(historyContent) };
  },
});

// ---------------------------------------------------------------------------
// Internal action for reading agent config during chat execution
// ---------------------------------------------------------------------------

export const readAgentForChat = internalAction({
  args: {
    organizationId: v.string(),
    agentName: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<AgentReadResult> => {
    // internalAction — trusted caller, no membership gate; just resolve slug.
    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    return readAgentFile(orgSlug, args.agentName);
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
    agentSlug: v.string(),
    organizationId: v.string(),
    modelId: v.optional(v.string()),
  },
  returns: v.any(),
  handler: async (ctx, args): Promise<SerializableAgentConfig> => {
    // internalAction — trusted caller, no membership gate; just resolve slug.
    const orgSlug = await resolveOrgSlug(ctx, args.organizationId);
    const [result, binding, orgLocale] = await Promise.all([
      readAgentFile(orgSlug, args.agentSlug),
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
      { organizationId: args.organizationId },
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
    organizationId: v.string(),
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
    await requireOrgMembershipById(ctx, args.organizationId);
    const { translateFields } = await import('./translate_fields');
    return translateFields(ctx, args);
  },
});
