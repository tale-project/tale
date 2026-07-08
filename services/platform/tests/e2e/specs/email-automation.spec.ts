import { execFileSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import {
  automationName,
  gotoAutomationsHubAllTab,
  installWizardDialog,
  uninstallOrgAutomationIfInstalled,
  walkInstallWizard,
} from '../helpers/automations';
import { TIMEOUT } from '../helpers/env';
import { expect, test } from '../helpers/fixtures';
import { t } from '../helpers/i18n';

/**
 * Email inbox apps — the surface that replaced the standalone conversations
 * inbox. Conversations render exclusively through the three org-scoped email
 * apps (`reply-outlook-emails` / `reply-gmail-emails` / `reply-imap-emails`); the legacy
 * `/dashboard/$id/conversations*` redirect stubs have since been removed
 * entirely (bookmarks to them now 404 like any other dead route).
 *
 * The inbox UI is the PLATFORM builtin view (`builtinViews: [{ id: 'inbox' }]`
 * in each manifest, rendered by `app/features/automations/builtin-views/`), so
 * its copy (tabs, empty states, placeholders) lives in platform i18n under
 * `automations.inbox.*` — resolved here via `t` like all platform chrome. The
 * automation display names stay bundle manifest literals, read from the
 * fixture bundles the hermetic stack scaffolds into every worker org.
 */

const OUTLOOK_SLUG = 'reply-outlook-emails';
const EMAIL_AUTOMATION_SLUGS = [
  OUTLOOK_SLUG,
  'reply-gmail-emails',
  'reply-imap-emails',
] as const;

const dirname = path.dirname(fileURLToPath(import.meta.url));
const PLATFORM_DIR = path.join(dirname, '..', '..', '..');

/**
 * Seed one inbound conversation for the worker org, attributed to the Outlook
 * integration so the reply-outlook-emails app lists it. There is no UI path and no
 * public mutation that creates conversations (ingest is inbound email, which
 * the mock stack cannot deliver), so this drives the internal mutation through
 * the Convex CLI against the local self-hosted backend — the same pattern the
 * manual guide (`tests/manual/conversations.md`) documents.
 */
// verify-live: `bunx convex run` must resolve the e2e stack's local
// deployment from services/platform (it does for the manual-QA stack; the
// e2e webServer boots the same `scripts/dev.ts` stack).
function seedOutlookConversation(
  organizationId: string,
  subject: string,
): void {
  execFileSync(
    'bunx',
    [
      'convex',
      'run',
      'conversations/internal_mutations:createConversationWithMessage',
      JSON.stringify({
        organizationId,
        subject,
        status: 'open',
        priority: 'high',
        channel: 'email',
        direction: 'inbound',
        type: 'service-request',
        integrationName: 'outlook',
        initialMessage: {
          sender: 'qa@example.com',
          content: 'Hello from the e2e seed',
          isCustomer: true,
          status: 'delivered',
        },
      }),
    ],
    { cwd: PLATFORM_DIR, stdio: 'pipe', timeout: TIMEOUT.EXECUTION },
  );
}

test.describe('email inbox apps: hub catalog', () => {
  test('the apps hub lists the three email inbox apps', async ({
    page,
    org,
  }) => {
    // The All tab shows the full catalog union (the hub lands on Installed,
    // which is empty for a fresh org).
    await gotoAutomationsHubAllTab(page, org.organizationId);
    await expect(
      page
        .getByRole('heading', { name: t('automations.title'), level: 1 })
        .filter({ visible: true })
        .first(),
    ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

    // One card per email integration: Reply to Outlook emails / Reply to
    // Gmail emails / Reply to emails via SMTP/IMAP. The card title is the
    // manifest name (read from the fixture bundle, so a rename flows
    // through); install state is deliberately NOT asserted here — sibling
    // tests install/uninstall.
    for (const slug of EMAIL_AUTOMATION_SLUGS) {
      await expect(
        page.getByText(automationName(slug), { exact: true }),
      ).toBeVisible({
        timeout: TIMEOUT.VISIBLE,
      });
    }
  });
});

test.describe('email inbox apps: install, inbox', () => {
  test('installing Outlook renders the four-tab inbox', async ({
    page,
    org,
  }) => {
    const { organizationId } = org;
    const outlookName = automationName(OUTLOOK_SLUG);

    // Converge on "not installed" first so retries against this worker's org
    // start clean (a failed earlier attempt may have left the app installed).
    await uninstallOrgAutomationIfInstalled(page, organizationId, outlookName);

    // Install from the pre-install details page (the app's own URL — hub
    // cards are static containers whose Install button installs in place, so
    // the details assertions navigate directly). Outlook is an org-scoped app
    // requiring the (unconnected) outlook integration, so the details page's
    // Install button opens the setup wizard.
    await page.goto(`/dashboard/${organizationId}/automations/${OUTLOOK_SLUG}`);
    await expect(
      page.getByText(t('automations.details.scopeOrg')).first(),
    ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
    await expect(
      page.getByText(t('automations.details.requiresTitle')),
    ).toBeVisible();
    await page
      .getByRole('button', { name: t('automations.install.install') })
      .click();
    const wizard = installWizardDialog(page, outlookName);
    await expect(wizard).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    // verify-live: expected steps Install → connect-outlook (skipped) → Done.
    await walkInstallWizard(wizard);

    // The installed app page renders the platform Inbox builtin view (title
    // from platform i18n): the four status tabs, opening on Open, with the
    // thread pane awaiting a selection.
    await page.goto(`/dashboard/${organizationId}/automations/${OUTLOOK_SLUG}`);
    await expect(
      page.getByText(t('automations.inbox.title')).first(),
    ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
    const openTab = page.getByRole('tab', {
      name: t('automations.inbox.tab.open'),
    });
    await expect(openTab).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
    await expect(openTab).toHaveAttribute('aria-selected', 'true');
    for (const key of [
      'automations.inbox.tab.closed',
      'automations.inbox.tab.spam',
      'automations.inbox.tab.archived',
    ]) {
      await expect(page.getByRole('tab', { name: t(key) })).toBeVisible({
        timeout: TIMEOUT.VISIBLE,
      });
    }
    // The outlook connect step was skipped, so the readiness checklist asks
    // to finish setup. verify-live: no other spec connects outlook.
    await expect(
      page.getByText(t('automations.readiness.title')).first(),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    // Two visible tabpanels since the page-level view/Overview tab strip
    // landed (the Inbox view panel wraps the inner status panel) — the
    // innermost (last) one is the status tab's panel.
    await expect(
      page
        .getByRole('tabpanel')
        .last()
        .getByText(t('automations.inbox.thread.placeholder')),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    // Retried runs may have seeded open conversations already, so the
    // deterministic empty-state check targets Spam — seeding never fills it.
    await page
      .getByRole('tab', { name: t('automations.inbox.tab.spam') })
      .click();
    await expect(
      page
        .getByRole('tabpanel')
        .last()
        .getByText(t('automations.inbox.empty.spam')),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await openTab.click();

    // A seeded conversation appears in the Open list. Rows are real buttons
    // whose aria-label is the conversation subject (fallback: sender); the
    // visible row also renders a sender heading (the customer's name, when
    // the conversation has one — this seed has none, so the subject leads)
    // and a cleaned one-line preview of the latest message. Selecting a row
    // fills the thread pane and reveals the composer, which only the Open
    // tab carries.
    const subject = `E2E seeded conversation ${Date.now()}`;
    seedOutlookConversation(organizationId, subject);
    await page.reload();
    const row = page.getByRole('button', { name: subject });
    await expect(row).toBeVisible({ timeout: TIMEOUT.PERSIST });
    // The row surfaces the seeded body as its preview line…
    await expect(row).toContainText('Hello from the e2e seed');
    await row.click();
    // …so once selected the body renders in the thread pane AND as row
    // previews (retried runs seed several rows with the same body, so the
    // match count is not deterministic — assert on the first visible one;
    // the composer assertions below prove the selection actually landed).
    await expect(
      page
        .getByText('Hello from the e2e seed')
        .filter({ visible: true })
        .first(),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    // The composer is a Crepe/ProseMirror contenteditable — it exposes
    // `role="textbox"` + `aria-label` (the placeholder copy), NOT a real
    // `placeholder` attribute, so `getByPlaceholder` can't match it. Locate it
    // by role + accessible name, the same affordance the component test asserts.
    await expect(
      page.getByRole('textbox', {
        name: t('automations.inbox.composer.placeholder'),
      }),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await expect(
      page.getByRole('button', { name: t('automations.composer.send') }),
    ).toBeVisible();

    // Cleanup — uninstall (the seeded conversation data survives uninstall by
    // design; nothing asserts an empty Open tab).
    await uninstallOrgAutomationIfInstalled(page, organizationId, outlookName);
  });
});
