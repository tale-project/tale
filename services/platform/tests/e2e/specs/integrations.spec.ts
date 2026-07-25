import type { Page } from '@playwright/test';

import { isMockLlmMode, TIMEOUT } from '../helpers/env';
import { expect, test } from '../helpers/fixtures';
import { t } from '../helpers/i18n';

/**
 * Integration connector e2e — the real connector → sandbox → URL-rewrite →
 * mock-gateway path, end to end and offline.
 *
 * Connecting an API-key/token integration runs the connector's `testConnection`
 * in the in-process Convex sandbox; its outbound HTTP is redirected by the
 * sandbox rewrite (`TALE_MOCK_INTEGRATIONS_BASE`) to the `lib/mocks` gateway,
 * which serves the spec-backed response. So a successful "Connect" proves the
 * shipped connector talks to its API exactly as the OpenAPI spec describes.
 *
 * Requires the hermetic stack (gateway on :4141 + the rewrite env), so the whole
 * file is mock-mode only. The integration catalog is scaffolded per-org from
 * `TALE_CONFIG_DIR/default/integrations/`, which in the e2e fixtures is a symlink
 * to the real shipped `builtin-configs/integrations/` (no duplicated connectors)
 * — so the actual shipped GitHub/Tavily connectors run here.
 */
test.skip(
  !isMockLlmMode(),
  'integration mocks require the hermetic gateway + rewrite env',
);

// Land on the "All integrations" catalog tab — the page defaults to the
// "Connected" tab (`tab ?? 'connected'`), which is empty for a fresh org, so
// the connector cards only render under `?tab=all`.
const integrationsUrl = (organizationId: string) =>
  `/dashboard/${organizationId}/settings/integrations?tab=all`;

// Catalog titles come from connector config (config.json `title`), not the i18n
// catalog — match the literal the card renders, like the seed.ts constants. The
// shared CatalogCard makes the whole card a <button> whose accessible name is
// the title (`ariaLabel`), so target the button by that exact name (`exact`
// keeps the match off the "Connect {title}" action button in the panel).
function integrationCard(page: Page, title: string) {
  return page.getByRole('button', { name: title, exact: true });
}

function connectButton(page: Page) {
  // The settings panel's primary action is a bare "Connect" — the sheet is
  // already titled with the integration name, so the button doesn't repeat it.
  return page
    .getByRole('button', {
      name: t('settings.integrations.panel.connect'),
      exact: true,
    })
    .filter({ visible: true });
}

function disconnectButton(page: Page) {
  return page
    .getByRole('button', {
      name: t('settings.integrations.disconnect'),
      exact: true,
    })
    .filter({ visible: true });
}

/** Disconnect from the open panel (details mode) and confirm the dialog. */
async function disconnectOpenPanel(page: Page) {
  await disconnectButton(page).click();
  const dialog = page.getByRole('dialog', {
    name: t('settings.integrations.panel.disconnectConfirmTitle'),
  });
  await expect(dialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await dialog
    .getByRole('button', {
      name: t('settings.integrations.disconnect'),
      exact: true,
    })
    .click();
  await expect(dialog).toBeHidden({ timeout: TIMEOUT.VISIBLE });
}

/**
 * Connect an API-key/token integration through the settings UI and assert the
 * connector's `testConnection` succeeded against the mock gateway. Idempotent:
 * disconnects first if a prior (retried) run left it connected, and cleans up
 * after itself so the worker org is left as found.
 */
async function connectAndVerify(
  page: Page,
  organizationId: string,
  opts: { title: string; secretBinding: string; token: string },
) {
  await page.goto(integrationsUrl(organizationId));
  const card = integrationCard(page, opts.title);
  await expect(card).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  await card.click();

  // Retry safety: a prior attempt may have left it connected (details mode).
  if (
    await disconnectButton(page)
      .isVisible()
      .catch(() => false)
  ) {
    await disconnectOpenPanel(page);
    await card.click();
  }

  // Single secret field; its id is `manage-credential-<binding>` and its label
  // is a startCase of the binding (not an i18n key), so target the stable id.
  const field = page.locator(`#manage-credential-${opts.secretBinding}`);
  await expect(field).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await field.fill(opts.token);

  const connect = connectButton(page);
  await expect(connect).toBeEnabled({ timeout: TIMEOUT.VISIBLE });
  await connect.click();

  // testConnection runs the connector in the sandbox → outbound HTTP → gateway.
  await expect(
    page.getByText(t('settings.integrations.connectionSuccessful')).first(),
  ).toBeVisible({ timeout: TIMEOUT.REPLY });

  // Cleanup: disconnect so re-runs start clean.
  await disconnectOpenPanel(page);
}

test('GitHub: connecting validates the token against the mock gateway', async ({
  page,
  org,
}) => {
  // GitHub `testConnection` issues GET https://api.github.com/user, redirected
  // to /mock/github/user — the connector reads `login` from the 200 body.
  await connectAndVerify(page, org.organizationId, {
    title: 'GitHub',
    secretBinding: 'accessToken',
    token: 'ghp_e2e_mock_token_000000000000000000',
  });
});

test('Tavily: connecting validates the key against the mock gateway', async ({
  page,
  org,
}) => {
  // Tavily `testConnection` issues POST https://api.tavily.com/search,
  // redirected to /mock/tavily/search.
  await connectAndVerify(page, org.organizationId, {
    title: 'Tavily',
    secretBinding: 'apiKey',
    token: 'tvly-e2e-mock-key-000000000000000000',
  });
});
