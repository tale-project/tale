import { type Page } from '@playwright/test';

import { TIMEOUT } from '../helpers/env';
import { test, expect } from '../helpers/fixtures';
import { reloadAndSettle } from '../helpers/forms';
import { t } from '../helpers/i18n';

/**
 * Core (non-governance) settings flows: the account display-name round-trip
 * and the AI-providers page (shipped connector catalog + the add-credential
 * affordance). The account write captures and restores its original value so
 * the worker's isolated org is left as it was found.
 */

// A shipped provider connector (`configs/platform/system/providers/*.yml`) —
// always present, independent of org data. `displayName` renders as the
// connector section's heading. A config literal, kept local (not via `t()`).
const SHIPPED_PROVIDER_DISPLAY_NAME = 'Anthropic';

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

    // Commit gate: wait for the success toast BEFORE reloading. The reload
    // navigation aborts any in-flight save request, so reloading before the
    // mutation has committed would race it (the reloaded field shows the
    // original value). The toast is the commit signal — we wait on it, then
    // reload and assert the persisted FIELD (not the toast) for persistence.
    await expect(
      page.getByText(t('toast.success.profileUpdated.title')).first(),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await reloadAndSettle(page, nameField);
    await expect(nameField).toHaveValue(newName, { timeout: TIMEOUT.PERSIST });

    // Unconditionally restore the original value (keeps re-runs deterministic).
    await nameField.fill(originalName);
    const restoreSave = visibleSaveButton(page);
    await expect(restoreSave).toBeEnabled({ timeout: TIMEOUT.VISIBLE });
    await restoreSave.click();
    await expect(
      page.getByText(t('toast.success.profileUpdated.title')).first(),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await reloadAndSettle(page, nameField);
    await expect(nameField).toHaveValue(originalName, {
      timeout: TIMEOUT.PERSIST,
    });
  });

  test('providers: lists the shipped connectors and offers the add-credential dialog', async ({
    page,
    org,
  }) => {
    const { organizationId } = org;
    // The per-provider detail route was retired with the AI-backend rewrite —
    // the index now carries every connector as its own section.
    await page.goto(settingsUrl(organizationId, 'providers'));

    // The page shell: the catalog-refresh section renders first, then one
    // section per shipped connector (`configs/platform/system/providers/`).
    // The catalog list comes from a Convex action that fetches live model
    // catalogs per connector, so first paint can take a moment on a cold
    // backend.
    await expect(
      page.getByRole('heading', {
        name: t('settings.providers.catalogs.title'),
        level: 2,
      }),
    ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

    const connectorHeading = page.getByRole('heading', {
      name: SHIPPED_PROVIDER_DISPLAY_NAME,
      level: 2,
    });
    await expect(connectorHeading).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    // Each connector section offers "Add credential"; open the dialog for the
    // anchor connector (scoped to its section — the button label repeats per
    // connector) and dismiss it again. Read-only: no credential is created.
    await page
      .locator('section')
      .filter({ has: connectorHeading })
      .getByRole('button', {
        name: t('settings.providers.connector.addCredential'),
      })
      .click();

    const addDialog = page.getByRole('dialog', {
      name: t('settings.providers.dialog.addTitle'),
    });
    await expect(addDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await page.keyboard.press('Escape');
    await expect(addDialog).not.toBeVisible({ timeout: TIMEOUT.VISIBLE });
  });
});
