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
 *      new automation dirs and the reworked `<provider>/reply-emails` manifests
 *      that now embed their mail-sync workflow;
 *   2. wraps every ORG-AUTHORED standalone workflow file (a slug outside the
 *      builtin map) into a minimal org automation
 *      (`automations/<slug>/automation.json` with the definition inline), so
 *      user-authored work survives the tree removal in 35.
 *
 * An automation slug is a PATH (it IS the dir the automation lives at), so both
 * halves land FOLDERED: the builtin catalog seeds `automations/gmail/
 * reply-emails/`, and an org's `workflows/ops/nightly.json` becomes
 * `automations/ops/nightly/` rather than a flattened root-level dir.
 *
 * `up` only ADDS/refreshes files under `automations/`; the `workflows/` tree
 * is still present (35 removes it) and row remaps follow in 36–40. `down`
 * restores the pre-migration `automations/` tree from the fs snapshot.
 */

import { resolveAutomationManifestPath } from '../../../../legacy/frozen/automations_file_utils';
import { resolveAutomationsDir } from '../../../../legacy/frozen/automations_file_utils';
import { getConfigDomain } from '../../../../legacy/frozen/config_domains';
import {
  isValidAutomationSlug,
  MAX_AUTOMATION_SLUG_DEPTH,
} from '../../../../legacy/frozen/schemas_automations';
import { workflowJsonSchema } from '../../../../legacy/frozen/schemas_workflows';
import { listCatalogArea } from '../../../../lib/config_store/catalog';
import { seedDomain } from '../../../../organizations/scaffold';
import { defineNodeMigration } from '../../../framework/define';
import { WORKFLOW_TO_AUTOMATION } from './mapping';

/**
 * Convert an org-authored standalone workflow slug into the automation slug that
 * now carries it. An automation slug is a PATH, so the workflow's folders are
 * KEPT (`ops/nightly/sync_files` → `ops/nightly/sync-files`) — the automation
 * lands where its author filed the workflow instead of being flattened into a
 * root-level `ops-nightly-sync-files`.
 *
 * Only the alphabet differs: a workflow segment may carry `_` and trail in `-`,
 * an automation segment may not, and the path is capped at
 * {@link MAX_AUTOMATION_SLUG_DEPTH} segments (a deeper one folds its tail into
 * the leaf). The result is validated by the caller before anything is written.
 */
export function workflowSlugToAutomationSlug(slug: string): string {
  const segments = slug
    .split('/')
    .map((segment) =>
      segment.replaceAll('_', '-').replace(/-+/g, '-').replace(/-+$/, ''),
    );
  if (segments.length <= MAX_AUTOMATION_SLUG_DEPTH) return segments.join('/');
  return [
    ...segments.slice(0, MAX_AUTOMATION_SLUG_DEPTH - 1),
    segments.slice(MAX_AUTOMATION_SLUG_DEPTH - 1).join('-'),
  ].join('/');
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
    // know) into minimal org automations, at the SAME path the workflow was
    // filed under. Idempotent: an existing manifest at that slug is never
    // overwritten — on a replayed org the wrap is a no-op, and a genuine
    // collision with an org automation is surfaced instead of clobbered.
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
      const automationSlug = workflowSlugToAutomationSlug(slug);
      if (!isValidAutomationSlug(automationSlug)) {
        console.warn(
          `[${helpers.migrationId}] ${org.slug}: "${slug}" has no valid automation path — left to the snapshot`,
        );
        continue;
      }
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
