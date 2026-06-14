import { expect, test, type Page } from '@playwright/test';

import { t } from '../helpers/i18n';
import { readRunContext } from '../helpers/test-context';

/**
 * Projects & Tasks smoke flow against the pre-authenticated owner. Walks the
 * full happy path end to end: the projects list loads, a new project is
 * created (unique name → land on its detail page), the project sub-tabs render,
 * a task is created inside it and shown in both the board and list views, then
 * the project is deleted to keep the shared backend tidy across re-runs.
 *
 * Idempotency: every run creates a uniquely-named project (and task) so re-runs
 * never collide on the shared owner/org, and the spec deletes the project it
 * created at the end. Deleting the project cascade-removes its task — there is
 * no per-task delete affordance in the UI (verified: `useDeleteTask` /
 * `useArchiveTask` exist but are not wired to any task view or the task modal),
 * so the project delete IS the task cleanup.
 *
 * All visible labels resolve through `t()` from `messages/en.json`; the run is
 * pinned to `en-US`. Several create surfaces share a string — `projects.title`,
 * `projects.list.createButton`, `projects.create.title` and
 * `projects.create.submit` are all "Create project", and the task modal's
 * heading and its submit button are both "Create task" — so locators scope to
 * the open dialog and use the button role to stay unambiguous.
 */

// The eight project sub-tabs, in render order, as they appear in the detail
// header nav (`app/routes/dashboard/$id/projects/$projectId.tsx`). Settings is
// folded into Overview (no standalone tab); metrics is a sub-view of Tasks
// (no own tab). Each label comes from a different namespace, mirroring source.
function projectTabLabels(): string[] {
  return [
    t('projects.navigation.overview'),
    t('projects.navigation.threads'),
    t('tasks.title'),
    t('projects.navigation.instructions'),
    t('projects.navigation.files'),
    t('projects.navigation.agents'),
    t('projectSecrets.title'),
  ];
}

/** The always-present "Create project" action-menu button on the list page.
 *  When the list is empty a second identically-labelled button renders inside
 *  the empty state, so `.first()` pins the header action menu in either case
 *  (the header renders before the table body in DOM order). */
function createProjectButton(page: Page) {
  return page
    .getByRole('button', { name: t('projects.list.createButton') })
    .first();
}

test('creates a project with a task shown in both views, then deletes it', async ({
  page,
}) => {
  const { organizationId } = readRunContext();
  const suffix = Date.now().toString(36);
  const projectName = `E2E Project ${suffix}`;
  const taskTitle = `E2E Task ${suffix}`;

  // (a) Projects list loads — handle either an existing list or the empty
  // state. The "Create project" action button is rendered in both cases, so
  // its visibility is the reliable "list settled" signal.
  await page.goto(`/dashboard/${organizationId}/projects`);
  await expect(createProjectButton(page)).toBeVisible({ timeout: 60_000 });

  // (b) Create a NEW project with a unique name → land on its detail page.
  await createProjectButton(page).click();

  const createDialog = page.getByRole('dialog', {
    name: t('projects.create.title'),
  });
  await expect(createDialog).toBeVisible({ timeout: 60_000 });
  await createDialog
    .getByRole('textbox', { name: t('projects.create.nameLabel') })
    .fill(projectName);
  // The submit button shares its label with the list's action button behind
  // the dialog, so scope the click to the dialog.
  await createDialog
    .getByRole('button', { name: t('projects.create.submit') })
    .click();

  // Creation navigates straight to the project detail route.
  await page.waitForURL(
    new RegExp(`/dashboard/${organizationId}/projects/[A-Za-z0-9]{16,}`),
    { timeout: 60_000 },
  );

  // The detail header shows the new project's name and the sub-tab nav. Verify
  // every real sub-tab renders (scoped to the project nav so the assertion
  // never picks up a same-named link elsewhere in the shell).
  await expect(page.getByText(projectName).first()).toBeVisible({
    timeout: 60_000,
  });
  const projectNav = page.getByRole('navigation', {
    name: t('common.aria.projectsNavigation'),
  });
  await expect(projectNav).toBeVisible({ timeout: 60_000 });
  for (const label of projectTabLabels()) {
    await expect(projectNav.getByRole('link', { name: label })).toBeVisible();
  }

  // (c) Create a task inside the project. Go straight to the board view (the
  // bare /tasks alias redirects to the persisted view; navigating to the
  // explicit route is deterministic regardless of prior persistence).
  const boardUrl = `/dashboard/${organizationId}/projects/${projectIdFromUrl(page)}/tasks/board`;
  await page.goto(boardUrl);

  const newTaskButton = page.getByRole('button', {
    name: t('tasks.actions.create'),
  });
  await expect(newTaskButton).toBeVisible({ timeout: 60_000 });
  await newTaskButton.click();

  // The task modal opens (its accessible name is the "Create task" title).
  const taskDialog = page.getByRole('dialog', {
    name: t('tasks.actions.create'),
  });
  await expect(taskDialog).toBeVisible({ timeout: 60_000 });
  await taskDialog
    .getByRole('textbox', { name: t('tasks.fields.title') })
    .fill(taskTitle);
  // The footer Create button shares the dialog title's label — scope + role
  // disambiguate it from the heading.
  await taskDialog
    .getByRole('button', { name: t('tasks.actions.create') })
    .click();
  await expect(taskDialog).toBeHidden({ timeout: 30_000 });

  // The task card shows on the board.
  await expect(page.getByText(taskTitle).first()).toBeVisible({
    timeout: 60_000,
  });

  // Switch to the list view and confirm the same task appears there too.
  await page.goto(boardUrl.replace('/tasks/board', '/tasks/list'));
  await expect(page.getByText(taskTitle).first()).toBeVisible({
    timeout: 60_000,
  });

  // Switch back to the board view; the task is still shown.
  await page.goto(boardUrl);
  await expect(page.getByText(taskTitle).first()).toBeVisible({
    timeout: 60_000,
  });

  // (d) Clean up: delete the project we created (cascade-removes its task).
  // Delete lives in the project's 3-dot row menu on the list page.
  await page.goto(`/dashboard/${organizationId}/projects`);
  const projectRow = page.getByRole('row').filter({ hasText: projectName });
  await expect(projectRow).toBeVisible({ timeout: 60_000 });

  await projectRow
    .getByRole('button', { name: t('common.actions.openMenu') })
    .click();
  await page
    .getByRole('menuitem', { name: t('projects.rowActions.delete') })
    .click();

  // The delete dialog defaults to detach mode (cascade unchecked), so no
  // confirm phrase is required — the delete button is enabled immediately.
  const deleteDialog = page.getByRole('dialog', {
    name: t('projects.settings.deleteDialogTitle'),
  });
  await expect(deleteDialog).toBeVisible({ timeout: 30_000 });
  await deleteDialog
    .getByRole('button', { name: t('projects.settings.deleteSubmit') })
    .click();

  // Success toast confirms the delete, and the row drops out of the list.
  await expect(
    page.getByText(t('projects.settings.deleteSuccess')).first(),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole('row').filter({ hasText: projectName }),
  ).toHaveCount(0, { timeout: 30_000 });
});

/** Extract the project id segment from the current detail URL. */
function projectIdFromUrl(page: Page): string {
  const match = /\/projects\/([A-Za-z0-9]{16,})/.exec(page.url());
  if (!match) {
    throw new Error(`No project id in URL: ${page.url()}`);
  }
  return match[1];
}
