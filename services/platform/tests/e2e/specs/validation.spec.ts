import { type Locator, type Page } from '@playwright/test';

import { TIMEOUT } from '../helpers/env';
import { test, expect } from '../helpers/fixtures';
import { t } from '../helpers/i18n';

/**
 * Negative-path coverage for the create/delete flows whose validation actually
 * exists in source: each test opens a dialog, asserts the gating, and CANCELS so
 * nothing persists. The cascade-delete test creates a uniquely-suffixed
 * throwaway project (the only way to reach the typed-phrase confirmation) and
 * removes it afterward via the normal detach path. Parameterized validation
 * strings ("{field} is required") aren't interpolated by `t()`, so the expected
 * text is built with `.replace('{field}', <resolved label>)`.
 */

/** The submit button inside an open `FormDialog`, scoped so it never collides
 *  with a same-labelled control behind it. */
function dialogButton(dialog: Locator, name: string): Locator {
  return dialog.getByRole('button', { name, exact: true });
}

/** The header "Create project" action; `.first()` pins it over the empty-state
 *  copy that shares the label. */
function createProjectButton(page: Page): Locator {
  return page
    .getByRole('button', { name: t('projects.list.createButton') })
    .first();
}

test.describe('validation — create agent dialog', () => {
  test('rejects an invalid slug and an empty name; cancels without creating', async ({
    page,
    org,
  }) => {
    const { organizationId } = org;
    await page.goto(`/dashboard/${organizationId}/agents`);

    // "Create agent" is an action-menu trigger whose menu item opens the dialog.
    await page
      .getByRole('button', { name: t('settings.agents.createAgent') })
      .click();
    await page
      .getByRole('menuitem', { name: t('settings.agents.createAgent') })
      .click();

    const dialog = page.getByRole('dialog', {
      name: t('settings.agents.createAgent'),
    });
    await expect(dialog).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

    // "Name" is exact — "Display name" also contains "Name".
    const slugField = dialog.getByLabel(t('settings.agents.form.name'), {
      exact: true,
    });
    const displayNameField = dialog.getByLabel(
      t('settings.agents.form.displayName'),
      { exact: true },
    );
    const continueButton = dialogButton(
      dialog,
      t('settings.agents.createDialog.continue'),
    );

    // (a) Invalid slug + valid display name → Continue stays DISABLED and the
    // pattern error renders (mode: 'onChange'). The seeded mock provider supplies
    // a model, so the slug is the only thing keeping Continue disabled.
    await slugField.fill('Bad Slug!');
    await displayNameField.fill('Valid Display Name');
    await expect(
      dialog.getByText(t('settings.agents.form.namePatternError')),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await expect(continueButton).toBeDisabled();

    // (b) A valid slug clears the error and ENABLES Continue.
    await slugField.fill('valid-slug');
    await expect(
      dialog.getByText(t('settings.agents.form.namePatternError')),
    ).toHaveCount(0, { timeout: TIMEOUT.VISIBLE });
    await expect(continueButton).toBeEnabled({ timeout: TIMEOUT.VISIBLE });

    // (c) Clearing the display name → required error + Continue DISABLED again.
    await displayNameField.fill('');
    await expect(
      dialog.getByText(
        t('common.validation.required').replace(
          '{field}',
          t('settings.agents.form.displayName'),
        ),
      ),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await expect(continueButton).toBeDisabled();

    await dialogButton(dialog, t('common.actions.cancel')).click();
    await expect(dialog).toBeHidden({ timeout: TIMEOUT.VISIBLE });
  });
});

test.describe('validation — create project dialog', () => {
  test('rejects a whitespace-only name on submit; cancels without creating', async ({
    page,
    org,
  }) => {
    const { organizationId } = org;
    await page.goto(`/dashboard/${organizationId}/projects`);

    await expect(createProjectButton(page)).toBeVisible({
      timeout: TIMEOUT.FIRST_PAINT,
    });
    await createProjectButton(page).click();

    const dialog = page.getByRole('dialog', {
      name: t('projects.create.title'),
    });
    await expect(dialog).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

    const nameField = dialog.getByRole('textbox', {
      name: t('projects.create.nameLabel'),
    });
    const submit = dialogButton(dialog, t('projects.create.submit'));

    // The name schema is `.trim().min(1)`, but the submit button is NOT
    // validity-gated and RHF validates on submit — so a whitespace-only name
    // leaves the button enabled; clicking it surfaces the error and blocks.
    await nameField.fill('   ');
    await expect(submit).toBeEnabled();
    await submit.click();

    await expect(
      dialog.getByRole('alert').filter({
        hasText: t('common.validation.required').replace(
          '{field}',
          t('projects.create.nameLabel'),
        ),
      }),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    // No navigation to a new project detail route — the create is blocked.
    await expect(dialog).toBeVisible();
    expect(page.url()).toContain(`/dashboard/${organizationId}/projects`);
    expect(page.url()).not.toMatch(/\/projects\/[A-Za-z0-9]{16,}/);

    await dialogButton(dialog, t('common.actions.cancel')).click();
    await expect(dialog).toBeHidden({ timeout: TIMEOUT.VISIBLE });
  });
});

test.describe('validation — create team dialog', () => {
  test('disables submit until a non-empty name is entered; cancels without creating', async ({
    page,
    org,
  }) => {
    const { organizationId } = org;
    await page.goto(`/dashboard/${organizationId}/settings/teams`);

    // Settings pages have no page title; the section heading is the first
    // content and proves the page mounted.
    await expect(
      page.getByRole('heading', { name: t('navigation.teams'), level: 2 }),
    ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

    await page
      .getByRole('button', { name: t('settings.teams.createTeam') })
      .first()
      .click();

    const dialog = page.getByRole('dialog', {
      name: t('settings.teams.createTeam'),
    });
    await expect(dialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    const nameField = dialog.getByLabel(t('settings.teams.teamName'));
    const submit = dialogButton(dialog, t('settings.teams.createTeam'));

    // Empty name (the default) → invalid → submit DISABLED (`isValid` is passed
    // to FormDialog, mode: 'onChange').
    await expect(nameField).toHaveValue('');
    await expect(submit).toBeDisabled();

    // Whitespace-only trims to empty: still invalid → required error, disabled.
    await nameField.fill('   ');
    await expect(
      dialog.getByText(t('settings.teams.teamNameRequired')),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await expect(submit).toBeDisabled();

    // A real name clears the error and ENABLES submit (we never click it).
    await nameField.fill(`E2E Team validation ${Date.now().toString(36)}`);
    await expect(
      dialog.getByText(t('settings.teams.teamNameRequired')),
    ).toHaveCount(0, { timeout: TIMEOUT.VISIBLE });
    await expect(submit).toBeEnabled({ timeout: TIMEOUT.VISIBLE });

    await dialogButton(dialog, t('common.actions.cancel')).click();
    await expect(dialog).toBeHidden({ timeout: TIMEOUT.VISIBLE });
  });
});

test.describe('validation — project delete confirmation gating', () => {
  test('gates the cascade delete behind the typed project name, then cancels; throwaway is cleaned up', async ({
    page,
    org,
  }) => {
    const { organizationId } = org;
    const suffix = Date.now().toString(36);
    const projectName = `E2E Validation Project ${suffix}`;

    // Create the throwaway project (the only way to reach the delete dialog).
    await page.goto(`/dashboard/${organizationId}/projects`);
    await expect(createProjectButton(page)).toBeVisible({
      timeout: TIMEOUT.FIRST_PAINT,
    });
    await createProjectButton(page).click();

    const createDialog = page.getByRole('dialog', {
      name: t('projects.create.title'),
    });
    await expect(createDialog).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
    await createDialog
      .getByRole('textbox', { name: t('projects.create.nameLabel') })
      .fill(projectName);
    await dialogButton(createDialog, t('projects.create.submit')).click();
    await page.waitForURL(
      new RegExp(`/dashboard/${organizationId}/projects/[A-Za-z0-9]{16,}`),
      { timeout: TIMEOUT.NAV },
    );

    // Back to the list; open the throwaway's delete dialog from its row.
    await page.goto(`/dashboard/${organizationId}/projects`);
    const projectRow = page.getByRole('row').filter({ hasText: projectName });
    await expect(projectRow).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

    await projectRow
      .getByRole('button', { name: t('common.actions.openMenu') })
      .click();
    await page
      .getByRole('menuitem', { name: t('projects.rowActions.delete') })
      .click();

    const deleteDialog = page.getByRole('dialog', {
      name: t('projects.settings.deleteDialogTitle'),
    });
    await expect(deleteDialog).toBeVisible({ timeout: TIMEOUT.NAV });

    const deleteButton = dialogButton(
      deleteDialog,
      t('projects.settings.deleteSubmit'),
    );

    // Detach mode (default): enabled immediately — no phrase required.
    await expect(deleteButton).toBeEnabled();

    // Checking cascade switches to hard-delete and GATES the button behind the
    // typed project name (`disableDelete={!phraseSatisfied}`).
    await deleteDialog
      .getByText(t('projects.settings.deleteCascadeCheckbox'))
      .click();
    await expect(deleteButton).toBeDisabled();

    const confirmInput = deleteDialog.getByLabel(
      t('projects.settings.deleteConfirmPhrase'),
    );
    await expect(confirmInput).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await confirmInput.fill('not the project name');
    await expect(deleteButton).toBeDisabled();

    // The exact name satisfies the phrase → ENABLED (we cancel rather than
    // click, so no cascade fires; the throwaway is detached-deleted below).
    await confirmInput.fill(projectName);
    await expect(deleteButton).toBeEnabled({ timeout: TIMEOUT.VISIBLE });

    await dialogButton(deleteDialog, t('common.actions.cancel')).click();
    await expect(deleteDialog).toBeHidden({ timeout: TIMEOUT.VISIBLE });

    // The project still exists (the gated cascade delete was cancelled).
    await expect(
      page.getByRole('row').filter({ hasText: projectName }),
    ).toBeVisible({ timeout: TIMEOUT.NAV });

    // Clean up via the normal detach path (default, no phrase).
    await projectRow
      .getByRole('button', { name: t('common.actions.openMenu') })
      .click();
    await page
      .getByRole('menuitem', { name: t('projects.rowActions.delete') })
      .click();

    const cleanupDialog = page.getByRole('dialog', {
      name: t('projects.settings.deleteDialogTitle'),
    });
    await expect(cleanupDialog).toBeVisible({ timeout: TIMEOUT.NAV });
    await dialogButton(
      cleanupDialog,
      t('projects.settings.deleteSubmit'),
    ).click();

    await expect(
      page.getByRole('row').filter({ hasText: projectName }),
    ).toHaveCount(0, { timeout: TIMEOUT.NAV });
  });
});
