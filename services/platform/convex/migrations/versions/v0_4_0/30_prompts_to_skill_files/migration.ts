'use node';

/**
 * Export prompt-library templates to skill files.
 *
 * The prompt library becomes ordinary file-based org config: every prompt an
 * organization holds is written as a skill bundle,
 * `<org>/skills/<slug>/SKILL.md`, with the prompt body carried over verbatim
 * and its sharing scope expressed as the skill's own `visibility` — a
 * `personal` prompt becomes a `private` skill owned by its author, a `team`
 * or `global` one becomes `org`-visible. There is no separate sharing record
 * to write: the file itself says who may see it.
 *
 * `up` reads the org's `promptTemplates` rows and maps them through
 * `mapping.ts` — deterministic slugs, and a `metadata.prompt` block recording
 * the title, scope, team, category and tags a skill has no field of its own
 * for — then writes one `SKILL.md` per prompt. Soft-deleted prompts are
 * skipped: exporting one would undo a member's delete.
 *
 * Nothing is removed from the database. The `promptTemplates` rows stay
 * readable throughout, so an install can run this and still serve the old
 * library; draining and dropping those tables is a separate, later step, once
 * nothing reads them.
 *
 * Idempotent per org: the same rows always yield the same slugs and the same
 * bytes, so a resumed or repeated run rewrites identical files. `down`
 * restores the org's `skills/` directory from the fs-tree snapshot `up` takes
 * first, which removes exactly the bundles the export added and puts back any
 * skill that was already there.
 */

import { serializeSkillMd } from '../../../../../lib/skills/parse';
import { internal } from '../../../../_generated/api';
import {
  resolveSkillMdPath,
  resolveSkillsDir,
} from '../../../../skills/file_utils';
import { defineNodeMigration } from '../../../framework/define';
import { exportPromptsToSkills, type PromptTemplateRow } from './mapping';

export const migration = defineNodeMigration({
  title: 'Export prompt-library templates to skill files',
  description:
    'For each organization, writes every active prompt template as a ' +
    'skills/<slug>/SKILL.md bundle — personal prompts become private skills, ' +
    'team and global ones org-visible — carrying the prompt body verbatim and ' +
    'recording its title, scope, team, category and tags under ' +
    'metadata.prompt. The promptTemplates rows are left untouched, so the old ' +
    'library keeps reading. down restores the org skills directory from the ' +
    'fs-tree snapshot taken before the export, removing exactly what was added.',
  destructive: false,
  // Non-destructive to the database, but it writes into a config directory an
  // org may already hold skills in — the snapshot is what lets `down` put
  // that directory back exactly as it was.
  snapshot: 'fs-tree',
  subjects: { tables: ['promptTemplates'], domains: ['skills'] },

  async up(ctx, org, helpers) {
    await helpers.snapshotFsTree(resolveSkillsDir(org.slug));

    const rows: PromptTemplateRow[] = await ctx.runQuery(
      internal.migrations.versions.v0_4_0['30_prompts_to_skill_files']
        .prompt_rows.listPromptTemplatesByOrg,
      { organizationId: org.id },
    );

    for (const skill of exportPromptsToSkills(rows)) {
      await helpers.atomicWrite(
        resolveSkillMdPath(org.slug, skill.slug),
        serializeSkillMd(skill.meta, skill.body),
      );
    }
  },

  async down(_ctx, org, helpers) {
    await helpers.restoreFsTree(resolveSkillsDir(org.slug));
  },
});
