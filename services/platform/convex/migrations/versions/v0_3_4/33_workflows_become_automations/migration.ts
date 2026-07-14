'use node';

/**
 * 0.3.4 / 33 — seed the workflow-carrying automations into every org tree.
 *
 * The standalone `workflows/` config domain retired: every builtin workflow
 * now lives INLINE in an automation manifest (see `mapping.ts`). This first
 * cutover step makes each org's `automations/` dir carry those definitions:
 *
 *   1. re-seeds the automations domain from the builtin catalog
 *      (`seedDomain(…, override: true)` — the scaffold primitive: builtin-named
 *      bundles are refreshed, org-authored ones untouched), delivering the 21
 *      new automation dirs and the reworked `reply-*-emails` manifests that
 *      now embed their mail-sync workflow;
 *   2. wraps every ORG-AUTHORED standalone workflow file (a slug outside the
 *      builtin map) into a minimal org automation
 *      (`automations/<flattened-slug>/automation.json` with the definition
 *      inline), so user-authored work survives the tree removal in 35.
 *
 * `up` only ADDS/refreshes files under `automations/`; the `workflows/` tree
 * is still present (35 removes it) and row remaps follow in 36–40. `down`
 * restores the pre-migration `automations/` tree from the fs snapshot.
 */

import { getConfigDomain } from '../../../../../lib/shared/config/registry';
import { workflowJsonSchema } from '../../../../../lib/shared/schemas/workflows';
import { resolveAutomationManifestPath } from '../../../../automations/file_utils';
import { resolveAutomationsDir } from '../../../../automations/file_utils';
import { listCatalogArea } from '../../../../lib/config_store/catalog';
import { seedDomain } from '../../../../organizations/scaffold';
import { defineNodeMigration } from '../../../framework/define';
import { WORKFLOW_TO_AUTOMATION } from './mapping';

/** Flatten a foldered standalone slug into a valid automation slug. */
export function flattenWorkflowSlug(slug: string): string {
  return slug.replaceAll('/', '-').replaceAll('_', '-');
}

export const migration = defineNodeMigration({
  title: 'Seed the workflow-carrying automations into every org tree',
  description:
    'Re-seeds each org automations/ dir from the builtin catalog (override ' +
    'semantics: builtin-named bundles refreshed, org-authored ones kept) so ' +
    'the automations that now carry the retired standalone workflows inline ' +
    'exist on disk, and wraps org-authored standalone workflow files into ' +
    'minimal org automations so user work survives the workflows-tree ' +
    'removal (35). Down restores the automations dir from the fs snapshot.',
  destructive: true,
  snapshot: 'fs-tree',
  subjects: { domains: ['automations', 'workflows'] },

  async up(_ctx, org, helpers) {
    const automationsDir = resolveAutomationsDir(org.slug);
    await helpers.snapshotFsTree(automationsDir);

    const catalogRoot = process.env.TALE_CONFIG_BUILTIN_DIR;
    if (!catalogRoot) {
      // Without a builtin catalog this deployment cannot deliver the new
      // automation bundles; log loudly and keep the org untouched (the
      // deploy-time provisioner heals once the catalog is mounted).
      console.error(
        `[${helpers.migrationId}] ${org.slug}: TALE_CONFIG_BUILTIN_DIR unset — automations not re-seeded`,
      );
      return;
    }
    const result = await seedDomain(
      getConfigDomain('automations'),
      catalogRoot,
      org.slug,
      true,
    );
    if (!result.ok) {
      console.error(
        `[${helpers.migrationId}] ${org.slug}: automations re-seed failed:`,
        result,
      );
    }

    // Wrap org-authored standalone workflows (slugs the builtin map does not
    // know) into minimal org automations. Idempotent: an existing manifest at
    // the flattened slug is never overwritten — on a replayed org the wrap is
    // a no-op, and a genuine collision with an org automation is surfaced
    // instead of clobbered.
    let files: { relativePath: string; content: string }[] = [];
    try {
      files = await listCatalogArea('workflows', org.slug, {
        recursive: true,
      });
    } catch {
      // No workflows dir (org created post-cutover, or already migrated).
      return;
    }
    for (const { relativePath, content } of files) {
      const slug = relativePath.replace(/\.json$/, '');
      if (slug in WORKFLOW_TO_AUTOMATION) continue;
      const parsed = workflowJsonSchema.safeParse(JSON.parse(content));
      if (!parsed.success) {
        console.warn(
          `[${helpers.migrationId}] ${org.slug}: "${slug}" is not a valid workflow — left to the snapshot`,
        );
        continue;
      }
      const automationSlug = flattenWorkflowSlug(slug);
      const manifestPath = resolveAutomationManifestPath(
        org.slug,
        automationSlug,
      );
      if ((await helpers.readFileSafe(manifestPath)) !== null) {
        console.warn(
          `[${helpers.migrationId}] ${org.slug}: automation "${automationSlug}" already exists — "${slug}" left to the snapshot`,
        );
        continue;
      }
      const manifest = {
        name: automationSlug,
        description: `Migrated from the standalone workflow "${slug}".`,
        scope: 'org',
        workflow: parsed.data,
      };
      await helpers.atomicWrite(
        manifestPath,
        JSON.stringify(manifest, null, 2) + '\n',
      );
      console.log(
        `[${helpers.migrationId}] ${org.slug}: wrapped "${slug}" → automations/${automationSlug}`,
      );
    }
  },

  async down(_ctx, org, helpers) {
    await helpers.restoreFsTree(resolveAutomationsDir(org.slug));
  },
});
