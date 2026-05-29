'use node';

/**
 * Agent JSON file utilities.
 *
 * Pure helpers for serializing, validating, and hashing agent JSON files.
 * No Convex dependencies — these can be used in any Node.js context.
 */

import path from 'node:path';

import {
  agentJsonSchema,
  type SkillBindingResolvedEntry,
} from '../../lib/shared/schemas/agents';
import {
  getConfigRoot,
  safeJoinWithinDir,
  serializeJson,
  sha256,
  validateOrgSlug,
} from '../lib/file_io';
import { validateAgentName } from './validators';

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
   * user's message straight to an image model, bypassing the tool loop.
   */
  primaryBehavior?: 'chat' | 'image-generation';
  systemInstructions?: string;
  toolNames?: string[];
  integrationBindings?: string[];
  delegates?: string[];
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
  /**
   * Legacy snapshot from the old transitive tool-grant model. No longer read
   * at runtime — kept optional so historical agent JSON still validates.
   */
  skillBindingsResolved?: SkillBindingResolvedEntry[];
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
  roleRestriction?: 'admin_developer';
  conversationStarters?: string[];
  visibleInChat?: boolean;
  i18n?: Record<string, AgentI18nOverrides>;
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

export function agentNameFromFileName(fileName: string): string {
  return path.basename(fileName, '.json');
}

export function serializeAgentJson(config: AgentJsonConfig): string {
  return serializeJson(config);
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

export function resolveAgentFilePath(
  orgSlug: string,
  agentName: string,
): string {
  if (!validateAgentName(agentName)) {
    throw new Error(`Invalid agent name: ${agentName}`);
  }
  return safeJoinWithinDir(resolveAgentsDir(orgSlug), `${agentName}.json`);
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
  return safeJoinWithinDir(
    safeJoinWithinDir(resolveAgentsDir(orgSlug), '.history'),
    agentName,
  );
}

export { MAX_FILE_SIZE_BYTES, MAX_HISTORY_ENTRIES };
