import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.90 / 05 — remove the retired workforce persona agents from org disk.
 *
 * The `agents/workforce/` catalog folder (CEO/CTO/CMO persona agents) left the
 * builtin catalog; the org-scaffolded copies under `<org>/agents/workforce/`
 * are deleted here so the catalog and list views stop offering retired
 * personas. Installation rows are handled by the sibling db migration
 * (0.2.90/06). A per-org fs-tree snapshot of the agents directory is taken
 * first so `down` can restore the prior files.
 */
export const meta: MigrationMeta = {
  id: '0.2.90/05_remove_workforce_agents',
  semver: '0.2.90',
  numericId: 5,
  slug: 'remove_workforce_agents',
  title: 'Delete the retired workforce persona agent files',
  description:
    'Deletes the <org>/agents/workforce/ subtree (the retired persona ' +
    'catalog: CEO/CTO/CMO and their teams). Idempotent: orgs without the ' +
    'folder are untouched; other agent folders are never touched. A per-org ' +
    'fs-tree snapshot of the agents directory is taken first so down can ' +
    'restore the prior files.',
  kind: 'node',
  reversible: true,
  destructive: true,
  snapshot: 'fs-tree',
};
