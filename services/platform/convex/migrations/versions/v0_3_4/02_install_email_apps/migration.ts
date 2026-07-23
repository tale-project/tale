'use node';

/**
 * 0.3.4 / 02 — auto-install the email inbox apps for orgs already using the
 * email integrations.
 *
 * The dashboard's built-in Conversations pages are replaced by the
 * outlook/sync-emails / gmail/sync-emails / imap-smtp/sync-emails apps, so an
 * org that has a connected email integration would lose its inbox UI on
 * upgrade unless the matching app is installed. Runs once per org (the
 * node-runner contract); all reads/writes go through internal functions by
 * reference. Per org: for every ACTIVE `integrationCredentials` row
 * (`isActive && status === 'active'`, the canonical availability contract)
 * whose slug is outlook / gmail / imap_smtp, install the mapped app via
 * `installAutomationInternal` (the same core as the public `installAutomation`,
 * minus the developer-settings gate that cannot pass unauthenticated inside a
 * migration). The bundles ship no workflows, agents, or required config, so
 * the install needs no wizard input.
 *
 * A single failed install/uninstall is logged and skipped rather than thrown:
 * the runner treats a handler throw as fatal for the whole fleet run, and one
 * org's broken catalog (e.g. the bundle missing from the deployment's
 * built-in catalog) must not block every other org's migration.
 *
 * Idempotent both ways: `up` skips apps that are already installed (by
 * anyone), `down` removes ONLY install rows still carrying this migration's
 * `installedBy` marker (`'migration:v0_2_90_install_email_apps'`) — a human
 * install is never touched. Uninstall never touches the `conversations*`
 * tables — it removes only the app shell, install row, and app-scoped
 * env/secrets (none for these bundles).
 */

import { getString, isRecord } from '../../../../../lib/utils/type-utils';
import { retired } from '../../../../legacy/frozen/retired_refs';
import { defineNodeMigration } from '../../../framework/define';
import type { MigrationOrg, NodeMigrationCtx } from '../../../framework/types';

/** This migration's stable id, used as the log prefix in module helpers. */
const MIGRATION_ID = '0.3.4/02_install_email_apps';

/**
 * Email integration slug → the automation that fronts it. These slugs churned
 * several times while the branch was still unreleased (`outlook-inbox` →
 * `reply-outlook-emails` → `outlook/sync-emails`, once an automation slug became
 * the path it lives at); this historical migration is re-seedable, so the
 * constant is edited in place to the CURRENT slugs rather than pinned to any of
 * the old names.
 */
export const INTEGRATION_TO_EMAIL_APP: Readonly<Record<string, string>> = {
  outlook: 'outlook/sync-emails',
  gmail: 'gmail/sync-emails',
  imap_smtp: 'imap-smtp/sync-emails',
};

/**
 * Recorded as `installedBy` on every install row this migration creates, so
 * `down` can target exactly its own rows.
 *
 * FROZEN at the original (pre-re-home) folder name: the marker is persisted
 * in rows on deployments that already ran this migration — renaming it would
 * orphan them for `down`.
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
    retired.automations.install_mutations.getAutomationInstallationInternal,
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
    `[${MIGRATION_ID}] ${org.slug}: ${failures.length} email app ${verb}(s) failed ` +
      `(${failures.join(', ')}) — fix the cause and re-run this version ` +
      `(down+up); succeeded/already-handled apps are skipped on the next pass.`,
  );
}

export const migration = defineNodeMigration({
  title: 'Install the email inbox apps for orgs with active email credentials',
  description:
    'For each org with an ACTIVE integrationCredentials row for outlook, ' +
    'gmail, or imap_smtp, installs the matching email inbox app ' +
    '(outlook/sync-emails / gmail/sync-emails / imap-smtp/sync-emails) via installAutomationInternal with ' +
    "the installedBy marker 'migration:v0_2_90_install_email_apps', so the " +
    'org keeps an inbox UI when the built-in Conversations pages are ' +
    'removed. Already-installed apps are skipped; a failed install is logged ' +
    'and skipped. down uninstalls only the rows carrying the marker.',
  destructive: false,
  snapshot: 'none',
  formerIds: ['0.2.90/03_install_email_apps'],
  subjects: {
    tables: ['integrationCredentials', 'automationInstallations'],
  },

  async up(ctx, org) {
    const credentials: CredentialLike[] = await ctx.runQuery(
      retired.integrations.credential_queries.listInternal,
      { organizationId: org.id },
    );
    const failures: string[] = [];
    for (const appSlug of emailAppInstallTargets(credentials)) {
      // Already installed (by anyone) — never re-install or overwrite the
      // existing row's installedBy (idempotent).
      if (await installedRow(ctx, org.id, appSlug)) continue;
      try {
        await ctx.runAction(
          retired.automations.install_actions.installAutomationInternal,
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
          `[${MIGRATION_ID}] ${org.slug}: installing "${appSlug}" failed:`,
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
          retired.automations.install_actions.uninstallAutomationInternal,
          { organizationId: org.id, automationSlug: appSlug },
        );
      } catch (err) {
        console.warn(
          `[${MIGRATION_ID}] ${org.slug}: uninstalling "${appSlug}" failed:`,
          err,
        );
        failures.push(appSlug);
      }
    }
    warnSummary(org, 'uninstall', failures);
  },
});
