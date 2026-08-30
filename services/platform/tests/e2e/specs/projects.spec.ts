import { ENTITY_ID, TIMEOUT } from '../helpers/env';
import { test, expect } from '../helpers/fixtures';
import { t } from '../helpers/i18n';

/**
 * Projects smoke: create a project, confirm a task shows in both the board and
 * list views, move a backlog proposal through the shared status picker, then
 * delete the project (cascade-removes its tasks — there is no per-task delete
 * affordance in the UI). Several create surfaces share the
 * "Create project"/"Create task" label, so locators scope to the open dialog
 * and use the button role.
 */

test('creates a project with a task shown in both views, then deletes it', async ({
  page,
  org,
}) => {
  const { organizationId } = org;
  const suffix = Date.now().toString(36);
  const projectName = `E2E Project ${suffix}`;
  const taskTitle = `E2E Task ${suffix}`;

  // The header "Create project" action renders in both the populated list and
  // the empty state, so `.first()` pins it and its visibility means the list
  // settled.
  await page.goto(`/dashboard/${organizationId}/projects`);
  const createProjectButton = page
    .getByRole('button', { name: t('projects.list.createButton') })
    .first();
  await expect(createProjectButton).toBeVisible({
    timeout: TIMEOUT.FIRST_PAINT,
  });
  await createProjectButton.click();

  const createDialog = page.getByRole('dialog', {
    name: t('projects.create.title'),
  });
  await expect(createDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await createDialog
    .getByRole('textbox', { name: t('projects.create.nameLabel') })
    .fill(projectName);
  await createDialog
    .getByRole('button', { name: t('projects.create.submit') })
    .click();

  // Creation navigates straight to the project detail route.
  await page.waitForURL(
    new RegExp(`/dashboard/${organizationId}/projects/${ENTITY_ID}`),
    { timeout: TIMEOUT.NAV },
  );
  // The adaptive header renders the project name twice — once in the desktop
  // header strip (`hidden md:flex`) and once in the mobile nav slot
  // (`md:hidden`), which sits first in the DOM. On the desktop viewport the
  // mobile copy is hidden, so `.first()` alone would pin the hidden one;
  // filter to the visible (desktop) instance.
  await expect(
    page.getByText(projectName).filter({ visible: true }).first(),
  ).toBeVisible({
    timeout: TIMEOUT.VISIBLE,
  });
  const projectId = new RegExp(`/projects/(${ENTITY_ID})`).exec(
    page.url(),
  )?.[1];
  expect(projectId, 'a project id should appear in the URL').toBeTruthy();

  // Create a task on the explicit board route (the bare /tasks alias redirects
  // to whichever view persisted last; the explicit route is deterministic).
  const boardUrl = `/dashboard/${organizationId}/projects/${projectId}/tasks/board`;
  await page.goto(boardUrl);

  const newTaskButton = page.getByRole('button', {
    name: t('tasks.actions.create'),
  });
  await expect(newTaskButton).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await newTaskButton.click();

  const taskDialog = page.getByRole('dialog', {
    name: t('tasks.actions.create'),
  });
  await expect(taskDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await taskDialog
    .getByRole('textbox', { name: t('tasks.fields.title') })
    .fill(taskTitle);
  await taskDialog
    .getByRole('button', { name: t('tasks.actions.create') })
    .click();
  await expect(taskDialog).toBeHidden({ timeout: TIMEOUT.PERSIST });

  // The task shows on the board, on the list, and back on the board.
  await expect(page.getByText(taskTitle).first()).toBeVisible({
    timeout: TIMEOUT.VISIBLE,
  });
  await page.goto(boardUrl.replace('/tasks/board', '/tasks/list'));
  await expect(page.getByText(taskTitle).first()).toBeVisible({
    timeout: TIMEOUT.VISIBLE,
  });
  await page.goto(boardUrl);
  await expect(page.getByText(taskTitle).first()).toBeVisible({
    timeout: TIMEOUT.VISIBLE,
  });

  // Backlog tasks use the same board/list surfaces as every other status — they
  // appear in the leftmost lane/section and move via drag or the status picker.
  const backlogTitle = `E2E Backlog ${suffix}`;
  await newTaskButton.click();
  await expect(taskDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await taskDialog
    .getByRole('textbox', { name: t('tasks.fields.title') })
    .fill(backlogTitle);
  await taskDialog
    .getByRole('button', { name: t('tasks.fields.status'), exact: true })
    .click();
  await page
    .getByRole('listbox', { name: t('tasks.fields.status') })
    .getByRole('option', { name: t('tasks.status.backlog') })
    .click();
  await taskDialog
    .getByRole('button', { name: t('tasks.actions.create') })
    .click();
  await expect(taskDialog).toBeHidden({ timeout: TIMEOUT.PERSIST });

  await expect(page.getByText(backlogTitle).first()).toBeVisible({
    timeout: TIMEOUT.VISIBLE,
  });

  // Promote the proposal through the shared status picker (no backlog-only verbs).
  await page.getByText(backlogTitle).first().click();
  const backlogDetail = page.getByRole('dialog').filter({
    hasText: backlogTitle,
  });
  await expect(backlogDetail).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await backlogDetail
    .getByRole('button', { name: t('tasks.fields.status'), exact: true })
    .click();
  await page
    .getByRole('listbox', { name: t('tasks.fields.status') })
    .getByRole('option', { name: t('tasks.status.todo') })
    .click();
  await backlogDetail
    .getByRole('button', { name: t('common.actions.close') })
    .click();
  await expect(backlogDetail).toBeHidden({ timeout: TIMEOUT.PERSIST });

  await expect(page.getByText(backlogTitle).first()).toBeVisible({
    timeout: TIMEOUT.VISIBLE,
  });

  // Clean up: delete the project (cascade-removes its task) via the row menu.
  await page.goto(`/dashboard/${organizationId}/projects`);
  const projectRow = page.getByRole('row').filter({ hasText: projectName });
  await expect(projectRow).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await projectRow
    .getByRole('button', { name: t('common.actions.openMenu') })
    .click();
  await page
    .getByRole('menuitem', { name: t('projects.rowActions.delete') })
    .click();

  // The delete dialog defaults to detach mode (no confirm phrase needed).
  const deleteDialog = page.getByRole('dialog', {
    name: t('projects.settings.deleteDialogTitle'),
  });
  await expect(deleteDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await deleteDialog
    .getByRole('button', { name: t('projects.settings.deleteSubmit') })
    .click();

  await expect(
    page.getByRole('row').filter({ hasText: projectName }),
  ).toHaveCount(0, { timeout: TIMEOUT.PERSIST });
});
