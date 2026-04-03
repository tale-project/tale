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
}

export interface AgentJsonConfig {
  displayName: string;
  description?: string;
  avatarUrl?: string;
  systemInstructions: string;
  toolNames?: string[];
  integrationBindings?: string[];
  delegates?: string[];
  workflows?: string[];
  supportedModels: string[];
  provider?: string;
  knowledgeMode?: 'off' | 'tool' | 'context' | 'both';
  webSearchMode?: 'off' | 'tool' | 'context' | 'both';
  includeOrgKnowledge?: boolean;
  includeTeamKnowledge?: boolean;
  knowledgeTopK?: number;
  structuredResponsesEnabled?: boolean;
  maxSteps?: number;
  timeoutMs?: number;
  outputReserve?: number;
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
