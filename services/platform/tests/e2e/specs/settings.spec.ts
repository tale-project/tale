import { type Page } from '@playwright/test';

import { TIMEOUT } from '../helpers/env';
import { test, expect } from '../helpers/fixtures';
import { reloadAndSettle } from '../helpers/forms';
import { t } from '../helpers/i18n';

/**
 * Core (non-governance) settings flows: the account display-name round-trip and
 * the two credential tables — AI providers and connectors — where a fresh org
 * shows the empty state, "Add credential" opens the catalog picker, search
 * narrows it, and picking a vendor advances to the setup step. Only the
 * account test writes; it captures and restores its original value so the
 * worker's isolated org is left as it was found.
 */

// Anchors that ship with the platform (`configs/platform/system/{providers,
// connectors}/*/`) — always present, independent of org data. Each appears as
// a catalog-picker row. Config literals, kept local (not via `t()`).
const SHIPPED_PROVIDER_DISPLAY_NAME = 'Anthropic';
const SHIPPED_CONNECTOR_DISPLAY_NAME = 'GitHub';

function settingsUrl(organizationId: string, path: string): string {
  return `/dashboard/${organizationId}/settings/${path}`;
}

// The unified Save/Discard cluster renders twice (a desktop `hidden md:flex`
// slot + a `md:hidden` mobile bar), so the Save button matches two DOM nodes;
// scope to the one visible on the Desktop Chrome viewport.
function visibleSaveButton(page: Page) {
  return page
    .getByRole('button', { name: t('common.actions.save'), exact: true })
    .filter({ visible: true });
}

test.describe('core settings', () => {
  test('account: edits, persists, and restores the display name', async ({
    page,
    org,
  }) => {
    const { organizationId } = org;
    await page.goto(settingsUrl(organizationId, 'account'));

    // The Profile section heading is the page's first content (no page title).
    await expect(
      page.getByRole('heading', {
        name: t('settings.account.profile.title'),
        level: 2,
      }),
    ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

    // Target the input by role: SettingsRow names a wrapper div with the same
    // text, so getByLabel would resolve to both the div and the control.
    const nameField = page.getByRole('textbox', {
      name: t('settings.account.profile.name'),
    });
    await expect(nameField).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await expect(nameField).toBeEnabled();

    const originalName = await nameField.inputValue();
    const newName = `E2E Owner ${Date.now().toString(36)}`;
    expect(newName).not.toBe(originalName);

    // Editing makes the form dirty, which enables the Save cluster.
    await nameField.fill(newName);
    const save = visibleSaveButton(page);
    await expect(save).toBeEnabled({ timeout: TIMEOUT.VISIBLE });
    await save.click();

    // Commit gate: wait for the Save cluster to settle BEFORE reloading. The
    // reload navigation aborts any in-flight save request, so reloading before
    // the mutation has committed would race it (the reloaded field shows the
    // original value). The page toasts nothing on success — the cluster flashes
    // "Saved" and settles back to a DISABLED "Save" once the form is clean
    // again, which is the commit signal. Persistence is asserted off the
    // reloaded FIELD below.
    await expect(save).toBeDisabled({ timeout: TIMEOUT.VISIBLE });
    await reloadAndSettle(page, nameField);
    await expect(nameField).toHaveValue(newName, { timeout: TIMEOUT.PERSIST });

    // Unconditionally restore the original value (keeps re-runs deterministic).
    await nameField.fill(originalName);
    const restoreSave = visibleSaveButton(page);
    await expect(restoreSave).toBeEnabled({ timeout: TIMEOUT.VISIBLE });
    await restoreSave.click();
    await expect(restoreSave).toBeDisabled({ timeout: TIMEOUT.VISIBLE });
    await reloadAndSettle(page, nameField);
    await expect(nameField).toHaveValue(originalName, {
      timeout: TIMEOUT.PERSIST,
    });
  });

  test('providers: empty credentials surface and the add-catalog picker', async ({
    page,
    org,
  }) => {
    const { organizationId } = org;
    await page.goto(settingsUrl(organizationId, 'providers'));

    // A fresh org has no credentials — the table is the empty state, and the
    // shipped provider catalog lives behind "Add credential".
    await expect(
      page.getByRole('heading', { name: t('emptyStates.providers.title') }),
    ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

    await page
      .getByRole('button', { name: t('settings.credentials.addCredential') })
      .click();
    const dialog = page.getByRole('dialog', {
      name: t('settings.credentials.catalog.title'),
    });
    await expect(dialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    // The catalog action may still be fetching live model catalogs (OpenRouter,
    // the Vercel gateway). With no egress those fetches time out first, so the
    // shipped Anthropic row needs the execution budget.
    const anthropic = dialog.getByRole('button', {
      name: new RegExp(SHIPPED_PROVIDER_DISPLAY_NAME),
    });
    await expect(anthropic).toBeVisible({ timeout: TIMEOUT.EXECUTION });
    // The remainder group carries NO heading — `vendor-picker-pane` passes a
    // null label for it, so "In use" is the only section header in the picker.
    await expect(
      dialog.getByRole('heading', { level: 3, name: /available/i }),
    ).toHaveCount(0);

    // Search narrows the picker client-side. SearchInput ships `readOnly` until
    // focused — an anti-autofill trick — so focus, then type, rather than fill.
    const search = dialog.getByPlaceholder(
      t('settings.providers.searchPlaceholder'),
    );
    await search.click();
    await search.pressSequentially('zzzz-no-provider-matches-this');
    await expect(
      dialog.getByText(t('settings.credentials.catalog.noMatches')),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await search.clear();
    await expect(anthropic).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    // Picking a vendor advances to the setup step; dismiss without creating.
    await anthropic.click();
    await expect(
      dialog.getByRole('textbox', { name: t('settings.credentials.name') }),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible({ timeout: TIMEOUT.VISIBLE });
  });

  test('connectors: empty credentials surface and the add-catalog picker', async ({
    page,
    org,
  }) => {
    const { organizationId } = org;
    await page.goto(settingsUrl(organizationId, 'connectors'));

    await expect(
      page.getByRole('heading', { name: t('emptyStates.connectors.title') }),
    ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

    await page
      .getByRole('button', { name: t('settings.credentials.addCredential') })
      .click();
    const dialog = page.getByRole('dialog', {
      name: t('settings.credentials.catalog.title'),
    });
    await expect(dialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    // Connector catalogs are on-disk files — no egress — so the shipped GitHub
    // row resolves on the element budget.
    const github = dialog.getByRole('button', {
      name: new RegExp(SHIPPED_CONNECTOR_DISPLAY_NAME),
    });
    await expect(github).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
    // The remainder group carries NO heading — `vendor-picker-pane` passes a
    // null label for it, so "In use" is the only section header in the picker.
    await expect(
      dialog.getByRole('heading', { level: 3, name: /available/i }),
    ).toHaveCount(0);

    const search = dialog.getByPlaceholder(
      t('settings.connectors.searchPlaceholder'),
    );
    await search.click();
    await search.pressSequentially('zzzz-no-connector-matches-this');
    await expect(
      dialog.getByText(t('settings.credentials.catalog.noMatches')),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await search.clear();
    await expect(github).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    await github.click();
    await expect(
      dialog.getByRole('textbox', { name: t('settings.credentials.name') }),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await page.keyboard.press('Escape');
    await expect(dialog).not.toBeVisible({ timeout: TIMEOUT.VISIBLE });
  });
});
