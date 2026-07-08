import type { MigrationMeta } from '../../../framework/types';

/**
 * 0.2.90 / 03 — auto-install the email inbox apps for orgs already using the
 * email integrations.
 *
 * The dashboard's built-in Conversations pages are replaced by the
 * reply-outlook-emails / reply-gmail-emails / reply-imap-emails apps, so an org that has a
 * connected email integration would lose its inbox UI on upgrade unless the
 * matching app is installed. Per org: for every ACTIVE `integrationCredentials`
 * row (`isActive && status === 'active'`, the canonical availability contract)
 * whose slug is outlook / gmail / imap_smtp, install the mapped app via
 * `installAutomationInternal` (the developer-settings-gated public path cannot run
 * unauthenticated inside a migration). The bundles ship no workflows, agents,
 * or required config, so the install needs no wizard input. Orgs where the app
 * is already installed are skipped (idempotent), and a single failed install
 * (e.g. the bundle missing from the deployment's built-in catalog) is logged
 * and skipped rather than aborting the fleet run.
 *
 * The install rows are stamped `installedBy:
 * 'migration:v0_2_90_install_email_apps'`, so `down` uninstalls EXACTLY the
 * installs this migration made (via the shared uninstall path) and never
 * touches a human-installed app. Uninstall never touches the `conversations*`
 * tables — it removes only the app shell, install row, and app-scoped
 * env/secrets (none for these bundles).
 */
export const meta: MigrationMeta = {
  id: '0.2.90/03_install_email_apps',
  semver: '0.2.90',
  numericId: 3,
  slug: 'install_email_apps',
  title: 'Install the email inbox apps for orgs with active email credentials',
  description:
    'For each org with an ACTIVE integrationCredentials row for outlook, ' +
    'gmail, or imap_smtp, installs the matching email inbox app ' +
    '(reply-outlook-emails / reply-gmail-emails / reply-imap-emails) via installAutomationInternal with ' +
    "the installedBy marker 'migration:v0_2_90_install_email_apps', so the " +
    'org keeps an inbox UI when the built-in Conversations pages are ' +
    'removed. Already-installed apps are skipped; a failed install is logged ' +
    'and skipped. down uninstalls only the rows carrying the marker.',
  kind: 'node',
  reversible: true,
  destructive: false,
  snapshot: 'none',
};
