'use node';

/**
 * Agent JSON file utilities.
 *
 * Pure helpers for serializing, validating, and hashing agent JSON files.
 * No Convex dependencies — these can be used in any Node.js context.
 */

import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import {
  agentJsonSchema,
  type AgentMetadata,
  type AgentRoutingConfig,
} from '../../lib/shared/schemas/agents';
import { canonicalizeAgentConfig } from '../../lib/shared/utils/canonicalize-config';
import { resolveAppDir } from '../apps/file_utils';
import {
  errnoCode,
  getConfigRoot,
  safeJoinWithinDir,
  serializeJson,
  sha256,
  validateOrgSlug,
} from '../lib/file_io';
import {
  agentSlugFromFileName,
  validateAgentName,
  validateAgentSlug,
} from './validators';

export { sha256, validateAgentName };

const MAX_FILE_SIZE_BYTES = 256 * 1024; // 256 KB
const MAX_HISTORY_ENTRIES = 100;

export interface AgentI18nOverrides {
  displayName?: string;
  description?: string;
  conversationStarters?: string[];
  systemInstructions?: string;
}

export interface AgentJsonConfig {
  /**
   * Canonical, file-location-independent identity. Stored in the config so
   * moving the file between folders or renaming it never breaks
   * delegates/mentions/installations/thread refs. When absent, the loader
   * falls back to the file basename. Mirrors `agentJsonSchema.slug`.
   */
  slug?: string;
  /**
   * Legacy top-level translatable fields. Canonical values live under
   * `i18n.<locale>.*`. These remain as a fallback for agents authored before
   * the i18n-first data model — resolution precedence is
   * `i18n[locale] → i18n['en'] → top-level`.
   */
  displayName?: string;
  description?: string;
  avatarUrl?: string;
  /**
   * Root behavior. Omitted = 'chat' (default). 'image-generation' routes the
   * user's message straight to an image model; 'external-agent' routes the
   * whole turn to a coding agent in a sandbox session. Both bypass the tool
   * loop.
   */
  primaryBehavior?: 'chat' | 'image-generation' | 'external-agent';
  /** External agent runtime for `primaryBehavior: 'external-agent'`. */
  agentKind?: 'claude-code' | 'opencode';
  /**
   * Credential / auth mode for `primaryBehavior: 'external-agent'`. 'managed'
   * (default) routes through the platform gateway with a minted virtual key;
   * 'byo' bypasses the gateway and uses the user-injected sandbox credentials
   * with a raw model passthrough. The per-agent authMode is the sole control;
   * there is no separate org-level gate.
   */
  authMode?: 'managed' | 'byo';
  /**
   * For `primaryBehavior: 'external-agent'` only — opt into the runtime's native
   * web tools (Claude Code WebSearch/WebFetch). Managed runs force-disable these
   * by default (governed routing through a search integration); `true` lifts the
   * denial. Absent/`false` keeps the governed default; BYO is unaffected.
   */
  nativeWebTools?: boolean;
  /**
   * For managed `primaryBehavior: 'external-agent'` only — the vision model that
   * backs the `vision_read` polyfill when this agent's own model is text-only.
   * Unset falls back to the provider registry's `vision`-tagged default; ignored
   * for BYO and when the agent's own model already sees images.
   */
  visionModel?: string;
  systemInstructions?: string;
  toolNames?: string[];
  integrationBindings?: string[];
  workflows?: string[];
  /**
   * Slugs of skills available to this agent — a hard allowlist. Each slug
   * references a `${TALE_CONFIG_DIR}/<orgSlug>/skills/<slug>/SKILL.md` bundle. Empty or
   * absent means the agent has zero skills available; there is no implicit
   * "all org skills" fallback. At chat-turn start, `buildSkillContext` loads
   * only the intersection of this list with the org's actual skills; slugs
   * pointing at non-existent skills are silently dropped.
   */
  skillBindings?: string[];
  supportedModels: string[];
  provider?: string;
  knowledgeMode?: 'off' | 'tool' | 'context' | 'both';
  webSearchMode?: 'off' | 'tool' | 'context' | 'both';
  /**
   * Per-agent personalization toggle. 'off' suppresses user memory and
   * customInstructions injection AND strips the propose_memory tool. Use
   * 'off' for strict-format workflow agents whose output shape would be
   * polluted by user tone, and for agents whose outputs have legal or
   * similarly significant effects on users (GDPR Art 22 / EU AI Act
   * high-risk). Default 'on'.
   */
  personalizationMode?: 'on' | 'off';
  includeOrgKnowledge?: boolean;
  includeTeamKnowledge?: boolean;
  knowledgeTopK?: number;
  structuredResponsesEnabled?: boolean;
  maxSteps?: number;
  timeoutMs?: number;
  outputReserve?: number;
  maxIntegrationCallsPerRun?: number;
  composerMode?: {
    label: string;
    icon?: string;
    tooltip?: string;
    order?: number;
  };
  /** Per-agent routing / cascade behaviour. Mirrors `agentRoutingSchema`. */
  routing?: AgentRoutingConfig;
  roleRestriction?: 'admin_developer';
  conversationStarters?: string[];
  visibleInChat?: boolean;
  /**
   * Organigram delegation edges: slugs of the agents THIS agent delegates to
   * (its direct reports). Many-to-many; the only forbidden edge is a
   * self-edge. Written ONLY by the organigram write paths (`writeAgentDelegates`
   * / `writeAgentParents`); `saveAgent` preserves the on-disk value so a stale
   * settings form can never silently re-wire delegation. Mirrors
   * `agentJsonSchema.delegates`.
   */
  delegates?: string[];
  /**
   * Monthly spend guardrail: warn at `warnPct` (default 80), refuse new runs
   * at `pausePct` (default 100) of `monthlyCents`, measured against the
   * usageLedger's month-to-date spend for this agentSlug. Mirrors
   * `agentJsonSchema.budget`.
   */
  budget?: {
    monthlyCents: number;
    warnPct?: number;
    pausePct?: number;
  };
  /** Max concurrent task runs; falls back to the org `agent_workforce`
   *  policy default. Mirrors `agentJsonSchema.maxConcurrentTasks`. */
  maxConcurrentTasks?: number;
  /** Opt-in: run task runs as a durable sandbox step (container, not the
   *  inline LLM loop). Mutually exclusive with `runtime`. Mirrors
   *  `agentJsonSchema.preferDurableStepForTasks`. */
  preferDurableStepForTasks?: boolean;
  /** External runtime binding (tale-daemon dispatch for task runs).
   *  Mirrors `agentJsonSchema.runtime`. */
  runtime?: {
    adapterType: string;
    daemonId?: string;
    permissionMode: 'safe' | 'auto_edits' | 'full_auto';
    workspaceKey?: string;
  };
  /** Marks the system "Auto" router agent (instructions generated per-request
   *  from `buildRouterInstructions`; never answers a turn itself). */
  isRouter?: boolean;
  /** `false` = system-managed, not creatable/editable/deletable via the UI. */
  uiConfigurable?: boolean;
  i18n?: Record<string, AgentI18nOverrides>;
  /** Install / catalog / cascade metadata. Mirrors `agentJsonSchema.metadata`. */
  metadata?: AgentMetadata;
}

export type AgentReadResult =
  | { ok: true; config: AgentJsonConfig; hash: string }
  | {
      ok: false;
      error:
        | 'not_found'
        | 'corrupted'
        | 'too_large'
        | 'symlink'
        | 'inaccessible';
      message: string;
    };

export function serializeAgentJson(config: AgentJsonConfig): string {
  return serializeJson(canonicalizeAgentConfig(config));
}

export function parseAgentJson(content: string): AgentJsonConfig {
  const parsed: unknown = JSON.parse(content);
  const result = agentJsonSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(`Invalid agent JSON: ${result.error.message}`);
  }
  return result.data;
}

export function resolveAgentsDir(orgSlug: string): string {
  if (!validateOrgSlug(orgSlug)) {
    throw new Error(`Invalid org slug: ${orgSlug}`);
  }
  return path.join(getConfigRoot('agents'), orgSlug, 'agents');
}

/**
 * App-owned agents live under the app's OWN bundle dir (`org/apps/<app>/agents/`),
 * NOT the global `org/agents/`. This is what keeps them out of the global agent
 * surfaces (chat picker, `/agents`, org-chart) by construction.
 */
export function resolveAppAgentsDir(orgSlug: string, appSlug: string): string {
  return path.join(resolveAppDir(orgSlug, appSlug), 'agents');
}

/**
 * Split a possibly-composite agent identity. A flat name (no `/`) is a GLOBAL
 * agent; `<app>/<name>` is APP-owned. `validateAgentName` has already proven the
 * shape, so a single `indexOf('/')` is enough.
 */
function splitAgentName(agentName: string): { appSlug?: string; name: string } {
  const slash = agentName.indexOf('/');
  if (slash === -1) return { name: agentName };
  return {
    appSlug: agentName.slice(0, slash),
    name: agentName.slice(slash + 1),
  };
}

export function resolveAgentFilePath(
  orgSlug: string,
  agentName: string,
): string {
  if (!validateAgentName(agentName)) {
    throw new Error(`Invalid agent name: ${agentName}`);
  }
  const { appSlug, name } = splitAgentName(agentName);
  const dir = appSlug
    ? resolveAppAgentsDir(orgSlug, appSlug)
    : resolveAgentsDir(orgSlug);
  return safeJoinWithinDir(dir, `${name}.json`);
}

export function resolveHistoryDir(orgSlug: string, agentName: string): string {
  // Defence-in-depth: `listHistory`, `readHistoryEntry`, and
  // `restoreFromHistory` invoke this BEFORE any
  // `resolveAgentFilePath`-style validation runs, so a crafted
  // `agentName` containing `..` would otherwise traverse out of
  // `agents/.history/`. Mirror the agent-name + safeJoin guard the
  // other path builders already do.
  if (!validateAgentName(agentName)) {
    throw new Error(`Invalid agent name: ${agentName}`);
  }
  // App-owned history lives under the app's own agents dir, so it travels with
  // the bundle (and is removed by the shell `rm` on uninstall). The final
  // segment is the bare local name — never the composite (no `/` in it).
  const { appSlug, name } = splitAgentName(agentName);
  const baseDir = appSlug
    ? resolveAppAgentsDir(orgSlug, appSlug)
    : resolveAgentsDir(orgSlug);
  return safeJoinWithinDir(safeJoinWithinDir(baseDir, '.history'), name);
}

/** Dirs never treated as agent folders (history trails + archived catalog). */
const SKIP_AGENT_DIRS = new Set(['.history', '_archive', 'old']);

/**
 * Recursively list agent JSON file paths RELATIVE to the org's agents dir
 * (posix-style, e.g. `workforce/chief-executive-officer.json` or a flat
 * `chat-agent.json`). One real level of nesting is expected (chat/, workforce/,
 * github/) but the walk is depth-general. Skips `.history/`, dotfiles, and any
 * `_archive`/`old` dir (superseded catalog that must never load). Returns [] if
 * the dir is missing.
 */
export async function walkAgentRelativePaths(
  orgSlug: string,
): Promise<string[]> {
  const root = resolveAgentsDir(orgSlug);
  const out: string[] = [];

  async function walk(absDir: string, relPrefix: string): Promise<void> {
    let entries: Dirent[];
    try {
      entries = await readdir(absDir, { withFileTypes: true });
    } catch (err) {
      // Missing root is normal (org not scaffolded yet); anything else logs.
      if (errnoCode(err) !== 'ENOENT') {
        console.warn(
          '[agents.walkAgentRelativePaths] readdir failed:',
          absDir,
          err,
        );
      }
      return;
    }
    for (const entry of entries) {
      if (entry.name.startsWith('.')) continue;
      const rel = relPrefix ? `${relPrefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        if (SKIP_AGENT_DIRS.has(entry.name)) continue;
        await walk(path.join(absDir, entry.name), rel);
        continue;
      }
      if (entry.isFile() && entry.name.endsWith('.json')) out.push(rel);
    }
  }

  await walk(root, '');
  return out;
}

/**
 * Safe-join a relative agent path (possibly foldered, e.g.
 * `workforce/ceo.json`) within the org's agents dir, validating every segment.
 * Used to read/write a file at the location the slug→path index resolved.
 */
export function resolveAgentFilePathFromRelative(
  orgSlug: string,
  relativePath: string,
): string {
  const segments = relativePath.replace(/\\/g, '/').split('/');
  const fileSegment = segments.pop();
  if (!fileSegment || !fileSegment.endsWith('.json')) {
    throw new Error(`Invalid agent relative path: ${relativePath}`);
  }
  if (!validateAgentName(fileSegment.replace(/\.json$/, ''))) {
    throw new Error(`Invalid agent file segment: ${fileSegment}`);
  }
  for (const segment of segments) {
    if (!validateAgentName(segment)) {
      throw new Error(`Invalid agent folder segment: ${segment}`);
    }
  }
  let target = resolveAgentsDir(orgSlug);
  for (const segment of segments) {
    target = safeJoinWithinDir(target, segment);
  }
  return safeJoinWithinDir(target, fileSegment);
}

/**
 * The canonical, file-location-independent identity for an agent file: the
 * explicit `config.slug` when valid, else the file basename (legacy fallback).
 */
export function effectiveAgentSlug(
  config: AgentJsonConfig,
  relativePath: string,
): string {
  if (config.slug && validateAgentSlug(config.slug)) return config.slug;
  return agentSlugFromFileName(relativePath);
}

export { MAX_FILE_SIZE_BYTES, MAX_HISTORY_ENTRIES };
