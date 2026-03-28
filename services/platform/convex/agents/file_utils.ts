'use node';

/**
 * Agent JSON file utilities.
 *
 * Pure helpers for serializing, validating, and hashing agent JSON files.
 * No Convex dependencies — these can be used in any Node.js context.
 */

import { createHash } from 'node:crypto';
import path from 'node:path';

import { agentJsonSchema } from '../../lib/shared/schemas/agents';

const AGENT_NAME_REGEX = /^[a-z0-9][a-z0-9_-]*$/;
const MAX_FILE_SIZE_BYTES = 256 * 1024; // 256 KB
const MAX_HISTORY_ENTRIES = 100;

export interface AgentJsonConfig {
  displayName: string;
  description?: string;
  avatarUrl?: string;
  systemInstructions: string;
  toolNames?: string[];
  integrationBindings?: string[];
  delegates?: string[];
  workflows?: string[];
  modelPreset?: 'fast' | 'standard' | 'advanced';
  modelId?: string;
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
}

export type AgentReadResult =
  | { ok: true; config: AgentJsonConfig; hash: string }
  | {
      ok: false;
      error: 'not_found' | 'corrupted' | 'too_large' | 'symlink';
      message: string;
    };

export function validateAgentName(name: string): boolean {
  return AGENT_NAME_REGEX.test(name);
}

export function agentNameFromFileName(fileName: string): string {
  return path.basename(fileName, '.json');
}

export function sha256(content: string): string {
  return createHash('sha256').update(content, 'utf-8').digest('hex');
}

export function serializeAgentJson(config: AgentJsonConfig): string {
  const cleaned = Object.fromEntries(
    Object.entries(config).filter(
      ([, v]) =>
        v !== null && v !== undefined && !(Array.isArray(v) && v.length === 0),
    ),
  );
  return JSON.stringify(cleaned, null, 2) + '\n';
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
  if (!dir) {
    throw new Error(
      'AGENTS_DIR environment variable is not set. ' +
        'Set it in .env to the absolute path of your agents directory ' +
        '(e.g., AGENTS_DIR=/path/to/tale/examples/agents).',
    );
  }
  return dir;
}

export function resolveAgentsDir(orgSlug: string): string {
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
