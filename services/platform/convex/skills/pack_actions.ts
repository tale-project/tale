'use node';

/**
 * Pack discovery for the Apps hub. A "pack" is an installed skill whose SKILL.md
 * frontmatter declares a `pack:` block. This lists those packs and reads each
 * one's bundled `views/*.json` configs (the configurable UI pages), so the hub
 * is fully data-driven: a new pack with view configs appears with no code
 * change. Malformed skills/views are skipped (never fail the whole list).
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';

import { v } from 'convex/values';

import { parseSkillMd } from '../../lib/shared/schemas/skills';
import { viewConfigSchema } from '../../lib/shared/schemas/views';
import { action } from '../_generated/server';
import { requireOrgMembershipById } from '../lib/auth/require_org_membership';
import {
  resolveSkillDir,
  resolveSkillMdPath,
  resolveSkillsDir,
  validateSkillSlug,
} from './file_utils';

const MAX_VIEW_BYTES = 256 * 1024;

export const listPacks = action({
  args: { organizationId: v.string() },
  returns: v.any(),
  // oxlint-disable-next-line typescript/no-explicit-any -- heterogeneous pack/view shapes at the API boundary
  handler: async (ctx, args): Promise<any[]> => {
    const { orgSlug } = await requireOrgMembershipById(
      ctx,
      args.organizationId,
    );

    const skillsDir = resolveSkillsDir(orgSlug);
    let slugs: string[];
    try {
      const entries = await readdir(skillsDir, { withFileTypes: true });
      slugs = entries
        .filter((e) => e.isDirectory() && validateSkillSlug(e.name))
        .map((e) => e.name);
    } catch (err) {
      if (err instanceof Error && 'code' in err && err.code === 'ENOENT') {
        return [];
      }
      throw err;
    }

    const packs: Array<{
      slug: string;
      name: string;
      description: string;
      messageNamespace: string;
      views: unknown[];
    }> = [];

    for (const slug of slugs) {
      let meta;
      try {
        const content = await readFile(
          resolveSkillMdPath(orgSlug, slug),
          'utf8',
        );
        meta = parseSkillMd(content).meta;
      } catch (err) {
        console.warn(`[listPacks] skipping skill "${slug}":`, err);
        continue;
      }
      if (!meta.pack) continue; // not a pack — just a skill

      const views: unknown[] = [];
      const viewsDir = path.join(resolveSkillDir(orgSlug, slug), 'views');
      let viewFiles: string[] = [];
      try {
        viewFiles = (await readdir(viewsDir)).filter((f) =>
          f.endsWith('.json'),
        );
      } catch {
        // No views dir — a pack can ship workflows/agents without views.
      }
      for (const file of viewFiles.sort()) {
        const filePath = path.join(viewsDir, file);
        try {
          const info = await stat(filePath);
          if (info.size > MAX_VIEW_BYTES) {
            console.warn(`[listPacks] view too large, skipping: ${filePath}`);
            continue;
          }
          const parsed = viewConfigSchema.safeParse(
            JSON.parse(await readFile(filePath, 'utf8')),
          );
          if (parsed.success) views.push(parsed.data);
          else
            console.warn(
              `[listPacks] invalid view ${file}:`,
              parsed.error.message,
            );
        } catch (err) {
          console.warn(`[listPacks] view read failed ${file}:`, err);
        }
      }

      packs.push({
        slug,
        name: meta.name,
        description: meta.description,
        messageNamespace: meta.pack.messageNamespace,
        views,
      });
    }

    return packs;
  },
});
