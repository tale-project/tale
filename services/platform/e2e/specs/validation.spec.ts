import { expect, test, type Locator, type Page } from '@playwright/test';

import { t } from '../helpers/i18n';
import { readRunContext } from '../helpers/test-context';

/**
 * Validation & negative-path coverage. WAVE 3's feature specs are almost all
 * happy-path; this spec exercises the validation that ACTUALLY EXISTS on a few
 * create/delete flows (rules read from source, not assumed) and asserts that
 * NOTHING is persisted — every test opens a dialog, asserts the gating, and
 * CANCELS. The one flow that must reach a real delete-confirmation
 * (project cascade) creates a uniquely-suffixed throwaway project, asserts the
 * gating, then deletes the throwaway via its normal (detach) path so the shared
 * org is left exactly as it was found.
 *
 * Runs as the pre-authenticated owner (chromium project storageState) against
 * the seeded org. The onboarding spec already covers workspace-name validation
 * (reserved `default` slug + invalid characters) — this spec deliberately does
 * NOT duplicate that and instead targets the agent/project/team create dialogs
 * and the project delete confirmation.
 *
 * Every visible label resolves through `t()` from `messages/en.json`; the run is
 * pinned to `en-US`. Parameterized messages (`common.validation.required` =
 * `"{field} is required"`) are NOT interpolated by `t()`, so the expected text
 * is built with `.replace('{field}', <resolved field label>)` to match what the
 * app renders at runtime.
 *
 * Validation rules verified against source (so the assertions match reality):
 *  - Create-agent dialog (`agent-create-dialog.tsx`): react-hook-form
 *    `mode: 'onChange'`; the slug `name` is `min(1)` + regex
 *    `/^[a-z0-9][a-z0-9_-]*$/`, `displayName` is `min(1)`. The Continue button
 *    is `FormDialog`'s submit, gated on `isValid && hasModels` — so an invalid
 *    slug OR empty display name DISABLES it AND surfaces an inline `<p
 *    role="alert">` error (`Input.errorMessage`).
 *  - Create-project dialog (`project-create-dialog.tsx`): `name` is
 *    `.trim().min(1)`. The submit button is NOT validity-gated (the dialog only
 *    passes `isSubmitting` to `FormDialog`, so `isValid`/`isDirty` default to
 *    `true`); RHF `mode` defaults to `onSubmit`. So a whitespace-only name does
 *    NOT disable the button — clicking it shows the inline error and blocks the
 *    create (no navigation, no row).
 *  - Create-team dialog (`team-create-dialog.tsx`): `mode: 'onChange'`, `name`
 *    is `.trim().min(1)`, and `isValid` IS passed to `FormDialog` — so an empty
 *    name DISABLES the submit button (and a whitespace-only name surfaces the
 *    required error while keeping it disabled).
 *  - Project delete dialog (`project-delete-dialog.tsx` → `DeleteDialog` →
 *    `ConfirmDialog`): the delete button defaults to ENABLED (detach mode), but
 *    checking the cascade checkbox gates it behind a typed confirmation —
 *    `disableDelete={!phraseSatisfied}`, where the trimmed input must
 *    case-insensitively equal the project name. This is the one flow needing a
 *    throwaway entity to reach.
 */

/** The Continue/submit button inside an open `FormDialog`, scoped to the
 *  dialog so it never collides with a same-labelled control behind it. */
function dialogButton(dialog: Locator, name: string): Locator {
  return dialog.getByRole('button', { name, exact: true });
}

/** The always-present "Create project" action-menu button on the list page.
 *  An empty list renders a second identically-labelled button in its empty
 *  state, so `.first()` pins the header action in either case (the header
 *  renders before the table body in DOM order). Mirrors `projects.spec.ts`. */
function createProjectButton(page: Page): Locator {
  return page
    .getByRole('button', { name: t('projects.list.createButton') })
    .first();
}

test.describe('validation — create agent dialog', () => {
  test('rejects an invalid slug and an empty name; cancels without creating', async ({
    page,
  }) => {
    const { organizationId } = readRunContext();
    await page.goto(`/dashboard/${organizationId}/agents`);

    // Open the create dialog: "Create agent" is an action-menu trigger whose
    // menu item opens the dialog (AgentsActionMenu → CreateAgentDialog).
    await page
      .getByRole('button', { name: t('settings.agents.createAgent') })
      .click();
    await page
      .getByRole('menuitem', { name: t('settings.agents.createAgent') })
      .click();

    const dialog = page.getByRole('dialog', {
      name: t('settings.agents.createAgent'),
    });
    await expect(dialog).toBeVisible({ timeout: 60_000 });

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
    // pattern error renders (mode: 'onChange', so no submit click needed). The
    // seeded mock provider supplies a model, so `hasModels` is satisfied and the
    // ONLY thing keeping Continue disabled is the invalid slug.
    await slugField.fill('Bad Slug!');
    await displayNameField.fill('Valid Display Name');
    await expect(
      dialog.getByText(t('settings.agents.form.namePatternError')),
    ).toBeVisible({ timeout: 20_000 });
    await expect(continueButton).toBeDisabled();

    // (b) A valid slug clears the pattern error and ENABLES Continue (proving
    // the disable in (a) was the slug, not a missing model).
    await slugField.fill('valid-slug');
    await expect(
      dialog.getByText(t('settings.agents.form.namePatternError')),
    ).toHaveCount(0, { timeout: 20_000 });
    await expect(continueButton).toBeEnabled({ timeout: 20_000 });

    // (c) Clearing the display name → required error + Continue DISABLED again.
    // The message is `common.validation.required` ("{field} is required") with
    // {field} = the display-name label; t() doesn't interpolate, so build it.
    await displayNameField.fill('');
    await expect(
      dialog.getByText(
        t('common.validation.required').replace(
          '{field}',
          t('settings.agents.form.displayName'),
        ),
      ),
    ).toBeVisible({ timeout: 20_000 });
    await expect(continueButton).toBeDisabled();

    // Cancel — no agent was created (Continue never enabled while invalid).
    await dialogButton(dialog, t('common.actions.cancel')).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
  });
});

test.describe('validation — create project dialog', () => {
  test('rejects a whitespace-only name on submit; cancels without creating', async ({
    page,
  }) => {
    const { organizationId } = readRunContext();
    await page.goto(`/dashboard/${organizationId}/projects`);

    // The "Create project" action button renders for both an existing list and
    // the empty state, so its visibility is the reliable "list settled" signal.
    await expect(createProjectButton(page)).toBeVisible({ timeout: 60_000 });
    await createProjectButton(page).click();

    const dialog = page.getByRole('dialog', {
      name: t('projects.create.title'),
    });
    await expect(dialog).toBeVisible({ timeout: 60_000 });

    const nameField = dialog.getByRole('textbox', {
      name: t('projects.create.nameLabel'),
    });
    // The submit button shares the dialog title's label ("Create project"); the
    // role + exact + dialog scope keep it unambiguous from the heading.
    const submit = dialogButton(dialog, t('projects.create.submit'));

    // The name schema is `.trim().min(1)`, but the submit button is NOT
    // validity-gated (only `isSubmitting`), and RHF validates on submit — so a
    // whitespace-only name leaves the button ENABLED; clicking it surfaces the
    // inline error and blocks the create.
    await nameField.fill('   ');
    await expect(submit).toBeEnabled();
    await submit.click();

    // Inline required error ("Project name is required") — the field's
    // `errorMessage` rendered as a `<p role="alert">`.
    await expect(
      dialog.getByRole('alert').filter({
        hasText: t('common.validation.required').replace(
          '{field}',
          t('projects.create.nameLabel'),
        ),
      }),
    ).toBeVisible({ timeout: 20_000 });

    // The create is blocked: the dialog is still open (no navigation to a new
    // project detail route) and the URL is still the list page.
    await expect(dialog).toBeVisible();
    expect(page.url()).toContain(`/dashboard/${organizationId}/projects`);
    expect(page.url()).not.toMatch(/\/projects\/[A-Za-z0-9]{16,}/);

    // Cancel — nothing persisted.
    await dialogButton(dialog, t('common.actions.cancel')).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
  });
});

test.describe('validation — create team dialog', () => {
  test('disables submit until a non-empty name is entered; cancels without creating', async ({
    page,
  }) => {
    const { organizationId } = readRunContext();
    await page.goto(`/dashboard/${organizationId}/settings/teams`);

    // Section heading is the page's first content (settings pages have no page
    // title). Proves the page mounted before opening the create dialog.
    await expect(
      page.getByRole('heading', { name: t('navigation.teams'), level: 2 }),
    ).toBeVisible({ timeout: 60_000 });

    // Header/empty-state CTA share one "Create team" button; `.first()` pins
    // the header action regardless of row count (mirrors settings-depth.spec).
    await page
      .getByRole('button', { name: t('settings.teams.createTeam') })
      .first()
      .click();

    const dialog = page.getByRole('dialog', {
      name: t('settings.teams.createTeam'),
    });
    await expect(dialog).toBeVisible({ timeout: 20_000 });

    const nameField = dialog.getByLabel(t('settings.teams.teamName'));
    // Submit shares the "Create team" label with the dialog title; scope + exact.
    const submit = dialogButton(dialog, t('settings.teams.createTeam'));

    // Empty name (the default) → invalid → submit DISABLED (the dialog passes
    // `isValid={formState.isValid}` to FormDialog, mode: 'onChange').
    await expect(nameField).toHaveValue('');
    await expect(submit).toBeDisabled();

    // Whitespace-only trims to empty (`.trim().min(1)`): still invalid → the
    // required error shows and submit stays DISABLED.
    await nameField.fill('   ');
    await expect(
      dialog.getByText(t('settings.teams.teamNameRequired')),
    ).toBeVisible({ timeout: 20_000 });
    await expect(submit).toBeDisabled();

    // A real name clears the error and ENABLES submit — proving the gate was the
    // empty/whitespace name (we never click it, so no team is created).
    await nameField.fill(`E2E Team validation ${Date.now().toString(36)}`);
    await expect(
      dialog.getByText(t('settings.teams.teamNameRequired')),
    ).toHaveCount(0, { timeout: 20_000 });
    await expect(submit).toBeEnabled({ timeout: 20_000 });

    // Cancel — no team created (submit never clicked).
    await dialogButton(dialog, t('common.actions.cancel')).click();
    await expect(dialog).toBeHidden({ timeout: 20_000 });
  });
});

test.describe('validation — project delete confirmation gating', () => {
  test('gates the cascade delete behind the typed project name, then cancels; throwaway is cleaned up', async ({
    page,
  }) => {
    const { organizationId } = readRunContext();
    // Unique per run so the throwaway never collides on the shared org.
    const suffix = Date.now().toString(36);
    const projectName = `E2E Validation Project ${suffix}`;

    // --- Create the throwaway project (the only way to reach the delete
    // confirmation). Lands on the project detail route. ---
    await page.goto(`/dashboard/${organizationId}/projects`);
    await expect(createProjectButton(page)).toBeVisible({ timeout: 60_000 });
    await createProjectButton(page).click();

    const createDialog = page.getByRole('dialog', {
      name: t('projects.create.title'),
    });
    await expect(createDialog).toBeVisible({ timeout: 60_000 });
    await createDialog
      .getByRole('textbox', { name: t('projects.create.nameLabel') })
      .fill(projectName);
    await dialogButton(createDialog, t('projects.create.submit')).click();
    await page.waitForURL(
      new RegExp(`/dashboard/${organizationId}/projects/[A-Za-z0-9]{16,}`),
      { timeout: 60_000 },
    );

    // --- Back to the list; open the throwaway's delete dialog from its row. ---
    await page.goto(`/dashboard/${organizationId}/projects`);
    const projectRow = page.getByRole('row').filter({ hasText: projectName });
    await expect(projectRow).toBeVisible({ timeout: 60_000 });

    await projectRow
      .getByRole('button', { name: t('common.actions.openMenu') })
      .click();
    await page
      .getByRole('menuitem', { name: t('projects.rowActions.delete') })
      .click();

    const deleteDialog = page.getByRole('dialog', {
      name: t('projects.settings.deleteDialogTitle'),
    });
    await expect(deleteDialog).toBeVisible({ timeout: 30_000 });

    const deleteButton = dialogButton(
      deleteDialog,
      t('projects.settings.deleteSubmit'),
    );

    // Detach mode (default): the delete button is ENABLED immediately — no
    // confirmation phrase required.
    await expect(deleteButton).toBeEnabled();

    // Checking the cascade checkbox switches to hard-delete and GATES the button
    // behind the typed project name (`disableDelete={!phraseSatisfied}`).
    await deleteDialog
      .getByText(t('projects.settings.deleteCascadeCheckbox'))
      .click();
    await expect(deleteButton).toBeDisabled();

    // The confirm input appears; a WRONG phrase keeps the button DISABLED.
    const confirmInput = deleteDialog.getByLabel(
      t('projects.settings.deleteConfirmPhrase'),
    );
    await expect(confirmInput).toBeVisible({ timeout: 20_000 });
    await confirmInput.fill('not the project name');
    await expect(deleteButton).toBeDisabled();

    // Typing the exact project name satisfies the phrase → button ENABLED
    // (proving the gate). We do NOT click it — cancelling instead so no cascade
    // delete fires; the throwaway is removed below via the normal detach path.
    await confirmInput.fill(projectName);
    await expect(deleteButton).toBeEnabled({ timeout: 20_000 });

    await dialogButton(deleteDialog, t('common.actions.cancel')).click();
    await expect(deleteDialog).toBeHidden({ timeout: 20_000 });

    // The project still exists (we cancelled the gated cascade delete).
    await expect(
      page.getByRole('row').filter({ hasText: projectName }),
    ).toBeVisible({ timeout: 30_000 });

    // --- Clean up: delete the throwaway via the normal detach path (default,
    // no phrase) so the spec leaves zero residue on the shared org. ---
    await projectRow
      .getByRole('button', { name: t('common.actions.openMenu') })
      .click();
    await page
      .getByRole('menuitem', { name: t('projects.rowActions.delete') })
      .click();

    const cleanupDialog = page.getByRole('dialog', {
      name: t('projects.settings.deleteDialogTitle'),
    });
    await expect(cleanupDialog).toBeVisible({ timeout: 30_000 });
    // Detach mode (cascade unchecked) — the delete button is enabled with no
    // phrase, so this removes the throwaway cleanly.
    await dialogButton(
      cleanupDialog,
      t('projects.settings.deleteSubmit'),
    ).click();

    await expect(
      page.getByText(t('projects.settings.deleteSuccess')).first(),
    ).toBeVisible({ timeout: 30_000 });
    await expect(
      page.getByRole('row').filter({ hasText: projectName }),
    ).toHaveCount(0, { timeout: 30_000 });
  });
});
