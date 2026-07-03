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

import {
  PROTECTED_AGENT_NAMES,
  RESERVED_AGENT_SLUGS,
} from '../../lib/shared/constants/agents';
import { agentJsonSchema } from '../../lib/shared/schemas/agents';
import { isValidAppSlug } from '../../lib/shared/schemas/apps';
import { parseModelRef } from '../../lib/shared/utils/model-ref';
import { normalizeAgentConfig } from '../../lib/shared/utils/normalize-agent-config';
import { resolveAgentLocale } from '../../lib/shared/utils/resolve-agent-locale';
import { api, internal } from '../_generated/api';
import { action, internalAction, type ActionCtx } from '../_generated/server';
import { listInstalledAppSlugsFromDisk } from '../apps/file_utils';
import type { SerializableAgentConfig } from '../lib/agent_chat/types';
import { requireOrgAdminOrDeveloper } from '../lib/auth/require_org_admin_or_developer';
import {
  requireOrgMembershipById,
  type OrgMembershipAuth,
} from '../lib/auth/require_org_membership';
import {
  atomicWrite,
  errnoCode,
  generateHistoryTimestamp,
  handleDirReadError,
  pruneHistory,
  readFileSafe,
  readJsonFile,
  safeJoinWithinDir,
  sha256,
  validateTimestamp,
} from '../lib/file_io';
import { stripNulls } from '../lib/strip_nulls';
import { resolveOrgSlug } from '../organizations/resolve_org_slug';
import type { AgentJsonConfig, AgentReadResult } from './file_utils';
import {
  MAX_FILE_SIZE_BYTES,
  MAX_HISTORY_ENTRIES,
  effectiveAgentSlug,
  parseAgentJson,
  resolveAgentFilePath,
  resolveAgentFilePathFromRelative,
  resolveAppAgentsDir,
  resolveHistoryDir,
  serializeAgentJson,
  validateAgentName,
  walkAgentRelativePaths,
} from './file_utils';
import {
  invalidateAgentListCache,
  listAgentsForOrg,
  resolveAgentPath,
  resolveAgentRelativePath,
} from './internal_actions';
import { agentSlugFromFileName } from './validators';

async function readAgentFile(
  orgSlug: string,
  agentName: string,
): Promise<AgentReadResult> {
  // Folder-aware resolution: the index maps a flat slug to its real relative
  // path, so foldered global agents (chat/, workforce/, github/) resolve to
  // their on-disk location; a composite `<app>/<name>` falls through to the
  // app bundle. A flat global slug with no index hit lands at org/agents/<slug>.
  const filePath = await resolveAgentPath(orgSlug, agentName);
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
    ...(config.skillBindings && { skillBindings: config.skillBindings }),
    ...(config.roleRestriction && { roleRestriction: config.roleRestriction }),
    // Delegation edges: grant this agent a delegate_* tool per target.
    ...(config.delegates && { delegates: config.delegates }),
    // Guardrails: spend authority + parallelism are capability-grade.
    ...(config.budget && { budget: config.budget }),
    ...(config.maxConcurrentTasks !== undefined && {
      maxConcurrentTasks: config.maxConcurrentTasks,
    }),
    // External runtime binding: where (and with what permissions) this
    // agent's task work executes.
    ...(config.runtime && { runtime: config.runtime }),
  };
}

/**
 * Capability snapshot of a serialized agent config, or `undefined` when the
 * content can't be parsed under the current schema. The `undefined` return is
 * meaningful at the call site: a caller deciding whether a restore changes
 * capability grants must fail closed (require the developer-settings gate) when
 * it can't prove the snapshot leaves capability fields unchanged.
 */
function capabilityCaptureFromContent(
  content: string,
): Record<string, unknown> | undefined {
  try {
    return captureCapability(parseAgentJson(content));
  } catch {
    return undefined;
  }
}

/**
 * Structural equality for two capability captures. String arrays are compared
 * as sets (order-insensitive) and object keys are sorted, mirroring
 * `saveAgent`'s `arrayEq` so a pure reordering isn't treated as a grant change.
 */
function capabilityCapturesEqual(
  a: Record<string, unknown> | undefined,
  b: Record<string, unknown> | undefined,
): boolean {
  const canonical = (value: unknown): string =>
    JSON.stringify(value, (_key, val: unknown) => {
      if (Array.isArray(val) && val.every((item) => typeof item === 'string')) {
        return [...val].sort();
      }
      if (val !== null && typeof val === 'object' && !Array.isArray(val)) {
        return Object.fromEntries(
          Object.entries(val).sort(([keyA], [keyB]) =>
            keyA < keyB ? -1 : keyA > keyB ? 1 : 0,
          ),
        );
      }
      return val;
    });
  return canonical(a ?? {}) === canonical(b ?? {});
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
  // oxlint-disable-next-line typescript/no-explicit-any -- listAgents returns heterogeneous shapes; v.any() at API boundary
  handler: async (ctx, args): Promise<any[]> => {
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );
    const seen = new Set<string>();

    // Project an agent config to its list row. `appSlug` set ⇒ app-owned: the
    // global list groups it under (and marks) its app; `folder` is the app slug.
    const toAgentRow = (
      slug: string,
      config: AgentJsonConfig,
      folder: string,
      appSlug?: string,
    ) => ({
      name: slug,
      slug,
      // The '/'-joined folder path the agent file lives in (every path segment
      // except the file itself), so nested folders survive in the list/catalog —
      // e.g. `marketing/seo` → `marketing/seo`. Seeded single-level agents
      // (workforce/, github/) are unaffected. For app agents this is the app
      // slug. Independent of `labels`, which are flat equal tags.
      folder,
      labels: config.metadata?.labels,
      displayName: config.displayName,
      description: config.description,
      visibleInChat: config.visibleInChat,
      primaryBehavior: config.primaryBehavior,
      agentKind: config.agentKind,
      authMode: config.authMode,
      supportedModels: config.supportedModels,
      toolNames: config.toolNames,
      integrationBindings: config.integrationBindings,
      roleRestriction: config.roleRestriction,
      conversationStarters: config.conversationStarters,
      composerMode: config.composerMode,
      isRouter: config.isRouter,
      uiConfigurable: config.uiConfigurable,
      i18n: config.i18n,
      metadata: config.metadata,
      ...(appSlug !== undefined ? { appSlug } : {}),
    });

    // Global agents — recursive walk of the global folder tree (chat/,
    // workforce/, github/, …); identity is the config's explicit `slug`
    // (basename fallback), NOT the path.
    const relPaths = await walkAgentRelativePaths(orgSlug);
    const globalResults = await Promise.all(
      relPaths.map(async (relativePath) => {
        const read = await readJsonFile<AgentJsonConfig>(
          resolveAgentFilePathFromRelative(orgSlug, relativePath),
          MAX_FILE_SIZE_BYTES,
          parseAgentJson,
        );
        const slug = read.ok
          ? effectiveAgentSlug(read.data, relativePath)
          : agentSlugFromFileName(relativePath);
        if (seen.has(slug)) return null; // duplicate slug — first wins
        seen.add(slug);
        if (read.ok) {
          const folder = relativePath.includes('/')
            ? relativePath.split('/').slice(0, -1).join('/')
            : '';
          return toAgentRow(slug, read.data, folder);
        }
        return { name: slug, slug, status: read.error, message: read.message };
      }),
    );

    // App-owned agents (org/apps/<app>/agents/) — invisible to the global walk
    // above. Surface them too, grouped under their app (folder = app slug) and
    // tagged with appSlug so the global agents list can mark the group.
    const appSlugs = await listInstalledAppSlugsFromDisk(orgSlug);
    const appResults = (
      await Promise.all(
        appSlugs.map(async (app) => {
          let entries: string[];
          try {
            entries = await readdir(resolveAppAgentsDir(orgSlug, app));
          } catch (err) {
            handleDirReadError(err, 'agents.listAgents.app');
            return [];
          }
          const jsonFiles = entries.filter(
            (e) => e.endsWith('.json') && !e.startsWith('.'),
          );
          return Promise.all(
            jsonFiles.map(async (fileName) => {
              const shortName = agentSlugFromFileName(fileName);
              const slug = `${app}/${shortName}`;
              if (!validateAgentName(slug)) return null;
              if (seen.has(slug)) return null;
              seen.add(slug);
              const result = await readAgentFile(orgSlug, slug);
              if (result.ok) {
                return toAgentRow(slug, result.config, app, app);
              }
              return {
                name: slug,
                slug,
                status: result.error,
                message: result.message,
                appSlug: app,
              };
            }),
          );
        }),
      )
    ).flat();

    return [...globalResults, ...appResults].filter(Boolean);
  },
});

/**
 * List one app's OWN agents (scoped to `org/apps/<app>/agents/`). The global
 * `listAgents` only scans `org/agents/`, so app agents never surface there — this
 * is the app page's window into its own cast. Each row's `name` is the COMPOSITE
 * identity `<app>/<agent>` (what the env/instructions dialogs, `readAgent`, and
 * `saveAgent` key on); `shortName` is the bare local name for display.
 */
export const listAppAgents = action({
  args: {
    organizationId: v.string(),
    appSlug: v.string(),
  },
  returns: v.any(),
  handler: async (ctx, args) => {
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );
    if (!isValidAppSlug(args.appSlug)) {
      throw new Error(`Invalid app slug: ${args.appSlug}`);
    }
    const dir = resolveAppAgentsDir(orgSlug, args.appSlug);
    let entries: string[];
    try {
      entries = await readdir(dir);
    } catch (err) {
      handleDirReadError(err, 'agents.listAppAgents');
      return [];
    }

    const jsonFiles = entries.filter(
      (e) => e.endsWith('.json') && !e.startsWith('.'),
    );

    const results = await Promise.all(
      jsonFiles.map(async (fileName) => {
        const shortName = agentSlugFromFileName(fileName);
        const slug = `${args.appSlug}/${shortName}`;
        if (!validateAgentName(slug)) return null;
        const result = await readAgentFile(orgSlug, slug);
        if (result.ok) {
          return {
            name: slug,
            shortName,
            displayName: result.config.displayName,
            description: result.config.description,
            visibleInChat: result.config.visibleInChat,
            primaryBehavior: result.config.primaryBehavior,
            agentKind: result.config.agentKind,
            authMode: result.config.authMode,
            supportedModels: result.config.supportedModels,
            toolNames: result.config.toolNames,
            integrationBindings: result.config.integrationBindings,
            roleRestriction: result.config.roleRestriction,
            conversationStarters: result.config.conversationStarters,
            composerMode: result.config.composerMode,
            isRouter: result.config.isRouter,
            uiConfigurable: result.config.uiConfigurable,
            i18n: result.config.i18n,
            // Carries `metadata.requires.env` — the per-agent readiness check
            // reads the declared BYO secrets from here.
            metadata: result.config.metadata,
          };
        }
        return {
          name: slug,
          shortName,
          status: result.error,
          message: result.message,
        };
      }),
    );

    return results.filter(Boolean);
  },
});

/**
 * Flip an external agent's `authMode` (managed ⇄ byo) on the org's copied agent
 * config — the install wizard's per-agent mode choice. Read-modify-write through
 * `saveAgent` so validation, history, and the capability gate all apply; the
 * runtime reads `authMode` straight off this config, so the choice takes effect
 * on the next run.
 */
export const setAgentAuthMode = action({
  args: {
    organizationId: v.string(),
    agentName: v.string(),
    authMode: v.union(v.literal('managed'), v.literal('byo')),
  },
  returns: v.object({ ok: v.boolean() }),
  handler: async (ctx, args): Promise<{ ok: boolean }> => {
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );
    const read = await readAgentFile(orgSlug, args.agentName);
    if (!read.ok) {
      throw new Error(`Cannot set auth mode: ${read.message}`);
    }
    if (read.config.primaryBehavior !== 'external-agent') {
      throw new Error('authMode only applies to an external-agent.');
    }
    if (read.config.authMode === args.authMode) {
      return { ok: true };
    }
    await ctx.runAction(api.agents.file_actions.saveAgent, {
      organizationId: args.organizationId,
      agentName: args.agentName,
      config: { ...read.config, authMode: args.authMode },
    });
    return { ok: true };
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
    if ((RESERVED_AGENT_SLUGS as readonly string[]).includes(args.agentName)) {
      throw new ConvexError({
        code: 'RESERVED_AGENT_SLUG',
        message: `"${args.agentName}" is a reserved name and cannot be used for an agent.`,
      });
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

    // System-managed agents (e.g. the Auto router, `uiConfigurable: false`) are
    // not editable through the UI, and the UI may not mint new ones.
    if (prevAgent.ok && prevAgent.config.uiConfigurable === false) {
      throw new ConvexError({
        code: 'FORBIDDEN',
        message: 'This agent is system-managed and cannot be edited.',
      });
    }
    if (config.isRouter === true || config.uiConfigurable === false) {
      throw new ConvexError({
        code: 'FORBIDDEN',
        message: 'System-managed agent flags cannot be set through the UI.',
      });
    }

    // Guardrail comparison: spend authority + parallelism are capability-
    // grade (they change what the agent may consume), so edits require the
    // same elevated auth as tool/delegate grants.
    const budgetEq = (
      a: AgentJsonConfig['budget'],
      b: AgentJsonConfig['budget'],
    ): boolean =>
      (a === undefined) === (b === undefined) &&
      a?.monthlyCents === b?.monthlyCents &&
      a?.warnPct === b?.warnPct &&
      a?.pausePct === b?.pausePct;

    const runtimeEq = (
      a: AgentJsonConfig['runtime'],
      b: AgentJsonConfig['runtime'],
    ): boolean =>
      (a === undefined) === (b === undefined) &&
      a?.adapterType === b?.adapterType &&
      a?.daemonId === b?.daemonId &&
      a?.permissionMode === b?.permissionMode &&
      a?.workspaceKey === b?.workspaceKey;

    const isCapabilityChange =
      args.isNew === true ||
      !prevAgent.ok ||
      !arrayEq(prevAgent.config.toolNames, config.toolNames) ||
      !arrayEq(
        prevAgent.config.integrationBindings,
        config.integrationBindings,
      ) ||
      !arrayEq(prevAgent.config.workflows, config.workflows) ||
      !arrayEq(prevAgent.config.skillBindings, config.skillBindings) ||
      !budgetEq(prevAgent.config.budget, config.budget) ||
      prevAgent.config.maxConcurrentTasks !== config.maxConcurrentTasks ||
      !runtimeEq(prevAgent.config.runtime, config.runtime);

    const writeAuth: OrgMembershipAuth = isCapabilityChange
      ? await requireOrgAdminOrDeveloper(ctx, args.organizationId)
      : memberAuth;

    // `delegates` (the legacy org-chart delegation edges) is READ-ONLY — every
    // editor was removed with the organigram. The settings form must never
    // carry it — a stale form would silently re-wire delegation — so the
    // incoming value is dropped and the on-disk value re-applied here.
    config = {
      ...config,
      delegates: prevAgent.ok ? prevAgent.config.delegates : undefined,
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
    // A new agent (and the destination of a rename) gets a freshly-computed
    // path — flat under org/agents/, or app-scoped when the name is
    // `<app>/<name>`. An in-place edit resolves through the folder-aware index
    // so foldered global agents (chat/, workforce/, github/) are written back
    // where they actually live, not flattened to org/agents/<slug>.json.
    const isRename =
      !args.isNew &&
      !!args.oldAgentName &&
      args.oldAgentName !== args.agentName;
    const filePath =
      args.isNew || isRename
        ? resolveAgentFilePath(orgSlug, args.agentName)
        : await resolveAgentPath(orgSlug, args.agentName);

    if (args.isNew) {
      const existing = await readFileSafe(filePath);
      if (existing !== null) {
        throw new ConvexError({
          code: 'DUPLICATE_NAME',
          message: `Agent '${args.agentName}' already exists`,
        });
      }
    }

    if (isRename && args.oldAgentName) {
      const existing = await readFileSafe(filePath);
      if (existing !== null) {
        throw new ConvexError({
          code: 'DUPLICATE_NAME',
          message: `Agent '${args.agentName}' already exists`,
        });
      }
      // Resolve the OLD file through the index so a foldered global agent is
      // removed from its real location (not a flattened org/agents/<slug>.json).
      const oldFilePath = await resolveAgentPath(orgSlug, args.oldAgentName);
      // ENOENT-tolerant only — silently swallowing EACCES/EBUSY/EIO
      // would leave the OLD file on disk while the NEW file is being
      // written next to it, so `listAgents` would surface the same
      // agent twice and the audit log would record a rename that
      // didn't fully complete.
      await unlink(oldFilePath).catch((err: unknown) => {
        if (errnoCode(err) !== 'ENOENT') {
          console.warn(
            `[saveAgent] unlink old agent file ${oldFilePath} failed:`,
            err,
          );
        }
      });
    }

    await atomicWrite(filePath, content);
    // The folder-aware index (slug → path, roster) caches per org; refresh it
    // so the router, @mention resolution, and listAgents see this write.
    invalidateAgentListCache(orgSlug);

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
    const filePath = await resolveAgentPath(orgSlug, args.agentName);
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
    // the same grants — `skillBindings` carries forward as-is. The
    // duplicate-vs-save trust boundary must match saveAgent — both create
    // reachable grants, both gate on developerSettings.
    const auth = await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    const { orgSlug } = auth;
    const source = await readAgentFile(orgSlug, args.agentName);
    if (!source.ok) {
      throw new Error(`Cannot duplicate: ${source.message}`);
    }

    // Derive existing names from the folder-aware roster so the copy's name
    // can't collide with a foldered global agent (chat/, workforce/, …) that a
    // flat readdir of org/agents/ would miss.
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- listAgentsForOrg returns a v.any() projection; we read only `name` for the duplicate-name guard
    const roster = (await listAgentsForOrg(orgSlug)) as Array<{
      name?: string;
    }>;
    const existingNames = new Set(
      roster
        .map((e) => e.name)
        .filter((n): n is string => typeof n === 'string'),
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

    const topLevelDisplayName = source.config.displayName;
    const suffixedTopLevel = topLevelDisplayName
      ? `${topLevelDisplayName}${suffix}`
      : undefined;

    // `skillBindings` carries over to the copy (the copy should have the
    // same skill surface as the source).
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
    // Write the copy INTO THE SAME FOLDER as the source. A foldered global
    // agent (chat/, workforce/, github/, …) must duplicate alongside its
    // original — resolving the copy to the flat org/agents/<slug>.json instead
    // gives it folder `''`, and the folder-scoped list view (`?folder=chat`)
    // then filters it out, so the user sees "Agent duplicated" but no new row.
    // App-owned + flat-root sources aren't indexed with a folder prefix, so
    // they fall through to the composite/flat path as before.
    const sourceRel = await resolveAgentRelativePath(orgSlug, args.agentName);
    const folderPrefix =
      sourceRel && sourceRel.includes('/')
        ? sourceRel.split('/').slice(0, -1).join('/')
        : '';
    const filePath = folderPrefix
      ? resolveAgentFilePathFromRelative(
          orgSlug,
          `${folderPrefix}/${newName}.json`,
        )
      : resolveAgentFilePath(orgSlug, newName);
    await atomicWrite(filePath, content);
    invalidateAgentListCache(orgSlug);

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
    if (PROTECTED_AGENT_NAMES.some((name) => name === args.agentName)) {
      throw new Error(`Agent '${args.agentName}' cannot be deleted`);
    }

    // Deleting a custom agent destroys it and its full history, and can carry
    // away skill-laundered grants — strictly more destructive than the
    // create/duplicate/save paths, all of which gate on `developerSettings`
    // (see :764 duplicateAgent, :537 saveAgent). A plain `member` is hidden
    // from the matching UI by `cannot('read','developerSettings')` but could
    // previously call this action directly via the Convex client. Gate it on
    // the same capability so action-layer auth matches route-layer auth.
    const auth = await requireOrgAdminOrDeveloper(ctx, args.organizationId);
    const { orgSlug } = auth;
    const filePath = await resolveAgentPath(orgSlug, args.agentName);
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
    } catch (err) {
      // Best-effort snapshot per the comment block above. Log the
      // underlying error so the audit-row-without-previousState case
      // is explainable in post-mortem (vs the prior silent swallow
      // which gave no signal about what went wrong).
      console.warn(
        `[deleteAgent] preDelete capture failed for ${args.agentName}:`,
        err,
      );
      preDelete = undefined;
    }

    // System-managed agents (e.g. the Auto router, `uiConfigurable: false`)
    // cannot be deleted via the UI. Reuses the best-effort snapshot above; an
    // unreadable agent (snapshot undefined) isn't blocked — the router is
    // always readable in practice.
    if (preDelete?.ok && preDelete.config.uiConfigurable === false) {
      throw new ConvexError({
        code: 'FORBIDDEN',
        message: 'This agent is system-managed and cannot be deleted.',
      });
    }

    // App-owned agents are not individually deletable from the global surface —
    // removing one would orphan its app. Deletion happens only via app uninstall.
    // Ownership is the recorded `appSlug` on the install row.
    const installation = await ctx.runQuery(
      internal.agents.installations.getInstallationInternal,
      { organizationId: args.organizationId, agentSlug: args.agentName },
    );
    if (installation?.appSlug) {
      throw new ConvexError({
        code: 'app_owned',
        message: `Agent "${args.agentName}" belongs to app "${installation.appSlug}". Uninstall the app to remove it.`,
      });
    }

    await unlink(filePath).catch((err) => {
      if (err instanceof Error && 'code' in err && err.code !== 'ENOENT') {
        throw err;
      }
    });
    await rm(historyDir, { recursive: true, force: true });
    invalidateAgentListCache(orgSlug);

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
    } catch (err) {
      handleDirReadError(err, 'agents.listHistory');
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
    if (!validateTimestamp(args.timestamp)) {
      throw new Error('Invalid timestamp');
    }
    const historyDir = resolveHistoryDir(orgSlug, args.agentName);
    const filePath = safeJoinWithinDir(historyDir, `${args.timestamp}.json`);

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
    const memberAuth = await requireOrgMembershipById(ctx, args.organizationId);
    const { orgSlug } = memberAuth;
    if (!validateTimestamp(args.timestamp)) {
      throw new Error('Invalid timestamp');
    }
    const historyDir = resolveHistoryDir(orgSlug, args.agentName);
    const historyPath = safeJoinWithinDir(historyDir, `${args.timestamp}.json`);
    const agentPath = await resolveAgentPath(orgSlug, args.agentName);

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

    // Capability-change gate (mirrors `saveAgent` at :537). A restore is a
    // wholesale overwrite of the live config with an arbitrary historical
    // snapshot — including the capability fields (`toolNames`,
    // `integrationBindings`, `workflows`, `skillBindings`, `budget`,
    // `maxConcurrentTasks`, `runtime`, delegation edges) that `saveAgent`
    // only lets admin/developer roles change. Without this gate a plain
    // `member` could re-grant a binding a developer had revoked simply by
    // restoring an older snapshot, laundering a capability change past the
    // `developerSettings` gate. Only require the elevated capability when the
    // restore actually alters those fields, matching `saveAgent`'s semantics
    // (members may still restore description/instruction-only changes). Fail
    // closed: if the current config or the snapshot can't be parsed we cannot
    // prove the grants are unchanged, so require the capability.
    const restoredCapability = capabilityCaptureFromContent(historyContent);
    const currentCapability = currentContent
      ? capabilityCaptureFromContent(currentContent)
      : undefined;
    const isCapabilityChange =
      restoredCapability === undefined ||
      currentCapability === undefined ||
      !capabilityCapturesEqual(currentCapability, restoredCapability);
    const auth = isCapabilityChange
      ? await requireOrgAdminOrDeveloper(ctx, args.organizationId)
      : memberAuth;

    // Write the restored version
    await atomicWrite(agentPath, historyContent);
    invalidateAgentListCache(orgSlug);

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
