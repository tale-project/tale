import { type Page } from '@playwright/test';

import { TIMEOUT } from '../helpers/env';
import { test, expect } from '../helpers/fixtures';
import { reloadAndSettle } from '../helpers/forms';
import { t } from '../helpers/i18n';

/**
 * Core (non-governance) settings flows: the account display-name round-trip and
 * the provider General-details write-path. Each write captures and restores its
 * original value so the worker's isolated org is left as it was found.
 */

// Seeded fixture provider (`fixtures/config/default/providers/e2e-mock.json`):
// `name` (the detail URL segment) is the filename basename; `displayName` is
// the table/drawer label. Fixture literals, kept local (not via `t()`).
const PROVIDER_SLUG = 'e2e-mock';
const PROVIDER_DISPLAY_NAME = 'E2E Mock Provider';

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

    const nameField = page.getByLabel(t('settings.account.profile.name'));
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
      page.getByText(t('toast.success.profileUpdated')).first(),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await reloadAndSettle(page, nameField);
    await expect(nameField).toHaveValue(newName, { timeout: TIMEOUT.PERSIST });

    // Unconditionally restore the original value (keeps re-runs deterministic).
    await nameField.fill(originalName);
    const restoreSave = visibleSaveButton(page);
    await expect(restoreSave).toBeEnabled({ timeout: TIMEOUT.VISIBLE });
    await restoreSave.click();
    await expect(
      page.getByText(t('toast.success.profileUpdated')).first(),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await reloadAndSettle(page, nameField);
    await expect(nameField).toHaveValue(originalName, {
      timeout: TIMEOUT.PERSIST,
    });
  });

  test('providers: edits the General display name, persists, and restores', async ({
    page,
    org,
  }) => {
    const { organizationId } = org;
    await page.goto(settingsUrl(organizationId, `providers/${PROVIDER_SLUG}`));

    // The drawer auto-opens on the deep-link; its General section is the anchor.
    const generalHeading = page.getByRole('heading', {
      name: t('settings.providers.general'),
      level: 3,
    });
    await expect(generalHeading).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

    // The drawer renders SEVERAL ghost "Edit" buttons that share the same
    // `providers.editGeneral` ("Edit") label — the General section AND the
    // Provider-options section both use it — so a bare role+name lookup is
    // ambiguous (and the Provider-options one opens an inline sheet, not the
    // General FormDialog). Scope the trigger to the General section's header
    // row (the `HStack` that holds the "General" <h3>) so it's unambiguous.
    const generalEdit = page
      .locator('div')
      .filter({ has: generalHeading })
      .filter({
        has: page.getByRole('button', {
          name: t('settings.providers.editGeneral'),
        }),
      })
      .last()
      .getByRole('button', { name: t('settings.providers.editGeneral') });

    // Open the Edit general-details panel (the FormDialog titled "Edit general
    // details"). Its Display name field is per-locale; the default-locale value
    // mirrors the provider's top-level `displayName`.
    await generalEdit.click();

    const editDialog = page.getByRole('dialog', {
      name: t('settings.providers.editGeneralTitle'),
    });
    await expect(editDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    const displayNameField = editDialog.getByLabel(
      t('settings.providers.displayName'),
    );
    await expect(displayNameField).toHaveValue(PROVIDER_DISPLAY_NAME, {
      timeout: TIMEOUT.VISIBLE,
    });

    const newDisplayName = `E2E Mock Provider ${Date.now().toString(36)}`;
    await displayNameField.fill(newDisplayName);
    // The panel's submit button renders the "Save changes" label.
    await editDialog
      .getByRole('button', {
        name: t('settings.providers.saveChanges'),
        exact: true,
      })
      .click();

    // Commit gate: the edit panel toasts `providers.saved` on a successful
    // write. Wait for it BEFORE reloading — reloading mid-save aborts the
    // in-flight mutation and the reloaded card would still show the old name.
    await expect(
      page.getByText(t('settings.providers.saved')).first(),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    // Reload and assert the persisted display name in the General card.
    await reloadAndSettle(page, generalHeading);
    await expect(page.getByText(newDisplayName).first()).toBeVisible({
      timeout: TIMEOUT.PERSIST,
    });

    // Unconditionally restore the seeded display name.
    await generalEdit.click();
    const restoreDialog = page.getByRole('dialog', {
      name: t('settings.providers.editGeneralTitle'),
    });
    await expect(restoreDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    const restoreField = restoreDialog.getByLabel(
      t('settings.providers.displayName'),
    );
    await expect(restoreField).toHaveValue(newDisplayName, {
      timeout: TIMEOUT.VISIBLE,
    });
    await restoreField.fill(PROVIDER_DISPLAY_NAME);
    await restoreDialog
      .getByRole('button', {
        name: t('settings.providers.saveChanges'),
        exact: true,
      })
      .click();
    await expect(
      page.getByText(t('settings.providers.saved')).first(),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    await reloadAndSettle(page, generalHeading);
    await expect(page.getByText(PROVIDER_DISPLAY_NAME).first()).toBeVisible({
      timeout: TIMEOUT.PERSIST,
    });
  });
});
