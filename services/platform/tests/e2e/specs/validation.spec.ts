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

// The create-project and create-team dialog validation gating moved to component
// tests: app/features/projects/components/project-create-dialog.test.tsx and
// app/features/settings/teams/components/team-create-dialog.test.tsx (pure
// client-side RHF + zod validation, no backend seam). The create-agent dialog
// validation stays e2e (its Continue gate depends on the seeded mock provider
// supplying a model), and the cascade-delete gating below stays (it creates a
// real throwaway project to reach the typed-phrase confirmation).
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
