'use node';

/**
 * 0.2.98 / 02 — retire the archived `opencode` product slug from agent configs.
 *
 * OpenCode is no longer a product runtime (`cursor` replaced it in the
 * registry). Any org agent file still carrying `agentKind: 'opencode'` is
 * rewritten to `claude-code` (the gateway-managed default). Idempotent: files
 * already on `claude-code` or `cursor` are untouched. A per-org fs-tree
 * snapshot of the agents directory is taken first so `down` can restore the
 * prior files.
 */

import {
  type AgentJsonConfig,
  parseAgentJson,
  resolveAgentFilePathFromRelative,
  resolveAgentsDir,
  serializeAgentJson,
  walkAgentRelativePaths,
} from '../../../../legacy/frozen/agents_file_utils';
import { defineNodeMigration } from '../../../framework/define';

export const migration = defineNodeMigration({
  title: 'Rewrite agentKind opencode → claude-code in agent configs',
  description:
    'Retires the archived opencode product slug: every external-agent config ' +
    'with agentKind opencode becomes claude-code. Idempotent; cursor and ' +
    'claude-code files are left unchanged. A per-org fs-tree snapshot of the ' +
    'agents directory is taken first so down can restore the prior files.',
  destructive: false,
  snapshot: 'fs-tree',
  formerIds: ['0.2.90/01_agent_kind_opencode_to_claude_code'],
  subjects: { domains: ['agents'] },

  async up(_ctx, org, helpers) {
    const dir = resolveAgentsDir(org.slug);
    await helpers.snapshotFsTree(dir);

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
          `[${helpers.migrationId}] skipping unparseable agent file ${org.slug}/${rel}:`,
          err,
        );
        continue;
      }
      await helpers.atomicWrite(filePath, serializeAgentJson(config));
    }
  },

  async down(_ctx, org, helpers) {
    const dir = resolveAgentsDir(org.slug);
    await helpers.restoreFsTree(dir);
  },
});
