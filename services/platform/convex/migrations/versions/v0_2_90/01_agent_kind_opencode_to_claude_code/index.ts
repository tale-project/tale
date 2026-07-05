'use node';

/**
 * Node migration: rewrite `agentKind: 'opencode'` → `'claude-code'` in every
 * org agent JSON file. See {@link meta}.
 */

import {
  type AgentJsonConfig,
  parseAgentJson,
  resolveAgentFilePathFromRelative,
  resolveAgentsDir,
  serializeAgentJson,
  walkAgentRelativePaths,
} from '../../../../agents/file_utils';
import type { NodeMigration } from '../../../framework/types';
import { meta } from './meta';

export const migration: NodeMigration = {
  meta,
  async up(_ctx, org, helpers) {
    const dir = resolveAgentsDir(org.slug);
    await helpers.snapshotFsTree(meta.id, org.slug, dir);

    const relPaths = await walkAgentRelativePaths(org.slug);
    for (const rel of relPaths) {
      const filePath = resolveAgentFilePathFromRelative(org.slug, rel);
      const raw = await helpers.readFileSafe(filePath);
      if (raw === null) continue;
      let config: AgentJsonConfig;
      try {
        const parsed: unknown = JSON.parse(raw);
        if (
          typeof parsed !== 'object' ||
          parsed === null ||
          (parsed as { agentKind?: string }).agentKind !== 'opencode'
        ) {
          continue;
        }
        config = parseAgentJson(
          JSON.stringify({
            ...(parsed as AgentJsonConfig),
            agentKind: 'claude-code',
          }),
        );
      } catch (err) {
        console.warn(
          `[${meta.id}] skipping unparseable agent file ${org.slug}/${rel}:`,
          err,
        );
        continue;
      }
      await helpers.atomicWrite(filePath, serializeAgentJson(config));
    }
  },

  async down(_ctx, org, helpers) {
    const dir = resolveAgentsDir(org.slug);
    await helpers.restoreFsTree(meta.id, org.slug, dir);
  },
};
