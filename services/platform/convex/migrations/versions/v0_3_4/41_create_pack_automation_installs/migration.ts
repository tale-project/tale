'use node';

/**
 * 0.3.4 / 41 — create install rows for the remapped pack automations.
 *
 * After 36 remapped `wfInstallations` onto automation slugs, every live
 * remapped workflow belongs to an automation that may have no
 * `automationInstallations` row yet (standalone workflows never had one; the
 * email folds already do via 0.3.4/02). Create the missing row — marker
 * `installedBy` so `down` deletes exactly these — with an empty resources
 * ledger (any reinstall heals it). Idempotent: an existing row of any
 * provenance is never touched.
 */

import { retired } from '../../../../legacy/frozen/retired_refs';
import { defineNodeMigration } from '../../../framework/define';
import {
  MIGRATION_INSTALLED_BY,
  WORKFLOW_TO_AUTOMATION,
} from '../33_workflows_become_automations/mapping';

/** Deterministic stamp (the real apply moment lives in the migration
 *  ledger); wall-clock here would break the chain's re-up convergence. */
const PACK_INSTALLED_AT_MS = 1_720_000_000_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export const migration = defineNodeMigration({
  title: 'Create install rows for remapped pack automations',
  description:
    'Creates a marker automationInstallations row for every mapped ' +
    'automation whose remapped workflow install row exists without one, so ' +
    'the installed pack renders and uninstalls like any automation; down ' +
    'deletes exactly the marker rows this migration created.',
  destructive: false,
  snapshot: 'none',
  subjects: { tables: ['automationInstallations', 'wfInstallations'] },

  async up(ctx, org, helpers) {
    for (const automationSlug of new Set(
      Object.values(WORKFLOW_TO_AUTOMATION),
    )) {
      const wfRow: unknown = await ctx.runQuery(
        retired.workflows.installations.getInstallationInternal,
        { organizationId: org.id, workflowSlug: automationSlug },
      );
      if (!wfRow) continue; // the workflow was never live in this org
      const existing: unknown = await ctx.runQuery(
        retired.automations.install_mutations.getAutomationInstallationInternal,
        { organizationId: org.id, automationSlug },
      );
      if (existing) continue; // e.g. reply-*-emails installed by 0.3.4/02
      await ctx.runMutation(
        retired.automations.install_mutations.upsertAutomationInstallation,
        {
          organizationId: org.id,
          automationSlug,
          automationName: automationSlug,
          installedBy: MIGRATION_INSTALLED_BY,
          status: 'active',
          installedAt: PACK_INSTALLED_AT_MS,
          // Empty on purpose: the files arrived via 33's seedDomain, outside
          // the install-ledger path. Integrity checks see nothing to verify;
          // the first reinstall records the real ledger.
          resources: [],
          requiredIntegrations: [],
        },
      );
      console.log(
        `[${helpers.migrationId}] ${org.slug}: installed ${automationSlug}`,
      );
    }
  },

  async down(ctx, org, helpers) {
    for (const automationSlug of new Set(
      Object.values(WORKFLOW_TO_AUTOMATION),
    )) {
      const row: unknown = await ctx.runQuery(
        retired.automations.install_mutations.getAutomationInstallationInternal,
        { organizationId: org.id, automationSlug },
      );
      if (!isRecord(row) || row.installedBy !== MIGRATION_INSTALLED_BY) {
        continue; // human/system install (or already removed) — leave alone
      }
      await ctx.runMutation(
        retired.automations.install_mutations.deleteAutomationInstallation,
        { organizationId: org.id, automationSlug },
      );
      console.log(
        `[${helpers.migrationId}] ${org.slug}: removed ${automationSlug}`,
      );
    }
  },
});
