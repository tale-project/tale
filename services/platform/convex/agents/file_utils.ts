'use node';

/**
 * Agent JSON file utilities.
 *
 * Pure helpers for serializing, validating, and hashing agent JSON files.
 * No Convex dependencies — these can be used in any Node.js context.
 */

import path from 'node:path';

import { agentJsonSchema } from '../../lib/shared/schemas/agents';
import { serializeJson, sha256, validateOrgSlug } from '../lib/file_io';
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
  supportedModels: string[];
  provider?: string;
  knowledgeMode?: 'off' | 'tool' | 'context' | 'both';
  webSearchMode?: 'off' | 'tool' | 'context' | 'both';
  /**
   * Per-user personalization (custom instructions + memories) injection mode.
   * 'on' (default): inject when org/user toggles permit. 'off': never inject
   * and strip the propose_memory tool. Use 'off' for strict-format workflow
   * agents whose output shape would be polluted by user tone preferences.
   */
  personalizationMode?: 'on' | 'off';
  /**
   * Marks an agent whose outputs produce legal or similarly significant
   * effects on users (GDPR Art 22 / EU AI Act high-risk). When true,
   * personalization is force-disabled regardless of other toggles.
   */
  significantEffectsUseCase?: boolean;
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
  responseCacheEnabled?: boolean;
  responseCacheTtlMs?: number;
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

function getBaseDir(): string {
  const dir = process.env.AGENTS_DIR;
  if (dir) return dir;
  const configDir = process.env.TALE_CONFIG_DIR;
  if (configDir) return path.join(configDir, 'agents');
  throw new Error(
    'Neither TALE_CONFIG_DIR nor AGENTS_DIR environment variable is set. ' +
      'Set TALE_CONFIG_DIR in .env to the root config directory ' +
      '(e.g., TALE_CONFIG_DIR=/path/to/tale/examples).',
  );
}

export function resolveAgentsDir(orgSlug: string): string {
  if (!validateOrgSlug(orgSlug)) {
    throw new Error(`Invalid org slug: ${orgSlug}`);
  }
  const baseDir = getBaseDir();
  if (orgSlug === 'default') {
    return baseDir;
  }
  return path.join(baseDir, orgSlug);
}

export function resolveAgentFilePath(
  orgSlug: string,
  agentName: string,
): string {
  if (!validateAgentName(agentName)) {
    throw new Error(`Invalid agent name: ${agentName}`);
  }
  const dir = resolveAgentsDir(orgSlug);
  const resolved = path.resolve(dir, `${agentName}.json`);
  const expectedPrefix = path.resolve(dir);
  if (
    !resolved.startsWith(expectedPrefix + path.sep) &&
    resolved !== expectedPrefix
  ) {
    throw new Error(`Path traversal detected: ${agentName}`);
  }
  return resolved;
}

export function resolveHistoryDir(orgSlug: string, agentName: string): string {
  return path.join(resolveAgentsDir(orgSlug), '.history', agentName);
}

export { MAX_FILE_SIZE_BYTES, MAX_HISTORY_ENTRIES };
