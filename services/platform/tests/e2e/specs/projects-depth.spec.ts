import { type Locator, type Page } from '@playwright/test';

import { ENTITY_ID, TIMEOUT } from '../helpers/env';
import { test, expect } from '../helpers/fixtures';
import { reloadAndSettle } from '../helpers/forms';
import { t } from '../helpers/i18n';

/**
 * Projects depth — three focused flows (settings/rename, secrets CRUD, task
 * live-edit), each in its own throwaway project so they're order-independent.
 * The tab-strip Save/Discard cluster is shared by the Overview + Instructions
 * editors; several create surfaces share a label, so locators scope to the open
 * dialog.
 */

/** The tab-strip Save button (shared Save/Discard cluster); filter to visible. */
function visibleSaveButton(page: Page): Locator {
  return page
    .getByRole('button', { name: t('common.actions.save'), exact: true })
    .filter({ visible: true });
}

/** Create a throwaway project and return its detail-route base path. */
async function createProject(
  page: Page,
  organizationId: string,
  name: string,
): Promise<string> {
  await page.goto(`/dashboard/${organizationId}/projects`);
  const createButton = page
    .getByRole('button', { name: t('projects.list.createButton') })
    .first();
  await expect(createButton).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  await createButton.click();

  const createDialog = page.getByRole('dialog', {
    name: t('projects.create.title'),
  });
  await expect(createDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await createDialog
    .getByRole('textbox', { name: t('projects.create.nameLabel') })
    .fill(name);
  await createDialog
    .getByRole('button', { name: t('projects.create.submit') })
    .click();

  await page.waitForURL(
    new RegExp(`/dashboard/${organizationId}/projects/${ENTITY_ID}`),
    { timeout: TIMEOUT.NAV },
  );
  const projectId = new RegExp(`/projects/(${ENTITY_ID})`).exec(
    page.url(),
  )?.[1];
  expect(projectId, 'a project id should appear in the URL').toBeTruthy();
  return `/dashboard/${organizationId}/projects/${projectId}`;
}

/** Delete the project by its current (possibly renamed) row name. */
async function deleteProject(
  page: Page,
  organizationId: string,
  name: string,
): Promise<void> {
  await page.goto(`/dashboard/${organizationId}/projects`);
  const row = page.getByRole('row').filter({ hasText: name });
  await expect(row).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await row.getByRole('button', { name: t('common.actions.openMenu') }).click();
  await page
    .getByRole('menuitem', { name: t('projects.rowActions.delete') })
    .click();

  const deleteDialog = page.getByRole('dialog', {
    name: t('projects.settings.deleteDialogTitle'),
  });
  await expect(deleteDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await deleteDialog
    .getByRole('button', { name: t('projects.settings.deleteSubmit') })
    .click();
  await expect(page.getByRole('row').filter({ hasText: name })).toHaveCount(0, {
    timeout: TIMEOUT.PERSIST,
  });
}

/** Open the task (board card or list row) and wait for its edit dialog (named
 *  by the task title — an sr-only DialogTitle in edit mode). */
async function openTask(page: Page, title: string): Promise<Locator> {
  await page.getByText(title).first().click();
  const dialog = page.getByRole('dialog', { name: title });
  await expect(dialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  return dialog;
}

test('project settings: rename + instructions persist across reloads', async ({
  page,
  org,
}) => {
  const { organizationId } = org;
  const suffix = Date.now().toString(36);
  const projectName = `E2E Settings ${suffix}`;
  const renamedName = `E2E Settings Renamed ${suffix}`;
  const instructionsText = `Project instructions for the depth E2E run ${suffix}.`;
  const base = await createProject(page, organizationId, projectName);

  try {
    // Instructions: edit → arm the tab-strip Save → save → reload → assert the
    // field rehydrated from the backend (the editor toasts only on error).
    // Target the textarea by role: its titled settings section is a region
    // labelled by the same text, so getByLabel would resolve to both.
    await page.goto(`${base}/instructions`);
    const instructionsField = page.getByRole('textbox', {
      name: t('projects.instructions.label'),
      exact: true,
    });
    await expect(instructionsField).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await instructionsField.fill(instructionsText);

    const saveInstructions = visibleSaveButton(page);
    await expect(saveInstructions).toBeEnabled({ timeout: TIMEOUT.VISIBLE });
    await saveInstructions.click();

    // Commit gate: the instructions editor toasts only on error, so gate on the
    // tab-strip Save going disabled — the form editor flips `isDirty` false the
    // instant the save mutation resolves, which disables Save. Without this the
    // reload aborts the in-flight save and the field rehydrates to its original
    // (empty) value.
    await expect(saveInstructions).toBeDisabled({ timeout: TIMEOUT.VISIBLE });

    const reloadedInstructions = page.getByRole('textbox', {
      name: t('projects.instructions.label'),
      exact: true,
    });
    await reloadAndSettle(page, reloadedInstructions);
    await expect(reloadedInstructions).toHaveValue(instructionsText, {
      timeout: TIMEOUT.PERSIST,
    });

    // Rename (settings folded into General): edit → save → reload → assert.
    // The bare project URL now forwards to Tasks, so target General directly.
    await page.goto(`${base}/overview`);
    // Target the input by role: the identity fields are settings field rows,
    // whose wrapper div is named by the same label text, so getByLabel could
    // resolve to the div instead of the control.
    const nameField = page.getByRole('textbox', {
      name: t('projects.settings.name'),
      exact: true,
    });
    await expect(nameField).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await expect(nameField).toHaveValue(projectName, {
      timeout: TIMEOUT.VISIBLE,
    });
    await nameField.fill(renamedName);

    const saveRename = visibleSaveButton(page);
    await expect(saveRename).toBeEnabled({ timeout: TIMEOUT.VISIBLE });
    await saveRename.click();

    // Commit gate: wait for the Save cluster to settle BEFORE reloading — the
    // reload otherwise aborts the in-flight save mutation and the reloaded
    // field rehydrates to the original (pre-rename) name. The page toasts
    // nothing on success; the cluster flashes "Saved" and then settles back to
    // a DISABLED "Save" once the form is clean again, which is the stable
    // commit signal (a failed save leaves the form dirty and the button
    // enabled). `visibleSaveButton` matches the label exactly, so it can't
    // match the in-flight "Saving…" or the "Saved" flash.
    await expect(saveRename).toBeDisabled({ timeout: TIMEOUT.VISIBLE });

    const reloadedName = page.getByRole('textbox', {
      name: t('projects.settings.name'),
      exact: true,
    });
    await reloadAndSettle(page, reloadedName);
    await expect(reloadedName).toHaveValue(renamedName, {
      timeout: TIMEOUT.PERSIST,
    });
  } finally {
    await deleteProject(page, organizationId, renamedName);
  }
});

test('project secrets: create then delete an API-key secret', async ({
  page,
  org,
}) => {
  const { organizationId } = org;
  const suffix = Date.now().toString(36);
  const projectName = `E2E Secrets ${suffix}`;
  const secretName = `E2E_DEPTH_SECRET_${suffix.toUpperCase()}`;
  const base = await createProject(page, organizationId, projectName);

  try {
    await page.goto(`${base}/secrets`);
    await expect(
      page.getByRole('heading', { name: t('projectSecrets.title') }).first(),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    // The tab embeds the shared env-var editor in forceSecret mode: "Add
    // variable" appends an inline table row (no dialog), the NAME/value
    // inputs are placeholder-labelled, and Save commits pending rows. A
    // fresh project has no secrets, so this row's inputs are unique — and
    // stay the anchor throughout: the secret NAME lives in the key input's
    // VALUE, which text-content filters (hasText) can never see.
    await page
      .getByRole('button', { name: t('envEditor.add'), exact: true })
      .click();
    const keyInput = page.getByPlaceholder(t('envEditor.keyPlaceholder'));
    await keyInput.fill(secretName);
    await page
      .getByPlaceholder(t('envEditor.valuePlaceholder'))
      .fill('tale-e2e-depth-secret-value');
    await page
      .getByRole('button', { name: t('envEditor.save'), exact: true })
      .click();

    // Saved: the editor re-renders the secret from the backend as a masked
    // row whose key input still holds the name.
    await expect(keyInput).toHaveValue(secretName, {
      timeout: TIMEOUT.PERSIST,
    });

    // Remove the row (its icon button is the only Remove on the page until
    // the confirm dialog opens) and confirm through the delete dialog.
    await page
      .getByRole('button', { name: t('envEditor.remove'), exact: true })
      .click();
    const removeDialog = page.getByRole('dialog', {
      name: t('envEditor.confirmRemoveTitle'),
    });
    await expect(removeDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await removeDialog
      .getByRole('button', { name: t('envEditor.remove'), exact: true })
      .click();
    await expect(keyInput).toHaveCount(0, { timeout: TIMEOUT.PERSIST });
  } finally {
    await deleteProject(page, organizationId, projectName);
  }
});

test('task live-edit: status/priority/label persist across board and list', async ({
  page,
  org,
}) => {
  const { organizationId } = org;
  const suffix = Date.now().toString(36);
  const projectName = `E2E TaskEdit ${suffix}`;
  const taskTitle = `E2E Depth Task ${suffix}`;
  const base = await createProject(page, organizationId, projectName);
  const removeFeatureLabel = `${t('common.actions.delete')} feature`;

  try {
    // Create the task on the board.
    await page.goto(`${base}/tasks/board`);
    await page.getByRole('button', { name: t('tasks.actions.create') }).click();
    const createDialog = page.getByRole('dialog', {
      name: t('tasks.actions.create'),
    });
    await expect(createDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await createDialog
      .getByRole('textbox', { name: t('tasks.fields.title') })
      .fill(taskTitle);
    await createDialog
      .getByRole('button', { name: t('tasks.actions.create') })
      .click();
    await expect(createDialog).toBeHidden({ timeout: TIMEOUT.PERSIST });
    await expect(page.getByText(taskTitle).first()).toBeVisible({
      timeout: TIMEOUT.VISIBLE,
    });

    // Edit mode fires a mutation per change (no Save button).
    let taskDialog = await openTask(page, taskTitle);

    // Status → "In progress" (scope to the picker's listbox; option rows echo
    // their label in a trailing badge, so match non-exact).
    await taskDialog
      .getByRole('button', { name: t('tasks.fields.status'), exact: true })
      .click();
    await page
      .getByRole('listbox', { name: t('tasks.fields.status') })
      .getByRole('option', { name: t('tasks.status.in_progress') })
      .click();
    await expect(
      taskDialog.getByText(t('tasks.status.in_progress')).first(),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    // Priority → "High" (the icon exposes its localized label via aria-label).
    await taskDialog
      .getByRole('button', { name: t('tasks.fields.priority'), exact: true })
      .click();
    await page
      .getByRole('listbox', { name: t('tasks.fields.priority') })
      .getByRole('option', { name: t('tasks.priority.p1') })
      .click();
    await expect(
      taskDialog.getByLabel(t('tasks.priority.p1')).first(),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    // Label → add the predefined project-scoped "feature" label (renders
    // lowercase in the DOM; the added chip carries a "<delete> feature" button).
    await taskDialog
      .getByRole('button', { name: t('tasks.labels.add'), exact: true })
      .click();
    await page.getByRole('option', { name: 'feature' }).click();

    // The label picker is a MODAL popover: while it's open Radix marks the
    // underlying task dialog `aria-hidden`, so the just-added chip's remove
    // button is pulled out of the a11y tree and can't be matched. Dismiss the
    // picker first (its search input is the tell), THEN assert the chip — the
    // label mutation already persisted on the pick.
    const labelSearch = page.getByRole('textbox', {
      name: t('tasks.labels.add'),
    });
    await expect(labelSearch).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await page.keyboard.press('Escape');
    await expect(labelSearch).toBeHidden({ timeout: TIMEOUT.VISIBLE });

    await expect(
      taskDialog.getByRole('button', { name: removeFeatureLabel }),
    ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

    // Close the task modal. Mutations already persisted.
    await page.keyboard.press('Escape');
    await expect(taskDialog).toBeHidden({ timeout: TIMEOUT.VISIBLE });

    // Persistence in BOTH views: reload each, reopen, read back from the server.
    for (const view of ['board', 'list'] as const) {
      await page.goto(`${base}/tasks/${view}`);
      await expect(page.getByText(taskTitle).first()).toBeVisible({
        timeout: TIMEOUT.VISIBLE,
      });
      taskDialog = await openTask(page, taskTitle);
      await expect(
        taskDialog.getByText(t('tasks.status.in_progress')).first(),
      ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
      await expect(
        taskDialog.getByLabel(t('tasks.priority.p1')).first(),
      ).toBeVisible();
      await expect(
        taskDialog.getByRole('button', { name: removeFeatureLabel }),
      ).toBeVisible();
      await page.keyboard.press('Escape');
      await expect(taskDialog).toBeHidden({ timeout: TIMEOUT.VISIBLE });
    }
  } finally {
    await deleteProject(page, organizationId, projectName);
  }
});
