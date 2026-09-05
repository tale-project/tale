import { E2E_PASSWORD, signInViaApi } from '../helpers/auth';
import { BASE_URL, ENTITY_ID, TIMEOUT } from '../helpers/env';
import { test, expect } from '../helpers/fixtures';
import { t } from '../helpers/i18n';

/**
 * Return-loop surfaces ("what needs me back in Tale?"): the notification bell's
 * expand-to-modal + Recent⇄Priority sort, and the personal notification-preferences
 * page (round-trips the `collab.preferences` query/mutation). Backend correctness
 * of the attention query is covered by the unit tests in
 * `convex/collab/attention.test.ts`; this spec proves the user-visible wiring
 * end-to-end in a real browser.
 */

const SORT_LABEL = t('notifications.sortLabel');
const sortName = (mode: 'recent' | 'priority') =>
  `${SORT_LABEL}: ${mode === 'priority' ? t('notifications.sortPriority') : t('notifications.sortRecent')}`;

test('notification bell: sorts by priority and expands into a modal', async ({
  page,
  org,
}) => {
  const { organizationId } = org;
  await page.goto(`/dashboard/${organizationId}`);

  // The left-rail bell (desktop instance; the mobile-nav copy is `md:hidden`).
  const bell = page
    .getByRole('button', { name: t('navigation.notifications') })
    .filter({ visible: true })
    .first();
  await expect(bell).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  await bell.click();

  // The panel carries the sort toggle — defaults to "Most recent".
  const sortToggle = page.getByRole('button', { name: sortName('recent') });
  await expect(sortToggle).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await expect(sortToggle).toHaveAttribute('aria-pressed', 'false');

  // Flipping to Priority is the requested affordance: high-priority
  // notifications float up instead of living behind a separate "Needs you" tab.
  await sortToggle.click();
  const priorityToggle = page.getByRole('button', {
    name: sortName('priority'),
  });
  await expect(priorityToggle).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await expect(priorityToggle).toHaveAttribute('aria-pressed', 'true');

  // Expand the compact panel into the full modal. The expanded layout drops the
  // in-panel expand button, so its disappearance (with a dialog still present)
  // proves we switched surfaces rather than merely re-rendering the popover.
  const expand = page.getByRole('button', { name: t('notifications.expand') });
  await expect(expand).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await expand.click();

  await expect(page.getByRole('dialog')).toBeVisible({
    timeout: TIMEOUT.VISIBLE,
  });
  await expect(
    page.getByRole('button', { name: t('notifications.expand') }),
  ).toHaveCount(0, { timeout: TIMEOUT.VISIBLE });
  // The modal keeps its own sort control.
  await expect(
    page.getByRole('button', { name: new RegExp(`^${SORT_LABEL}:`) }),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
});

test('notification preferences: toggles a channel, persists, and restores', async ({
  page,
  org,
}) => {
  const { organizationId } = org;
  await page.goto(`/dashboard/${organizationId}/settings/notifications`);

  await expect(
    page.getByRole('heading', { name: t('notificationPreferences.title') }),
  ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  // "Agent escalations" defaults on (an undefined preference reads as
  // enabled; the digest row died with the workforce digest, the automation
  // alerts row with its 0.4 emitters). The switch's accessible name is its
  // row label (aria-labelledby).
  const digestName = t('notificationPreferences.fields.escalation.label');
  const digest = page.getByRole('switch', { name: digestName });
  await expect(digest).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await expect(digest).toBeChecked();

  // Turning it off writes through `setNotificationPreferences`; the reactive
  // Convex query flips the control back with no explicit Save button.
  await digest.click();
  await expect(digest).not.toBeChecked({ timeout: TIMEOUT.PERSIST });

  // Reload proves the write persisted (not just optimistic UI).
  await page.reload();
  const digestAfter = page.getByRole('switch', { name: digestName });
  await expect(digestAfter).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  await expect(digestAfter).not.toBeChecked({ timeout: TIMEOUT.PERSIST });

  // Restore the default so re-runs and other specs see a clean org.
  await digestAfter.click();
  await expect(digestAfter).toBeChecked({ timeout: TIMEOUT.PERSIST });
});

test('return loop: assigning a task notifies and calls back the assignee', async ({
  page,
  org,
  browser,
}) => {
  const { organizationId } = org;
  const suffix = Date.now().toString(36);
  const memberName = `RL Member ${suffix}`;
  const memberCreds = {
    email: `e2e-rl-member-${suffix}@tale.test`,
    password: E2E_PASSWORD,
  };
  const projectName = `RL Project ${suffix}`;
  const taskTitle = `RL Task ${suffix}`;

  // ── Owner provisions a second human (the future assignee) ─────────────────
  await page.goto(`/dashboard/${organizationId}/settings/members`);
  await page
    .getByRole('button', { name: t('settings.organization.addMember') })
    .click();
  const addDialog = page.getByRole('dialog', {
    name: t('dialogs.addMember.title'),
  });
  await expect(addDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await addDialog.getByLabel(t('settings.form.name')).fill(memberName);
  await addDialog.getByLabel(t('settings.form.email')).fill(memberCreds.email);
  await addDialog
    .getByRole('combobox', { name: t('settings.form.role') })
    .click();
  await page
    .getByRole('option', { name: t('settings.roles.member'), exact: true })
    .click();
  await addDialog
    .getByLabel(t('settings.form.password'), { exact: true })
    .fill(memberCreds.password);
  await addDialog
    .getByRole('button', { name: t('dialogs.addMember.title') })
    .click();
  await expect(
    page.getByText(t('toast.success.newMemberCreated.title')).first(),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

  // ── Owner creates a project + task ────────────────────────────────────────
  await page.goto(`/dashboard/${organizationId}/projects`);
  await page
    .getByRole('button', { name: t('projects.list.createButton') })
    .first()
    .click();
  const projectDialog = page.getByRole('dialog', {
    name: t('projects.create.title'),
  });
  await expect(projectDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await projectDialog
    .getByRole('textbox', { name: t('projects.create.nameLabel') })
    .fill(projectName);
  await projectDialog
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

  const boardUrl = `/dashboard/${organizationId}/projects/${projectId}/tasks/board`;
  await page.goto(boardUrl);
  await page.getByRole('button', { name: t('tasks.actions.create') }).click();
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
  await expect(page.getByText(taskTitle).first()).toBeVisible({
    timeout: TIMEOUT.VISIBLE,
  });

  // ── Owner assigns the task to the member — this fires the real
  //    `task_assigned` notification transactionally with the write ───────────
  await page
    .getByRole('button', { name: t('tasks.actions.assign'), exact: true })
    .click();
  await page.getByPlaceholder(t('tasks.assignee.search')).fill(memberName);
  await page.getByRole('option', { name: memberName }).click();
  // Commit gate: the card's assignee avatar reactively adopts the member's
  // name (its `aria-label`) once the assignment write lands.
  await expect(
    page.getByLabel(memberName, { exact: true }).first(),
  ).toBeVisible({ timeout: TIMEOUT.PERSIST });

  // ── The callback: the member, in their own session, is pulled back ────────
  const memberContext = await browser.newContext({ baseURL: BASE_URL });
  try {
    await signInViaApi(memberContext.request, memberCreds);
    const memberPage = await memberContext.newPage();
    await memberPage.goto(`/dashboard/${organizationId}`);

    // Admin-provisioned credentials must be rotated on first login.
    await memberPage.waitForURL(/\/forced-change-password\//, {
      timeout: TIMEOUT.FIRST_PAINT,
    });
    const rotated = `${E2E_PASSWORD}-r0!`;
    await memberPage
      .getByLabel(t('auth.changePassword.newPassword'), { exact: true })
      .fill(rotated);
    await memberPage
      .getByLabel(t('auth.changePassword.confirmPassword'), { exact: true })
      .fill(rotated);
    await memberPage
      .getByRole('button', { name: t('auth.forcedChange.submit') })
      .click();
    await memberPage.waitForURL(/\/dashboard\//, {
      timeout: TIMEOUT.FIRST_PAINT,
    });
    await memberPage.goto(`/dashboard/${organizationId}`);

    // The bell carries an unread badge; opening it shows the real assignment
    // notification, whose body names the task the member is now on the hook for.
    const bell = memberPage
      .getByRole('button', { name: t('navigation.notifications') })
      .filter({ visible: true })
      .first();
    await expect(bell).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
    await bell.click();
    await expect(memberPage.getByText(taskTitle).first()).toBeVisible({
      timeout: TIMEOUT.VISIBLE,
    });
  } finally {
    await memberContext.close();
  }

  // Clean up the throwaway project (cascade-removes its task).
  await page.goto(`/dashboard/${organizationId}/projects`);
  const row = page.getByRole('row').filter({ hasText: projectName });
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
  await expect(
    page.getByRole('row').filter({ hasText: projectName }),
  ).toHaveCount(0, { timeout: TIMEOUT.PERSIST });
});
