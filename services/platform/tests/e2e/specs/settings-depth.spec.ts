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

    const nameField = page.getByRole('textbox', {
      name: t('settings.organization.title'),
    });
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

    // Commit gate: wait for the Save cluster to settle BEFORE reloading.
    // Reloading mid-save aborts the in-flight mutation and the reloaded field
    // would still show the original name. The page toasts nothing on success —
    // the cluster flashes "Saved" and then settles back to a DISABLED "Save"
    // once the form is clean again, which is the stable commit signal (a failed
    // save leaves the form dirty and the button enabled). `visibleSaveButton`
    // matches the label exactly, so it can't match the in-flight "Saving…" or
    // the "Saved" flash. We assert persistence off the reloaded FIELD.
    await expect(save).toBeDisabled({ timeout: TIMEOUT.VISIBLE });
    await reloadAndSettle(page, nameField);
    await expect(nameField).toHaveValue(newName, { timeout: TIMEOUT.PERSIST });

    // Unconditionally restore the original name.
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
  test('sets the accent color, persists across reload, and restores', async ({
    page,
    org,
  }) => {
    const { organizationId } = org;
    await page.goto(settingsUrl(organizationId, 'branding'));

    await expect(
      page.getByRole('heading', { name: t('navigation.branding'), level: 2 }),
    ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

    // The app name is no longer an editable field — the chrome follows the
    // organization's name. The single accent color (#1960) is the form's
    // editable text field. `${label} hex value` is the composed aria-label of
    // the color text input (a non-i18n composition the control builds from
    // its label prop).
    const accentColorField = page.getByLabel(
      `${t('settings.branding.accentColor')} hex value`,
    );
    await expect(accentColorField).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await expect(accentColorField).toBeEnabled();

    // A fresh org has no branding file, so the accent color starts empty.
    const originalAccentColor = await accentColorField.inputValue();

    const newAccentColorHex = '123456'; // 6 hex digits; the control prepends `#`.
    await accentColorField.fill(newAccentColorHex);

    const save = visibleSaveButton(page);
    await expect(save).toBeEnabled({ timeout: TIMEOUT.VISIBLE });
    await save.click();

    // Commit gate: wait for the Save cluster to settle BEFORE reloading.
    // Reloading mid-save aborts the in-flight mutation. The page toasts nothing
    // on success — the cluster flashes "Saved" and settles back to a DISABLED
    // "Save" once the form is clean again, which is the stable commit signal.
    // Persistence is asserted off the reloaded FIELD below.
    await expect(save).toBeDisabled({ timeout: TIMEOUT.VISIBLE });
    await reloadAndSettle(page, accentColorField);
    await expect(accentColorField).toHaveValue(/123456/i, {
      timeout: TIMEOUT.PERSIST,
    });

    // Restore. The accent color is optional, so an empty value is a valid
    // saved state — the restore always round-trips end-to-end.
    await accentColorField.fill(originalAccentColor.replace('#', ''));
    const restoreSave = visibleSaveButton(page);
    await expect(restoreSave).toBeEnabled({ timeout: TIMEOUT.VISIBLE });
    await restoreSave.click();
    await expect(restoreSave).toBeDisabled({ timeout: TIMEOUT.VISIBLE });
    await reloadAndSettle(page, accentColorField);
    await expect(accentColorField).toHaveValue(originalAccentColor, {
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

    // The Custom-instructions section heading is the page's settled anchor.
    // (`personalization.page.title` is no longer rendered as a heading — the
    // settings rework left it as the skeleton label only.) The toggle below
    // shares this text as its accessible name, so scope to the heading role.
    await expect(
      page.getByRole('heading', {
        name: t('personalization.page.customInstructions.title'),
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

// The skills page render + upload-affordance smoke moved to a component test:
// app/features/skills/components/skills-catalog.test.tsx (pure render, no real
// backend/upload seam — installing a skill needs an on-disk SKILL.md bundle and
// is non-hermetic, so the e2e only ever asserted the empty-state chrome).
