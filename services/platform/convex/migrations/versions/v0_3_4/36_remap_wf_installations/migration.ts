/**
 * 0.3.4 / 36 — remap workflow install rows onto their automations.
 *
 * Each retired standalone slug's `wfInstallations` row is patched to the
 * automation slug that now carries the workflow inline (`workflowSlug` =
 * the automation slug — the inline identity rule) and stamped with
 * `automationSlug` (the ownership marker `processEvent` arbitration and the
 * triggers UI key on). Everything else on the row (installedAt/installedBy
 * provenance, contentHash) is deliberately untouched, so `down` — the
 * inverse map plus clearing the stamp — restores rows byte-for-byte.
 */

import type { Id } from '../../../../_generated/dataModel';
import { defineDbMigration } from '../../../framework/define';
import {
  AUTOMATION_TO_WORKFLOW,
  WORKFLOW_TO_AUTOMATION,
} from '../33_workflows_become_automations/mapping';

export const migration = defineDbMigration({
  title: 'Remap workflow install rows onto their automations',
  description:
    'Patches every wfInstallations row whose workflowSlug is a retired ' +
    'standalone slug to the automation slug that now carries the workflow ' +
    'inline and stamps automationSlug; down applies the inverse map and ' +
    'clears the stamp, restoring rows byte-for-byte.',
  destructive: false,
  snapshot: 'none',
  subjects: { tables: ['wfInstallations'] },
  table: 'wfInstallations',

  async up(ctx, doc) {
    if (typeof doc.workflowSlug !== 'string') return;
    const automationSlug = WORKFLOW_TO_AUTOMATION[doc.workflowSlug];
    if (!automationSlug) return;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- MigrationDoc ids are untyped by design
    await ctx.db.patch(doc._id as Id<'wfInstallations'>, {
      workflowSlug: automationSlug,
      automationSlug,
    });
  },

  async down(ctx, doc) {
    if (typeof doc.workflowSlug !== 'string') return;
    // Only rows THIS migration mapped forward: the automation slug must be
    // both the inverse-map key AND the stamped owner — an automation-born
    // row of the same slug (none exist for these 24, but stay precise) is
    // left alone.
    const fromSlug = AUTOMATION_TO_WORKFLOW[doc.workflowSlug];
    if (!fromSlug || doc.automationSlug !== doc.workflowSlug) return;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- MigrationDoc ids are untyped by design
    await ctx.db.patch(doc._id as Id<'wfInstallations'>, {
      workflowSlug: fromSlug,
      automationSlug: undefined,
    });
  },
});
