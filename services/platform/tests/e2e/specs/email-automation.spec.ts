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
 * Email automations + the org-level Inbox. Conversations render on the
 * standalone `/dashboard/$id/conversations/$status` surface (titled "Inbox");
 * the three org-scoped email automations (`reply-outlook-emails` /
 * `reply-gmail-emails` / `reply-imap-emails`) are its GATE: their manifests
 * declare `builtinViews: [{ id: 'inbox' }]`, and the sidebar entry, mobile
 * tab, and route guard all show the Inbox only while at least one of them is
 * INSTALLED (`useInboxAvailability` — seeded org-dir files alone don't count).
 *
 * Inbox copy (title, status tabs, empty states, filters) is platform i18n
 * under `conversations.*` — resolved here via `t` like all platform chrome.
 * Automation display names stay bundle manifest literals, read from the
 * fixture bundles the hermetic stack scaffolds into every worker org.
 */

const OUTLOOK_SLUG = 'reply-outlook-emails';
const EMAIL_AUTOMATION_SLUGS = [
  OUTLOOK_SLUG,
  'reply-gmail-emails',
  'reply-imap-emails',
] as const;

const STATUSES = ['open', 'closed', 'spam', 'archived'] as const;

const dirname = path.dirname(fileURLToPath(import.meta.url));
const PLATFORM_DIR = path.join(dirname, '..', '..', '..');

/**
 * Seed one inbound conversation for the worker org, attributed to the Outlook
 * integration so the channel filter can single it out. There is no UI path
 * and no public mutation that creates conversations (ingest is inbound email,
 * which the mock stack cannot deliver), so this drives the internal mutation
 * through the Convex CLI against the local self-hosted backend — the same
 * pattern the manual guide (`tests/manual/conversations.md`) documents.
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

/** The sidebar rail's Inbox link (icon-only; the label is its aria-label).
 *  The mobile bottom tab renders a button (not a link) and is display-none on
 *  the desktop viewport, so this locator can't alias it. */
function inboxNavLink(page: import('@playwright/test').Page) {
  return page.getByRole('link', {
    name: t('conversations.title'),
    exact: true,
  });
}

test.describe('email automations: hub catalog', () => {
  test('the automations hub lists the three email automations', async ({
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

test.describe('email automations: Inbox gating and flow', () => {
  test('gates the Inbox on an installed email automation and lists seeded mail', async ({
    page,
    org,
  }) => {
    const { organizationId } = org;
    const outlookName = automationName(OUTLOOK_SLUG);

    // Converge on "no email automation installed" first so retries against
    // this worker's org start clean — the Inbox gate is "ANY of the three",
    // so all three must be down before the hidden-state assertions hold.
    for (const slug of EMAIL_AUTOMATION_SLUGS) {
      await uninstallOrgAutomationIfInstalled(
        page,
        organizationId,
        automationName(slug),
      );
    }

    // With no email automation installed the sidebar has NO Inbox entry.
    // Anchor on a sibling rail link first — the entry is also hidden while
    // the availability queries load, so a bare count-0 could pass early.
    await expect(
      page.getByRole('link', { name: t('navigation.automations') }),
    ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
    await expect(inboxNavLink(page)).toHaveCount(0);

    // A deep link must not crash: the route guard renders a friendly pointer
    // to the Automations catalog instead of the inbox. (The bare route still
    // redirects to /conversations/open first.)
    await page.goto(`/dashboard/${organizationId}/conversations`);
    await page.waitForURL(/\/conversations\/open(?:[/?#]|$)/, {
      timeout: TIMEOUT.FIRST_PAINT,
    });
    await expect(
      page.getByText(t('conversations.activate.noAutomationTitle')),
    ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
    await expect(
      page.getByRole('link', {
        name: t('conversations.activate.browseAutomations'),
      }),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    // Install Outlook from its pre-install details page. Outlook is an
    // org-scoped automation requiring the (unconnected) outlook integration,
    // so the Install button opens the setup wizard.
    await page.goto(`/dashboard/${organizationId}/automations/${OUTLOOK_SLUG}`);
    await expect(
      page.getByText(t('automations.details.scopeOrg')).first(),
    ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
    await page
      .getByRole('button', { name: t('automations.install.install') })
      .click();
    const wizard = installWizardDialog(page, outlookName);
    await expect(wizard).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    // verify-live: expected steps Install → connect-outlook (skipped) → Done.
    await walkInstallWizard(wizard);

    // The installed automation page is workflow settings only — the outlook
    // connect step was skipped, so the readiness checklist asks to finish
    // setup, and its tab strip (a navigation landmark of links) carries NO
    // Inbox tab anymore (the Inbox is the org-level page).
    await page.goto(`/dashboard/${organizationId}/automations/${OUTLOOK_SLUG}`);
    await expect(
      page.getByText(t('automations.readiness.title')).first(),
    ).toBeVisible({ timeout: TIMEOUT.PERSIST });
    const automationTabStrip = page.getByRole('navigation', {
      name: t('automations.tabs.ariaLabel'),
    });
    await expect(
      automationTabStrip.getByRole('link', {
        name: t('automations.tabs.configuration'),
        exact: true,
      }),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await expect(
      automationTabStrip.getByRole('link', {
        name: t('conversations.title'),
        exact: true,
      }),
    ).toHaveCount(0);

    // The sidebar Inbox entry appears once the install row lands, and leads
    // to the org-level inbox.
    await expect(inboxNavLink(page)).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await inboxNavLink(page).click();
    await page.waitForURL(/\/conversations\/open(?:[/?#]|$)/, {
      timeout: TIMEOUT.NAV,
    });

    // Page chrome: the "Inbox" title (scoped to the visible <main> region —
    // the adaptive header dual-renders it for mobile) and the four status
    // tabs, which render as navigation links.
    await expect(
      page
        .getByRole('main')
        .getByRole('heading', { name: t('conversations.title'), level: 1 }),
    ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
    for (const status of STATUSES) {
      await expect(
        page.getByRole('link', {
          name: t(`conversations.status.${status}`),
          exact: true,
        }),
      ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    }

    // A seeded conversation appears in the Open list. Rows are real buttons
    // whose accessible name is the conversation subject (fallback: customer
    // name); the visible content (sender heading + one-line preview of the
    // latest message) renders in the button's parent container.
    const subject = `E2E seeded conversation ${Date.now()}`;
    seedOutlookConversation(organizationId, subject);
    await page.reload();
    const row = page.getByRole('button', { name: subject });
    await expect(row).toBeVisible({ timeout: TIMEOUT.PERSIST });
    await expect(row.locator('..')).toContainText('Hello from the e2e seed');

    // Selecting the row fills the reading pane (the seeded body renders there
    // AND as row previews — retried runs may seed several rows with the same
    // body, so assert the first visible match) and reveals the composer's
    // Send action, which only open conversations carry.
    await row.click();
    await expect(
      page
        .getByText('Hello from the e2e seed')
        .filter({ visible: true })
        .first(),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await expect(
      page.getByRole('button', { name: t('conversations.editor.send') }),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    // Channel filter: with Outlook installed the toolbar offers the channel
    // dropdown (label = the integration's display title). Filtering by the
    // Outlook channel rides the `?channel=` search param, keeps the seeded
    // outlook row, and "All channels" clears the param again.
    const channelTrigger = page.getByRole('button', {
      name: t('conversations.filter.channel'),
      exact: true,
    });
    await expect(channelTrigger).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await channelTrigger.click();
    await expect(
      page.getByRole('menuitemradio', {
        name: t('conversations.filter.allChannels'),
      }),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await page.getByRole('menuitemradio', { name: /outlook/i }).click();
    await page.waitForURL(/[?&]channel=outlook(?:[&#]|$)/, {
      timeout: TIMEOUT.NAV,
    });
    await expect(page.getByRole('button', { name: subject })).toBeVisible({
      timeout: TIMEOUT.VISIBLE,
    });
    await channelTrigger.click();
    await page
      .getByRole('menuitemradio', {
        name: t('conversations.filter.allChannels'),
      })
      .click();
    await page.waitForURL((url) => !url.searchParams.has('channel'), {
      timeout: TIMEOUT.NAV,
    });

    // Cleanup — uninstall (the seeded conversation data survives uninstall by
    // design; the Inbox nav entry hides again with the last email automation).
    await uninstallOrgAutomationIfInstalled(page, organizationId, outlookName);
    await expect(inboxNavLink(page)).toHaveCount(0);
  });
});
