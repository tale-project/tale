/**
 * 0.3.4 / 39 — remap workflowEnv rows onto their automations.
 *
 * Sibling of 36_remap_wf_installations for the `workflowEnv` table: each retired
 * standalone slug's rows are patched to the automation slug that now carries
 * the workflow inline. Nothing else on the row changes, so `down` — the
 * inverse map — restores rows byte-for-byte. Down assumption (documented on
 * 36 too): automation-slug-named rows in this table can only exist post-
 * cutover via this remap; the chain never interleaves fresh installs.
 */

import type { Id } from '../../../../_generated/dataModel';
import { defineDbMigration } from '../../../framework/define';
import {
  AUTOMATION_TO_WORKFLOW,
  WORKFLOW_TO_AUTOMATION,
} from '../33_workflows_become_automations/mapping';

export const migration = defineDbMigration({
  title: 'Remap workflow env rows onto their automations',
  description:
    'Patches every workflowEnv row whose workflowSlug is a retired standalone slug to its automation slug so configured variables and secrets follow the workflow; down applies the inverse map, restoring rows byte-for-byte.',
  destructive: false,
  snapshot: 'none',
  subjects: { tables: ['workflowEnv'] },
  table: 'workflowEnv',

  async up(ctx, doc) {
    if (typeof doc.workflowSlug !== 'string') return;
    const automationSlug = WORKFLOW_TO_AUTOMATION[doc.workflowSlug];
    if (!automationSlug) return;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- MigrationDoc ids are untyped by design
    await ctx.db.patch(doc._id as Id<'workflowEnv'>, {
      workflowSlug: automationSlug,
    });
  },

  async down(ctx, doc) {
    if (typeof doc.workflowSlug !== 'string') return;
    const fromSlug = AUTOMATION_TO_WORKFLOW[doc.workflowSlug];
    if (!fromSlug) return;
    // oxlint-disable-next-line typescript/no-unsafe-type-assertion -- MigrationDoc ids are untyped by design
    await ctx.db.patch(doc._id as Id<'workflowEnv'>, {
      workflowSlug: fromSlug,
    });
  },
});
