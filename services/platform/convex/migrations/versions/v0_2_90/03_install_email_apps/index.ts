'use node';

/**
 * Node migration: install the matching email inbox app for every org with an
 * ACTIVE credential for one of the email integrations, so the org keeps an
 * inbox UI when the built-in Conversations pages are removed.
 *
 * Runs once per org (the node-runner contract). All reads/writes go through
 * internal functions by reference — the install itself is the shared
 * `installAutomationInternal` action (same core as the public `installAutomation`, minus
 * the developer-settings gate that cannot pass unauthenticated). A single
 * failed install/uninstall is logged and skipped rather than thrown: the
 * runner treats a handler throw as fatal for the whole fleet run, and one
 * org's broken catalog must not block every other org's migration.
 *
 * Idempotent both ways: `up` skips apps that are already installed (by
 * anyone), `down` removes ONLY install rows still carrying this migration's
 * `installedBy` marker — a human install is never touched.
 */

import { getString, isRecord } from '../../../../../lib/utils/type-utils';
import { internal } from '../../../../_generated/api';
import type {
  MigrationOrg,
  NodeMigration,
  NodeMigrationCtx,
} from '../../../framework/types';
import { meta } from './meta';

/**
 * Email integration slug → the automation that fronts it. The slugs were
 * renamed action-style (`outlook-inbox` → `reply-outlook-emails`, etc.) while
 * the branch was still unreleased; this historical migration is re-seedable, so
 * the constant is edited in place to the current slugs rather than pinned to the
 * old names.
 */
export const INTEGRATION_TO_EMAIL_APP: Readonly<Record<string, string>> = {
  outlook: 'reply-outlook-emails',
  gmail: 'reply-gmail-emails',
  imap_smtp: 'reply-imap-emails',
};

/**
 * Recorded as `installedBy` on every install row this migration creates, so
 * `down` can target exactly its own rows.
 */
export const MIGRATION_INSTALLED_BY = 'migration:v0_2_90_install_email_apps';

/** The gate-relevant slice of an `integrationCredentials` row. */
export interface CredentialLike {
  slug: string;
  isActive: boolean;
  status: string;
}

/**
 * The app slugs `up` must ensure for a set of credential rows: one inbox app
 * per email integration with an ACTIVE credential — `isActive &&
 * status === 'active'`, the canonical availability contract
 * (`integrations/availability.ts::credentialActive`). Deduplicated; ordered
 * by the map for determinism.
 */
export function emailAppInstallTargets(
  credentials: readonly CredentialLike[],
): string[] {
  const activeSlugs = new Set(
    credentials
      .filter((cred) => cred.isActive && cred.status === 'active')
      .map((cred) => cred.slug),
  );
  return Object.entries(INTEGRATION_TO_EMAIL_APP)
    .filter(([integration]) => activeSlugs.has(integration))
    .map(([, appSlug]) => appSlug);
}

/** The org's install row for `appSlug`, or `null`. */
async function installedRow(
  ctx: NodeMigrationCtx,
  organizationId: string,
  automationSlug: string,
): Promise<unknown> {
  return await ctx.runQuery(
    internal.automations.install_mutations.getAutomationInstallationInternal,
    { organizationId, automationSlug },
  );
}

function warnSummary(
  org: MigrationOrg,
  verb: string,
  failures: readonly string[],
): void {
  if (failures.length === 0) return;
  // console.error, not warn: the fleet run still ends "applied", so this line
  // is the ONLY trace that an org was left without its inbox app. The heal is
  // `tale migrate` down+up of this version (idempotent; installed apps are
  // skipped — but note a human-uninstalled app would be re-installed by up).
  console.error(
    `[${meta.id}] ${org.slug}: ${failures.length} email app ${verb}(s) failed ` +
      `(${failures.join(', ')}) — fix the cause and re-run this version ` +
      `(down+up); succeeded/already-handled apps are skipped on the next pass.`,
  );
}

export const migration: NodeMigration = {
  meta,

  async up(ctx, org) {
    const credentials: CredentialLike[] = await ctx.runQuery(
      internal.integrations.credential_queries.listInternal,
      { organizationId: org.id },
    );
    const failures: string[] = [];
    for (const appSlug of emailAppInstallTargets(credentials)) {
      // Already installed (by anyone) — never re-install or overwrite the
      // existing row's installedBy (idempotent).
      if (await installedRow(ctx, org.id, appSlug)) continue;
      try {
        await ctx.runAction(
          internal.automations.install_actions.installAutomationInternal,
          {
            organizationId: org.id,
            automationSlug: appSlug,
            installedBy: MIGRATION_INSTALLED_BY,
          },
        );
      } catch (err) {
        // e.g. the bundle is missing from this deployment's built-in catalog
        // (TALE_CONFIG_BUILTIN_DIR predates the email apps). Log + continue —
        // a throw would abort the whole fleet run.
        console.warn(
          `[${meta.id}] ${org.slug}: installing "${appSlug}" failed:`,
          err,
        );
        failures.push(appSlug);
      }
    }
    warnSummary(org, 'install', failures);
  },

  async down(ctx, org) {
    const failures: string[] = [];
    for (const appSlug of Object.values(INTEGRATION_TO_EMAIL_APP)) {
      const row = await installedRow(ctx, org.id, appSlug);
      const installedBy = isRecord(row)
        ? getString(row, 'installedBy')
        : undefined;
      // Remove ONLY installs this migration made; a human install (or an
      // already-removed app) is left alone (idempotent).
      if (installedBy !== MIGRATION_INSTALLED_BY) continue;
      try {
        await ctx.runAction(
          internal.automations.install_actions.uninstallAutomationInternal,
          { organizationId: org.id, automationSlug: appSlug },
        );
      } catch (err) {
        console.warn(
          `[${meta.id}] ${org.slug}: uninstalling "${appSlug}" failed:`,
          err,
        );
        failures.push(appSlug);
      }
    }
    warnSummary(org, 'uninstall', failures);
  },
};
