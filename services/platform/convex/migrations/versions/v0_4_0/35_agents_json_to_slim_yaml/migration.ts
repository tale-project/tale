'use node';

/**
 * 0.4.0 / 35 — convert an organization's agent files to the slim format.
 *
 * An agent used to be a JSON file describing a persona AND how its turns ran:
 * a pinned model, a timeout, a behaviour kind, a routing block, env
 * requirements. It is now a small YAML file describing only the persona,
 * `<org>/agents/<slug>.yml`. This migration performs that rewrite for every
 * organization, in place.
 *
 * `up` snapshots the org's `agents/` directory, walks every JSON file in it
 * (subfolders included — the slim format is flat, so `chat/assistant.json`
 * becomes `assistant.yml`), maps each through `mapping.ts` and writes the
 * result. Every setting the slim format dropped is preserved under
 * `metadata.retired`, so nothing an agent said is lost — the mapping's header
 * explains each carry and each preservation. The converted JSON is then
 * removed: it is not an agent in an older format but a document whose fields
 * no longer exist, and leaving it behind would make the roster ambiguous. A
 * folder the conversion emptied goes too — the flat format has none — while a
 * folder still holding anything else is left exactly as it is.
 *
 * Idempotent per org: a second run finds no JSON files and writes nothing, and
 * the same inputs always produce the same slugs and the same bytes. `down`
 * restores the directory from the fs-tree snapshot `up` takes first, which
 * puts the JSON files back and removes exactly the YAML the conversion added.
 *
 * Agent files under `apps/<automation>/agents/` are NOT touched: those belong
 * to an automation bundle and travel with it.
 */

import path from 'node:path';

import { serializeAgentYaml } from '../../../../../lib/agents/parse';
import {
  resolveAgentFilePath,
  resolveAgentsDir,
} from '../../../../agents/file_utils';
import { walkAgentRelativePaths } from '../../../../legacy/frozen/agents_file_utils';
import { readdirSafe } from '../../../../lib/file_io';
import { defineNodeMigration } from '../../../framework/define';
import { convertAgentFiles, type RetiredAgentFile } from './mapping';

/**
 * Remove the folders the conversion emptied — deepest first, and only when a
 * folder holds nothing at all, so anything an operator kept beside an agent
 * survives. The flat format has no folders, and an empty `chat/` left behind
 * would suggest agents still live in one.
 */
async function pruneEmptyFolders(
  agentsDir: string,
  relPaths: readonly string[],
  removeDirSafe: (dirPath: string) => Promise<boolean>,
): Promise<void> {
  const folders = new Set<string>();
  for (const relPath of relPaths) {
    const segments = relPath.split('/').slice(0, -1);
    for (let depth = segments.length; depth > 0; depth -= 1) {
      folders.add(segments.slice(0, depth).join('/'));
    }
  }
  const deepestFirst = [...folders].sort(
    (a, b) => b.split('/').length - a.split('/').length || a.localeCompare(b),
  );
  for (const folder of deepestFirst) {
    const dir = path.join(agentsDir, folder);
    if ((await readdirSafe(dir)).length === 0) await removeDirSafe(dir);
  }
}

export const migration = defineNodeMigration({
  title: 'Convert agent files to the slim agent format',
  description:
    "Rewrites each organization's agent JSON files into flat " +
    'agents/<slug>.yml files carrying the persona only — name, description, ' +
    'i18n, visibility, instructions, skill bindings and one knowledge scope — ' +
    'and preserves every dropped setting (models, timeouts, behaviour kinds, ' +
    'routing, env requirements, conversation starters) under metadata.retired. ' +
    'The converted JSON files are removed. down restores the agents directory ' +
    'from the fs-tree snapshot taken before the rewrite.',
  destructive: true,
  snapshot: 'fs-tree',
  subjects: { domains: ['agents'] },

  async up(_ctx, org, helpers) {
    const agentsDir = resolveAgentsDir(org.slug);
    await helpers.snapshotFsTree(agentsDir);

    // Sorted so the conversion sees the same order on every run — slug
    // assignment resolves collisions in file order.
    const relPaths = (await walkAgentRelativePaths(org.slug)).sort();
    if (relPaths.length === 0) return;

    const files: RetiredAgentFile[] = [];
    for (const relPath of relPaths) {
      const content = await helpers.readFileSafe(path.join(agentsDir, relPath));
      if (content === null) continue;
      let data: unknown;
      try {
        data = JSON.parse(content) as unknown;
      } catch (err) {
        // A file that is not JSON at all cannot be converted, and skipping it
        // would delete an agent on the next step. Fail loudly, named.
        throw new Error(
          `[${helpers.migrationId}] ${org.slug}: agents/${relPath} is not valid JSON`,
          { cause: err },
        );
      }
      files.push({ relPath, data });
    }

    for (const agent of convertAgentFiles(files)) {
      await helpers.atomicWrite(
        resolveAgentFilePath(org.slug, agent.slug),
        serializeAgentYaml(agent.definition),
      );
    }
    for (const relPath of relPaths) {
      await helpers.removeFileSafe(path.join(agentsDir, relPath));
    }
    await pruneEmptyFolders(agentsDir, relPaths, (dir) =>
      helpers.removeDirSafe(dir),
    );
    console.log(
      `[${helpers.migrationId}] converted ${relPaths.length} agent file(s) for ${org.slug}`,
    );
  },

  async down(_ctx, org, helpers) {
    await helpers.restoreFsTree(resolveAgentsDir(org.slug));
  },
});
