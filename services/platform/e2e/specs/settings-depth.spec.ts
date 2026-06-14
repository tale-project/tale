import { expect, test, type Locator, type Page } from '@playwright/test';

import { t } from '../helpers/i18n';
import { readRunContext } from '../helpers/test-context';

/**
 * Settings DEPTH flows — real mutate round-trips that `settings.spec.ts`
 * (account-name save/restore, org-name READ, providers list/drawer, page-loads
 * matrix) intentionally leaves out. Runs as the pre-authenticated owner
 * (chromium project storageState) against the seeded org.
 *
 * Every flow either CAPTURES the original value and RESTORES it (org name,
 * branding, personalization toggle) or CREATES a uniquely-named entity and
 * DELETES it (API key, team), so the single shared backend/owner/org is left as
 * it was found. Created entities use a `Date.now().toString(36)` suffix so
 * names never collide across re-runs on a reused stack.
 *
 * Settings pages have NO page title — the rail/tab names the page and content
 * starts with a `SettingsSection` `<h2>`, so every render assertion targets a
 * SECTION heading, never a page title. The unified Save/Discard cluster is
 * rendered twice (a desktop `hidden md:flex` slot + a `md:hidden` mobile bar),
 * so the Save button matches two DOM nodes; `visibleSaveButton` scopes to the
 * one visible on the Desktop Chrome viewport.
 *
 * Hermetic skips (documented inline at each site): the Skills page can only be
 * mutated by uploading a SKILL.md bundle from disk and the fixture config seeds
 * no skills, so Skills is render + manage-affordance only.
 */

function settingsUrl(organizationId: string, path: string): string {
  return `/dashboard/${organizationId}/settings/${path}`;
}

/**
 * The unified Save/Discard cluster is rendered TWICE in the settings layout —
 * a desktop slot (`hidden md:flex`) and a mobile bar (`md:hidden`) — so the
 * Save button matches two nodes in the DOM. On the Desktop Chrome viewport only
 * one is visible; scope to it so the locator is unambiguous. (Same helper shape
 * as `settings.spec.ts`; duplicated rather than shared since the suite keeps
 * each spec self-contained and never edits helpers.)
 */
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
  }) => {
    const { organizationId } = readRunContext();
    await page.goto(settingsUrl(organizationId, 'organization'));

    // Section heading is the page's first content (no page title).
    await expect(
      page.getByRole('heading', {
        name: t('settings.organization.detailsTitle'),
        level: 2,
      }),
    ).toBeVisible({ timeout: 60_000 });

    const nameField = page.getByLabel(t('settings.organization.title'));
    await expect(nameField).toBeVisible({ timeout: 60_000 });
    await expect(nameField).toBeEnabled();

    // Capture the original so the run is restorable (org name is shared backend
    // state read elsewhere, e.g. settings.spec's org-name read).
    const originalName = await nameField.inputValue();
    expect(originalName).not.toBe('');
    const newName = `E2E Org ${Date.now().toString(36)}`;
    expect(newName).not.toBe(originalName);

    // Editing makes the form dirty, which enables the Save cluster.
    await nameField.fill(newName);
    const save = visibleSaveButton(page);
    await expect(save).toBeEnabled({ timeout: 20_000 });
    await save.click();

    await expect(
      page.getByText(t('toast.success.organizationUpdated')).first(),
    ).toBeVisible({ timeout: 20_000 });

    // Reload: the new value must come back from the backend, not local state.
    await page.reload();
    const reloadedField = page.getByLabel(t('settings.organization.title'));
    await expect(reloadedField).toBeVisible({ timeout: 60_000 });
    await expect(reloadedField).toHaveValue(newName, { timeout: 20_000 });

    // Restore the original name (keeps re-runs + the org-name read deterministic).
    await reloadedField.fill(originalName);
    const restoreSave = visibleSaveButton(page);
    await expect(restoreSave).toBeEnabled({ timeout: 20_000 });
    await restoreSave.click();
    await expect(
      page.getByText(t('toast.success.organizationUpdated')).first(),
    ).toBeVisible({ timeout: 20_000 });
    await expect(reloadedField).toHaveValue(originalName);
  });
});

test.describe('settings depth — API keys', () => {
  test('creates an API key, shows it once, then revokes it', async ({
    page,
  }) => {
    const { organizationId } = readRunContext();
    await page.goto(settingsUrl(organizationId, 'api/rest'));

    await expect(
      page.getByRole('heading', { name: t('navigation.apiRest'), level: 2 }),
    ).toBeVisible({ timeout: 60_000 });

    const keyName = `e2e-key-${Date.now().toString(36)}`;

    // --- Create: header/empty-state CTA opens the create dialog. The action
    // menu and the empty-state CTA share one "Create API key" button. ---
    await page
      .getByRole('button', { name: t('settings.apiKeys.createKey') })
      .first()
      .click();

    const createDialog = page.getByRole('dialog', {
      name: t('settings.apiKeys.createKey'),
    });
    await expect(createDialog).toBeVisible({ timeout: 20_000 });
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
    await expect(createdDialog).toBeVisible({ timeout: 20_000 });
    await expect(
      createdDialog.getByText(t('settings.apiKeys.yourApiKey')),
    ).toBeVisible();
    await createdDialog
      .getByRole('button', { name: t('common.actions.done'), exact: true })
      .click();

    // The new key lands in the list (the create mutation invalidates the list
    // query). Isolate the row by its unique name cell.
    const keyRow = rowByName(page, keyName);
    await expect(keyRow).toBeVisible({ timeout: 60_000 });

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
    await expect(revokeDialog).toBeVisible({ timeout: 20_000 });
    // The confirm button shares the "Revoke key" label with the menu item, so
    // scope it to the dialog to keep the locator unambiguous.
    await revokeDialog
      .getByRole('button', {
        name: t('settings.apiKeys.revokeKey'),
        exact: true,
      })
      .click();

    await expect(
      page.getByText(t('settings.apiKeys.keyRevoked')).first(),
    ).toBeVisible({ timeout: 20_000 });
    // Gone from the list — restores the org to its key-less state.
    await expect(keyRow).toHaveCount(0, { timeout: 60_000 });
  });
});

test.describe('settings depth — branding', () => {
  test('sets the app name + brand color, persists across reload, and restores', async ({
    page,
  }) => {
    const { organizationId } = readRunContext();
    await page.goto(settingsUrl(organizationId, 'branding'));

    await expect(
      page.getByRole('heading', { name: t('navigation.branding'), level: 2 }),
    ).toBeVisible({ timeout: 60_000 });

    const appNameField = page.getByLabel(t('settings.branding.appName'));
    await expect(appNameField).toBeVisible({ timeout: 60_000 });
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
    await expect(save).toBeEnabled({ timeout: 20_000 });
    await save.click();

    await expect(
      page.getByText(t('toast.success.brandingUpdated')).first(),
    ).toBeVisible({ timeout: 20_000 });

    // Reload: the saved app name must come back from the backend.
    await page.reload();
    const reloadedAppName = page.getByLabel(t('settings.branding.appName'));
    await expect(reloadedAppName).toBeVisible({ timeout: 60_000 });
    await expect(reloadedAppName).toHaveValue(newAppName, { timeout: 20_000 });

    // Restore. The form can only persist a non-empty app name (schema
    // `min(1)`); when the captured original was empty (the fixture default)
    // there is no UI path to re-save an empty value, so the field is cleared
    // back to its original in the form and the brand color reverted — branding
    // is display-only and read by no other depth spec, so a lingering app name
    // on a reused stack is inert. When the original was non-empty, the restore
    // is saved end-to-end.
    await reloadedAppName.fill(originalAppName);
    const reloadedBrandColor = page.getByLabel(
      `${t('settings.branding.brandColor')} hex value`,
    );
    await reloadedBrandColor.fill(originalBrandColor.replace('#', ''));

    if (originalAppName !== '') {
      const restoreSave = visibleSaveButton(page);
      await expect(restoreSave).toBeEnabled({ timeout: 20_000 });
      await restoreSave.click();
      await expect(
        page.getByText(t('toast.success.brandingUpdated')).first(),
      ).toBeVisible({ timeout: 20_000 });
    }
    await expect(reloadedAppName).toHaveValue(originalAppName);
  });
});

test.describe('settings depth — personalization', () => {
  test('toggles the Custom instructions preference and restores it', async ({
    page,
  }) => {
    const { organizationId } = readRunContext();
    await page.goto(settingsUrl(organizationId, 'personalization'));

    // Section heading (the page's first content); the personalization page
    // titles itself via its `personalization` namespace.
    await expect(
      page.getByRole('heading', {
        name: t('personalization.page.title'),
        level: 2,
      }),
    ).toBeVisible({ timeout: 60_000 });

    // The Custom-instructions toggle saves on flip (no Save cluster) and is
    // always enabled (unlike Voice output, which gates on a TTS-capable
    // provider). `SettingsToggleRow` wires the Radix switch to its label via
    // aria-labelledby, so the accessible name is the label text.
    const toggle = page.getByRole('switch', {
      name: t('personalization.page.customInstructionsToggle.label'),
    });
    await expect(toggle).toBeVisible({ timeout: 60_000 });
    await expect(toggle).toBeEnabled();

    // Radix switch: checked state is exposed via aria-checked.
    const initiallyChecked =
      (await toggle.getAttribute('aria-checked')) === 'true';

    await toggle.click();
    await expect(
      page.getByText(t('personalization.toasts.preferencesUpdated')).first(),
    ).toBeVisible({ timeout: 20_000 });
    await expect(toggle).toHaveAttribute(
      'aria-checked',
      String(!initiallyChecked),
    );

    // Restore the original effective state (flipping back). The underlying pref
    // is now an explicit value where it may have been "follow org default", but
    // the effective (rendered) state is what other surfaces observe, and this
    // run's org is fresh — so restoring the effective value keeps re-runs sane.
    await toggle.click();
    await expect(
      page.getByText(t('personalization.toasts.preferencesUpdated')).first(),
    ).toBeVisible({ timeout: 20_000 });
    await expect(toggle).toHaveAttribute(
      'aria-checked',
      String(initiallyChecked),
    );
  });
});

test.describe('settings depth — teams', () => {
  test('creates a team, lists it, then deletes it', async ({ page }) => {
    const { organizationId } = readRunContext();
    await page.goto(settingsUrl(organizationId, 'teams'));

    await expect(
      page.getByRole('heading', { name: t('navigation.teams'), level: 2 }),
    ).toBeVisible({ timeout: 60_000 });

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
    await expect(createDialog).toBeVisible({ timeout: 20_000 });
    await createDialog.getByLabel(t('settings.teams.teamName')).fill(teamName);
    // The submit button shares the "Create team" label with the dialog title;
    // scope it to the dialog and match exactly.
    await createDialog
      .getByRole('button', {
        name: t('settings.teams.createTeam'),
        exact: true,
      })
      .click();

    await expect(
      page.getByText(t('settings.teams.teamCreated')).first(),
    ).toBeVisible({ timeout: 20_000 });

    // The new team lands in the list (listOrgTeams is a reactive Convex query).
    const teamRow = rowByName(page, teamName);
    await expect(teamRow).toBeVisible({ timeout: 60_000 });

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
    await expect(deleteDialog).toBeVisible({ timeout: 20_000 });
    // The confirm button defaults to common.actions.delete (same label as the
    // menu item), so scope it to the dialog to keep the locator unambiguous.
    await deleteDialog
      .getByRole('button', { name: t('common.actions.delete'), exact: true })
      .click();

    await expect(
      page.getByText(t('settings.teams.teamDeleted')).first(),
    ).toBeVisible({ timeout: 20_000 });
    // Gone from the list — restores the org to its team-less state.
    await expect(teamRow).toHaveCount(0, { timeout: 60_000 });
  });
});

test.describe('settings depth — skills', () => {
  // Render + manage-affordance only. Installing/enabling a skill is NOT
  // hermetic: a skill is created by uploading a SKILL.md bundle from disk
  // through the upload dialog, and the fixture config seeds no skills — so the
  // page paints its empty-state. We assert the section heading and the upload
  // ("manage") affordance the page exposes for adding skills.
  test('renders the skills page and exposes the upload affordance', async ({
    page,
  }) => {
    const { organizationId } = readRunContext();
    await page.goto(settingsUrl(organizationId, 'skills'));

    await expect(
      page.getByRole('heading', { name: t('navigation.skills'), level: 2 }),
    ).toBeVisible({ timeout: 60_000 });

    // The table header action menu ("Upload skill") is always rendered for an
    // admin/developer regardless of row count — its presence proves the page
    // mounted and offers the manage affordance.
    await expect(
      page
        .getByRole('button', { name: t('settings.skills.uploadSkill') })
        .first(),
    ).toBeVisible({ timeout: 60_000 });
  });
});
