'use node';

/**
 * Frozen old-world contract for historical migrations — never evolve; deleted
 * when pre-rewrite upgrade support ends.
 *
 * Trimmed copy of `file_utils.ts` from the
 * retired `convex/agents/` domain. Trimmed to the
 * path resolvers + read/write/list agent JSON helpers + `AgentJsonConfig`
 * type actually imported by
 * `v0_2_98/01_claude_code_fable_default/migration.ts`,
 * `v0_2_98/02_agent_kind_opencode_to_claude_code/migration.ts`,
 * `v0_3_4/04_remove_workforce_agents/migration.ts`,
 * `v0_3_4/34_retire_github_pack_agents/migration.ts`, and
 * `testing/world/injections.testkit.ts` — NOT the app-owned-agent resolvers
 * (`resolveAutomationAgentsDir`/`resolveAgentFilePath`/`resolveHistoryDir`/
 * `effectiveAgentSlug`), which no migration touches.
 *
 * Dependency substitutions from the original:
 *  - `agentJsonSchema` / `AgentMetadata` / `AgentRoutingConfig`
 *    (`lib/shared/schemas/agents.ts`, retired) → also-frozen at
 *    `legacy/frozen/schemas_agents.ts` (see its header).
 *  - `zodErrorMessage` (`lib/shared/schemas/format-error.ts`) and
 *    `canonicalizeAgentConfig` (`lib/shared/utils/canonicalize-config.ts`)
 *    are STILL LIVE — imported directly, unchanged.
 *  - `errnoCode` / `getConfigRoot` / `safeJoinWithinDir` / `serializeJson` /
 *    `validateOrgSlug` (`convex/lib/file_io.ts`) are STILL LIVE — imported
 *    directly, unchanged.
 *  - `validateAgentName` (`convex/agents/validators.ts`, retired) is inlined
 *    below verbatim (it and its `AGENT_NAME_REGEX` are the only two symbols
 *    `resolveAgentFilePathFromRelative` needs from that module); it in turn
 *    needs `isValidAutomationSlug`, imported from the sibling
 *    `legacy/frozen/schemas_automations.ts`. `resolveAutomationDir` (used by
 *    the original's `resolveAutomationAgentsDir`) is NOT needed — that
 *    resolver is outside the trimmed surface.
 */

import type { Dirent } from 'node:fs';
import { readdir } from 'node:fs/promises';
import path from 'node:path';

import { zodErrorMessage } from '../../../lib/shared/schemas/format-error';
import { canonicalizeAgentConfig } from '../../../lib/shared/utils/canonicalize-config';
import {
  errnoCode,
  getConfigRoot,
  safeJoinWithinDir,
  serializeJson,
  validateOrgSlug,
} from '../../lib/file_io';
import {
  type AgentMetadata,
  type AgentRoutingConfig,
  agentJsonSchema,
} from './schemas_agents';
import { isValidAutomationSlug } from './schemas_automations';

// -----------------------------------------------------------------------------
// retired convex/agents/validators.ts (only
// `validateAgentName` is needed here, by `resolveAgentFilePathFromRelative`).
// -----------------------------------------------------------------------------
const AGENT_NAME_REGEX = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * An agent identity. Either a flat GLOBAL name (`coder`) or an automation-owned
 * COMPOSITE `<automationSlug>/<name>` (`github/create-pull-requests/pr-creator`).
 * The composite carries its owning automation so the slug stays a globally-unique,
 * self-describing identity. The split is on the LAST `/`.
 */
function validateAgentName(name: string): boolean {
  const slash = name.lastIndexOf('/');
  if (slash === -1) return AGENT_NAME_REGEX.test(name);
  const automationSlug = name.slice(0, slash);
  const rest = name.slice(slash + 1);
  return isValidAutomationSlug(automationSlug) && AGENT_NAME_REGEX.test(rest);
}

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
   * mentions/installations/thread refs. When absent, the loader
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
  agentKind?:
    | 'claude-code'
    | 'cursor'
    | 'opencode'
    | 'hermes'
    | 'gemini'
    | 'codex'
    | 'pi'
    | 'openclaw';
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
   * "all org skills" fallback.
   */
  skillBindings?: string[];
  supportedModels: string[];
  provider?: string;
  knowledgeMode?: 'off' | 'tool' | 'context' | 'both';
  webSearchMode?: 'off' | 'tool' | 'context' | 'both';
  /**
   * Per-agent personalization toggle. 'off' suppresses user memory and
   * customInstructions injection AND strips the propose_memory tool. Default
   * 'on'.
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
  /** Max concurrent task runs; omitted = unlimited. Mirrors
   *  `agentJsonSchema.maxConcurrentTasks`. */
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

export function serializeAgentJson(config: AgentJsonConfig): string {
  return serializeJson(canonicalizeAgentConfig(config));
}

export function parseAgentJson(content: string): AgentJsonConfig {
  const parsed: unknown = JSON.parse(content);
  const result = agentJsonSchema.safeParse(parsed);
  if (!result.success) {
    throw new Error(zodErrorMessage('Invalid agent JSON', result.error));
  }
  return result.data;
}

export function resolveAgentsDir(orgSlug: string): string {
  if (!validateOrgSlug(orgSlug)) {
    throw new Error(`Invalid org slug: ${orgSlug}`);
  }
  return path.join(getConfigRoot('agents'), orgSlug, 'agents');
}

/** Dirs never treated as agent folders (history trails + archived catalog). */
const SKIP_AGENT_DIRS = new Set(['.history', '_archive', 'old']);

/**
 * Recursively list agent JSON file paths RELATIVE to the org's agents dir
 * (posix-style, e.g. `chat/researcher.json` or a flat
 * `chat-agent.json`). One real level of nesting is expected (chat/,
 * chat/) but the walk is depth-general. Skips `.history/`, dotfiles, and any
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
 * `chat/researcher.json`) within the org's agents dir, validating every segment.
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
