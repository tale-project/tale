'use node';

/**
 * Load Delegate Agent Configurations
 *
 * Reads delegate agent JSON files from the filesystem
 * and converts them to DelegateAgentMeta for tool creation.
 */

import { readFile, stat } from 'node:fs/promises';

import type { ActionCtx } from '../../_generated/server';
import type { DelegateAgentMeta } from './create_delegation_tool';

import { toSerializableConfig } from '../../agents/config';
import {
  MAX_FILE_SIZE_BYTES,
  parseAgentJson,
  resolveAgentFilePath,
} from '../../agents/file_utils';

export async function loadDelegateAgents(
  ctx: ActionCtx,
  delegateNames: string[],
  organizationId: string,
  orgSlug: string,
): Promise<DelegateAgentMeta[]> {
  if (delegateNames.length === 0) return [];

  const delegates: DelegateAgentMeta[] = [];

  for (const name of delegateNames) {
    try {
      const filePath = resolveAgentFilePath(orgSlug, name);
      const fileStat = await stat(filePath);
      if (fileStat.size > MAX_FILE_SIZE_BYTES) continue;

      const content = await readFile(filePath, 'utf-8');
      const config = parseAgentJson(content);
      const agentConfig = toSerializableConfig(name, config);

      delegates.push({
        rootVersionId: name,
        name,
        displayName: config.displayName,
        description: config.description ?? '',
        agentConfig,
        model: agentConfig.model ?? '',
        provider: agentConfig.provider,
        roleRestriction: config.roleRestriction,
      });
    } catch (err) {
      console.warn(
        `Delegate agent "${name}" unavailable, skipping.`,
        err instanceof Error ? err.message : err,
      );
    }
  }

  return delegates;
}
