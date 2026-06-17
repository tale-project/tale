import { type Locator, type Page } from '@playwright/test';

import { TIMEOUT } from '../helpers/env';
import { test, expect } from '../helpers/fixtures';
import { reloadAndSettle } from '../helpers/forms';
import { t } from '../helpers/i18n';

/**
 * Settings DEPTH flows — real mutate round-trips (org rename, API key
 * create/revoke, branding, personalization toggle, team create/delete) that
 * `settings.spec.ts` leaves out. Each flow captures + restores its original
 * value, or creates a uniquely-suffixed entity and deletes it, so the worker's
 * isolated org is left as found and re-runs stay idempotent.
 */

function settingsUrl(organizationId: string, path: string): string {
  return `/dashboard/${organizationId}/settings/${path}`;
}

// The unified Save/Discard cluster renders twice (a desktop `hidden md:flex`
// slot + a `md:hidden` mobile bar), so the Save button matches two DOM nodes;
// scope to the one visible on the Desktop Chrome viewport.
function visibleSaveButton(page: Page): Locator {
  return page
    .getByRole('button', { name: t('common.actions.save'), exact: true })
    .filter({ visible: true });
}

/** Isolate the single table row whose name cell matches `name` exactly. */
function rowByName(page: Page, name: string): Locator {
  return page.getByRole('row').filter({
    has: page.getByRole('cell', { name, exact: true }),
  });
}

test.describe('settings depth — organization', () => {
  test('renames the org, persists across reload, and restores the original name', async ({
    page,
    org,
  }) => {
    const { organizationId } = org;
    await page.goto(settingsUrl(organizationId, 'organization'));

    await expect(
      page.getByRole('heading', {
        name: t('settings.organization.detailsTitle'),
        level: 2,
      }),
    ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

    const nameField = page.getByLabel(t('settings.organization.title'));
    await expect(nameField).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await expect(nameField).toBeEnabled();

    const originalName = await nameField.inputValue();
    expect(originalName).not.toBe('');
    const newName = `E2E Org ${Date.now().toString(36)}`;
    expect(newName).not.toBe(originalName);

    // Editing makes the form dirty, which enables the Save cluster.
    await nameField.fill(newName);
    const save = visibleSaveButton(page);
    await expect(save).toBeEnabled({ timeout: TIMEOUT.VISIBLE });
    await save.click();

    // Commit gate: wait for the success toast BEFORE reloading. Reloading
    // mid-save aborts the in-flight mutation and the reloaded field would
    // still show the original name; the toast is the commit signal. We assert
    // persistence off the reloaded FIELD, not the toast.
    await expect(
      page.getByText(t('toast.success.organizationUpdated')).first(),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await reloadAndSettle(page, nameField);
    await expect(nameField).toHaveValue(newName, { timeout: TIMEOUT.PERSIST });

    // Unconditionally restore the original name.
    await nameField.fill(originalName);
    const restoreSave = visibleSaveButton(page);
    await expect(restoreSave).toBeEnabled({ timeout: TIMEOUT.VISIBLE });
    await restoreSave.click();
    await expect(
      page.getByText(t('toast.success.organizationUpdated')).first(),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await reloadAndSettle(page, nameField);
    await expect(nameField).toHaveValue(originalName, {
      timeout: TIMEOUT.PERSIST,
    });
  });
});

test.describe('settings depth — API keys', () => {
  test('creates an API key, shows it once, then revokes it', async ({
    page,
    org,
  }) => {
    const { organizationId } = org;
    await page.goto(settingsUrl(organizationId, 'api/rest'));

    await expect(
      page.getByRole('heading', { name: t('navigation.apiKeys'), level: 2 }),
    ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

    const keyName = `e2e-key-${Date.now().toString(36)}`;

    // --- Create: header/empty-state CTA opens the create dialog (both share the
    // "Create API key" button). ---
    await page
      .getByRole('button', { name: t('settings.apiKeys.createKey') })
      .first()
      .click();

    const createDialog = page.getByRole('dialog', {
      name: t('settings.apiKeys.createKey'),
    });
    await expect(createDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await createDialog
      .getByLabel(t('settings.apiKeys.form.name'))
      .fill(keyName);
    await createDialog
      .getByRole('button', {
        name: t('settings.apiKeys.createKeySubmit'),
        exact: true,
      })
      .click();

    // Shown-once: the dialog swaps to the "API key created" view that reveals
    // the secret exactly once. Assert the reveal label, then dismiss with Done.
    const createdDialog = page.getByRole('dialog', {
      name: t('settings.apiKeys.keyCreated'),
    });
    await expect(createdDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await expect(
      createdDialog.getByText(t('settings.apiKeys.yourApiKey'), {
        exact: true,
      }),
    ).toBeVisible();
    await createdDialog
      .getByRole('button', { name: t('common.actions.done'), exact: true })
      .click();

    // The new key lands in the list (the create mutation invalidates the list
    // query). Isolate the row by its unique name cell.
    const keyRow = rowByName(page, keyName);
    await expect(keyRow).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    // --- Revoke: row actions menu → Revoke key → confirm in the dialog. ---
    await keyRow
      .getByRole('button', { name: t('common.actions.openMenu') })
      .click();
    await page
      .getByRole('menuitem', { name: t('settings.apiKeys.revokeKey') })
      .click();

    const revokeDialog = page.getByRole('dialog', {
      name: t('settings.apiKeys.revokeKeyTitle'),
    });
    await expect(revokeDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    // The confirm button shares the "Revoke key" label with the menu item, so
    // scope it to the dialog to keep the locator unambiguous.
    await revokeDialog
      .getByRole('button', {
        name: t('settings.apiKeys.revokeKey'),
        exact: true,
      })
      .click();

    // Gone from the list — restores the org to its key-less state.
    await expect(keyRow).toHaveCount(0, { timeout: TIMEOUT.VISIBLE });
  });
});

test.describe('settings depth — branding', () => {
  test('sets the app name + brand color, persists across reload, and restores', async ({
    page,
    org,
  }) => {
    const { organizationId } = org;
    await page.goto(settingsUrl(organizationId, 'branding'));

    await expect(
      page.getByRole('heading', { name: t('navigation.branding'), level: 2 }),
    ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

    const appNameField = page.getByLabel(t('settings.branding.appName'));
    await expect(appNameField).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await expect(appNameField).toBeEnabled();

    // Capture originals. A fresh org has no branding file, so the app name is
    // typically empty; the brand-color hex control holds the value WITHOUT the
    // leading `#` (see ColorPickerInput) and starts empty too.
    const originalAppName = await appNameField.inputValue();
    // `${label} hex value` is the composed aria-label of the brand-color text
    // input (a non-i18n composition the control builds from its label prop).
    const brandColorField = page.getByLabel(
      `${t('settings.branding.brandColor')} hex value`,
    );
    const originalBrandColor = await brandColorField.inputValue();

    // The branding form's schema requires a non-empty app name to save, so the
    // mutate sets BOTH the app name and the brand color.
    const newAppName = `E2E Brand ${Date.now().toString(36)}`;
    const newBrandColorHex = '123456'; // 6 hex digits; the control prepends `#`.
    await appNameField.fill(newAppName);
    await brandColorField.fill(newBrandColorHex);

    const save = visibleSaveButton(page);
    await expect(save).toBeEnabled({ timeout: TIMEOUT.VISIBLE });
    await save.click();

    // Commit gate: wait for the success toast BEFORE reloading. Reloading
    // mid-save aborts the in-flight mutation, so the reloaded app name would
    // still be the original; the toast is the commit signal. Persistence is
    // asserted off the reloaded FIELD below, not the toast.
    await expect(
      page.getByText(t('toast.success.brandingUpdated')).first(),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    // Reload and assert the persisted app name (not the transient toast).
    await reloadAndSettle(page, appNameField);
    await expect(appNameField).toHaveValue(newAppName, {
      timeout: TIMEOUT.PERSIST,
    });

    // Restore. The form can only persist a non-empty app name (schema
    // `min(1)`); when the captured original was empty (the fixture default)
    // there is no UI path to re-save an empty value, so the field is cleared
    // back to its original in the form and the brand color reverted — branding
    // is display-only and read by no other depth spec, so a lingering app name
    // is inert. When the original was non-empty, the restore is saved end-to-end.
    await appNameField.fill(originalAppName);
    await brandColorField.fill(originalBrandColor.replace('#', ''));

    if (originalAppName !== '') {
      const restoreSave = visibleSaveButton(page);
      await expect(restoreSave).toBeEnabled({ timeout: TIMEOUT.VISIBLE });
      await restoreSave.click();
      // Commit gate before the restore reload (same race as the initial save).
      await expect(
        page.getByText(t('toast.success.brandingUpdated')).first(),
      ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
      await reloadAndSettle(page, appNameField);
    }
    await expect(appNameField).toHaveValue(originalAppName, {
      timeout: TIMEOUT.PERSIST,
    });
  });
});

test.describe('settings depth — personalization', () => {
  test('toggles the Custom instructions preference and restores it', async ({
    page,
    org,
  }) => {
    const { organizationId } = org;
    await page.goto(settingsUrl(organizationId, 'personalization'));

    // Section heading (the page's first content); the personalization page
    // titles itself via its `personalization` namespace.
    await expect(
      page.getByRole('heading', {
        name: t('personalization.page.title'),
        level: 2,
      }),
    ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

    // The Custom-instructions toggle saves on flip (no Save cluster) and is
    // always enabled (unlike Voice output, which gates on a TTS-capable
    // provider). `SettingsToggleRow` wires the Radix switch to its label via
    // aria-labelledby, so the accessible name is the label text.
    const toggle = page.getByRole('switch', {
      name: t('personalization.page.customInstructionsToggle.label'),
    });
    await expect(toggle).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await expect(toggle).toBeEnabled();

    // Radix switch: checked state is exposed via aria-checked.
    const initiallyChecked =
      (await toggle.getAttribute('aria-checked')) === 'true';

    await toggle.click();
    // Commit gate: the toggle saves on flip and toasts on success. Wait for
    // the toast BEFORE reloading — reloading mid-save aborts the in-flight
    // mutation and the toggle would rehydrate to its original state. The
    // persisted state is asserted off the reloaded TOGGLE below, not the toast.
    await expect(
      page.getByText(t('personalization.toasts.preferencesUpdated')).first(),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    // Reload and assert the persisted toggle state (not the transient toast).
    await reloadAndSettle(page, toggle);
    await expect(toggle).toHaveAttribute(
      'aria-checked',
      String(!initiallyChecked),
      { timeout: TIMEOUT.PERSIST },
    );

    // Unconditionally restore the original effective state. The pref is now an
    // explicit value where it may have been "follow org default", but the
    // effective (rendered) state is what other surfaces observe, and this
    // worker's org is fresh — so restoring the effective value keeps re-runs sane.
    await toggle.click();
    // Commit gate before the restore reload (same flip-save race as above).
    await expect(
      page.getByText(t('personalization.toasts.preferencesUpdated')).first(),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await reloadAndSettle(page, toggle);
    await expect(toggle).toHaveAttribute(
      'aria-checked',
      String(initiallyChecked),
      { timeout: TIMEOUT.PERSIST },
    );
  });
});

test.describe('settings depth — teams', () => {
  test('creates a team, lists it, then deletes it', async ({ page, org }) => {
    const { organizationId } = org;
    await page.goto(settingsUrl(organizationId, 'teams'));

    await expect(
      page.getByRole('heading', { name: t('navigation.teams'), level: 2 }),
    ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

    const teamName = `E2E Team ${Date.now().toString(36)}`;

    // --- Create: header/empty-state CTA → fill the name → submit. The submit
    // button is gated on validity, so the name must be filled to enable it. ---
    await page
      .getByRole('button', { name: t('settings.teams.createTeam') })
      .first()
      .click();

    const createDialog = page.getByRole('dialog', {
      name: t('settings.teams.createTeam'),
    });
    await expect(createDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await createDialog.getByLabel(t('settings.teams.teamName')).fill(teamName);
    // The submit button shares the "Create team" label with the dialog title;
    // scope it to the dialog and match exactly.
    await createDialog
      .getByRole('button', {
        name: t('settings.teams.createTeam'),
        exact: true,
      })
      .click();

    // The new team lands in the list (listOrgTeams is a reactive Convex query).
    const teamRow = rowByName(page, teamName);
    await expect(teamRow).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    // --- Delete: row actions menu → Delete → confirm in the dialog. ---
    await teamRow
      .getByRole('button', { name: t('common.actions.openMenu') })
      .click();
    await page
      .getByRole('menuitem', { name: t('common.actions.delete') })
      .click();

    const deleteDialog = page.getByRole('dialog', {
      name: t('settings.teams.deleteTeam'),
    });
    await expect(deleteDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    // The confirm button defaults to common.actions.delete (same label as the
    // menu item), so scope it to the dialog to keep the locator unambiguous.
    await deleteDialog
      .getByRole('button', { name: t('common.actions.delete'), exact: true })
      .click();

    // Gone from the list — restores the org to its team-less state.
    await expect(teamRow).toHaveCount(0, { timeout: TIMEOUT.VISIBLE });
  });
});

test.describe('settings depth — skills', () => {
  // Render + manage-affordance only. Installing/enabling a skill is NOT
  // hermetic: a skill is created by uploading a SKILL.md bundle from disk
  // through the upload dialog, and the worker's fresh org seeds no skills — so
  // the page paints its empty-state. We assert the section heading and the
  // upload ("manage") affordance the page exposes for adding skills.
  test('renders the skills page and exposes the upload affordance', async ({
    page,
    org,
  }) => {
    const { organizationId } = org;
    await page.goto(settingsUrl(organizationId, 'skills'));

    await expect(
      page.getByRole('heading', { name: t('navigation.skills'), level: 2 }),
    ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

    // The table header action menu ("Upload skill") is always rendered for an
    // admin/developer regardless of row count — its presence proves the page
    // mounted and offers the manage affordance.
    await expect(
      page
        .getByRole('button', { name: t('settings.skills.uploadSkill') })
        .first(),
    ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  });
});
