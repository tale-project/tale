import { expect, test, type Locator, type Page } from '@playwright/test';

import { t } from '../helpers/i18n';
import { readRunContext } from '../helpers/test-context';

/**
 * Projects DEPTH flow (wave 2). The wave-1 `projects.spec.ts` smoke proves the
 * basic create → task → delete happy path; this spec drives the sub-features
 * that smoke leaves untouched, all inside ONE throwaway project:
 *
 *  - Instructions tab — type project instructions, Save via the tab-strip
 *    Save/Discard cluster, reload, assert the textarea rehydrates from the
 *    backend (the instructions editor toasts only on error, so persistence —
 *    not a toast — is the assertion).
 *  - Secrets tab — create a uniquely-named API-key secret through the Add-secret
 *    dialog, assert it appears in the list, then delete it (back to empty).
 *  - Settings (folded into Overview) — rename the project through the Overview
 *    identity form, Save, assert the success toast, reload, assert the new name.
 *  - Task editing — create a task, open it, then EDIT it live (the edit modal
 *    fires a mutation per change, no Save): change status, set priority, and add
 *    a project-scoped label. Assert each change persists by reopening the task in
 *    BOTH the board and list views and reading it back from the server.
 *  - Files / Agents / Threads / Metrics tabs — assert each renders its primary
 *    section + affordance; the Agents tab gets a real mutate (attach the seeded
 *    "E2E Assistant" agent, Save, assert the toast).
 *
 * Then the project is deleted (cascade-removes the task, the secret was already
 * removed, and the project-scoped label colour override goes with it).
 *
 * Idempotency: one uniquely-named project per run (`Date.now().toString(36)`),
 * a uniquely-named secret, and the project delete at the end is the catch-all
 * cleanup. Nothing shared is mutated. Runs as the pre-authenticated owner
 * (chromium storageState); the locale is pinned to en-US so `t()` resolves.
 *
 * Every visible string comes from `t()` against `messages/en.json`. Several
 * surfaces share a label — the list/dialog "Create project", the task modal's
 * "Create task" heading + submit, the secrets dialog's "Add secret" title +
 * trigger — so locators scope to the open dialog and use the button role.
 *
 * Hermetic note: project file UPLOAD drives RAG ingestion (embeddings), which
 * the mock-LLM stack does not provide, so the Files tab is asserted at the
 * render + upload-affordance level only — see the Files step.
 */

// Seeded fixture agent, defined in
// `fixtures/config/default/agents/chat-agent.json`. Its `displayName` is what
// the Agents-tab picker lists. A fixture literal (rename-safety), so it stays a
// local constant rather than going through `t()` — same convention as
// `settings.spec.ts`/`agents.spec.ts`.
const SEEDED_AGENT_DISPLAY_NAME = 'E2E Assistant';

/** The always-present "Create project" action button on the list page (the
 *  header action renders before any empty-state copy, so `.first()` pins it). */
function createProjectButton(page: Page): Locator {
  return page
    .getByRole('button', { name: t('projects.list.createButton') })
    .first();
}

/** Extract the project id segment from the current detail URL. */
function projectIdFromUrl(page: Page): string {
  const match = /\/projects\/([A-Za-z0-9]{16,})/.exec(page.url());
  if (!match) {
    throw new Error(`No project id in URL: ${page.url()}`);
  }
  return match[1];
}

/**
 * The tab-strip Save button (shared Save/Discard cluster registered by the
 * Overview + Instructions editors via `useRegisterActiveEditor`). Its icon is
 * decorative; the accessible name is `common.actions.save`. Filter to the
 * visible node in case a mobile/desktop variant ever doubles it up.
 */
function visibleSaveButton(page: Page): Locator {
  return page
    .getByRole('button', { name: t('common.actions.save'), exact: true })
    .filter({ visible: true });
}

/** Open the task whose card/row carries `title` (board card or list row both
 *  open the same edit modal on click), then wait for the edit dialog — whose
 *  accessible name is the task title (an sr-only DialogTitle in edit mode). */
async function openTask(page: Page, title: string): Promise<Locator> {
  await page.getByText(title).first().click();
  const dialog = page.getByRole('dialog', { name: title });
  await expect(dialog).toBeVisible({ timeout: 60_000 });
  return dialog;
}

test('exercises a project in depth (instructions, secrets, rename, task edit, tabs) then deletes it', async ({
  page,
}) => {
  const { organizationId } = readRunContext();
  const suffix = Date.now().toString(36);
  const projectName = `E2E Depth ${suffix}`;
  // The auto-derived key (deriveProjectKey takes only each word's first letter:
  // "E2E Depth <suffix>" → "EDL") drops the suffix, so every run would collide on
  // the same key in the SHARED org → PROJECT_KEY_TAKEN. Supply an explicit unique
  // key from the suffix's fast-changing low-order base36 digits, with a fixed
  // letter prefix so it always satisfies isValidProjectKey (/^[A-Z][A-Z0-9]{1,5}$/):
  // uppercase, alnum-only, letter-start, length 6.
  const projectKey = `E${suffix.slice(-5)}`.toUpperCase();
  const renamedProjectName = `E2E Depth Renamed ${suffix}`;
  const taskTitle = `E2E Depth Task ${suffix}`;
  const secretName = `E2E_DEPTH_SECRET_${suffix.toUpperCase()}`;
  const instructionsText = `Project instructions for the depth E2E run ${suffix}.`;

  // ── Create the throwaway project ─────────────────────────────────────────
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
  // Override the auto-derived (collision-prone) key with our unique one. Filling
  // this field flips the dialog's keyEditedRef true, so the name-derivation
  // effect no longer overwrites it. The value is already normalized, so the
  // dialog's onChange normalize is a no-op.
  await createDialog
    .getByLabel(t('projects.create.keyLabel'), { exact: true })
    .fill(projectKey);
  await createDialog
    .getByRole('button', { name: t('projects.create.submit') })
    .click();

  await page.waitForURL(
    new RegExp(`/dashboard/${organizationId}/projects/[A-Za-z0-9]{16,}`),
    { timeout: 60_000 },
  );
  const projectId = projectIdFromUrl(page);
  const base = `/dashboard/${organizationId}/projects/${projectId}`;

  // ── Instructions tab: edit → Save → reload → assert persistence ──────────
  await page.goto(`${base}/instructions`);
  const instructionsField = page.getByLabel(t('projects.instructions.label'), {
    exact: true,
  });
  await expect(instructionsField).toBeVisible({ timeout: 60_000 });
  await instructionsField.fill(instructionsText);

  // Editing arms the tab-strip Save cluster (the editor has no own Save button).
  const saveInstructions = visibleSaveButton(page);
  await expect(saveInstructions).toBeEnabled({ timeout: 20_000 });
  await saveInstructions.click();

  // The instructions editor surfaces no success toast (it toasts only on
  // error). `click()` only awaits the event dispatch, not the async mutation,
  // so reloading immediately would race the in-flight write and discard it.
  // The cluster's Save button flips to a "Saved" indicator only after the
  // mutation resolves (`EditorActions` flashes it on `save_success`), so wait
  // for that before reloading, then read the value back from the backend.
  await expect(
    page.getByRole('button', {
      name: t('common.actions.saved'),
      exact: true,
    }),
  ).toBeVisible({ timeout: 20_000 });
  await page.reload();
  const reloadedInstructions = page.getByLabel(
    t('projects.instructions.label'),
    { exact: true },
  );
  await expect(reloadedInstructions).toBeVisible({ timeout: 60_000 });
  await expect(reloadedInstructions).toHaveValue(instructionsText, {
    timeout: 20_000,
  });

  // ── Secrets tab: create a unique secret → appears in list → delete it ────
  await page.goto(`${base}/secrets`);
  await expect(
    page.getByRole('heading', { name: t('projectSecrets.title') }).first(),
  ).toBeVisible({ timeout: 60_000 });

  await page
    .getByRole('button', { name: t('projectSecrets.addButton') })
    .click();
  const secretDialog = page.getByRole('dialog', {
    name: t('projectSecrets.addButton'),
  });
  await expect(secretDialog).toBeVisible({ timeout: 60_000 });
  // Type defaults to "API key"; the name field upper-cases as you type (the
  // backend stores upper-cased env-var names), so we feed an already-upper name.
  // Both fields are `required`, so `Label` renders a `*` whose ARIA `aria-label`
  // is `common.aria.required` — making each input's *accessible name* the
  // composed "Namerequired" / "API keyrequired" (the role-name honours the span's
  // aria-label). We match by ROLE here, not `getByLabel`: Playwright's
  // `getByLabel` resolves the `<label>` via `elementText`, which reads the
  // VISIBLE "*" (not the aria-label), so the composed name never matches there —
  // that mismatch is exactly what stalled the earlier `getByLabel` attempt.
  const requiredMarker = t('common.aria.required');
  await secretDialog
    .getByRole('textbox', {
      name: `${t('projectSecrets.nameLabel')}${requiredMarker}`,
      exact: true,
    })
    .fill(secretName);
  await secretDialog
    .getByRole('textbox', {
      name: `${t('projectSecrets.apiKeyValueLabel')}${requiredMarker}`,
      exact: true,
    })
    .fill('tale-e2e-depth-secret-value');
  // The FormDialog submit defaults to `common.actions.save`. Saving a secret is
  // a Convex ACTION (encrypt-then-upsert) which — unlike a mutation — is NOT
  // re-sent when the WS drops mid-flight; the CI backend intermittently 1011s
  // under load, losing the action and leaving the dialog open with no success
  // toast. Retry the submit until the dialog closes (success). The upsert is
  // keyed by (project, name), so a re-click cannot duplicate; the persisted row
  // asserted below is the durable success signal — the toast is too ephemeral
  // to depend on once the socket has blipped.
  const saveSecret = secretDialog.getByRole('button', {
    name: t('common.actions.save'),
    exact: true,
  });
  await expect(async () => {
    await saveSecret.click();
    await expect(secretDialog).toBeHidden({ timeout: 15_000 });
  }).toPass({ timeout: 90_000 });

  // The new secret shows in the list (font-mono name). Scope the delete to its
  // row so we never touch another secret.
  const secretRow = page.getByRole('listitem').filter({ hasText: secretName });
  await expect(secretRow).toBeVisible({ timeout: 20_000 });
  // Deleting is also a non-retried Convex action — if the WS drops mid-flight
  // the row stays. Retry the (idempotent) delete until the row is gone, the
  // durable signal, rather than the easily-missed success toast.
  const deleteSecret = secretRow.getByRole('button', {
    name: t('common.actions.delete'),
    exact: true,
  });
  await expect(async () => {
    if (await secretRow.count()) await deleteSecret.click();
    await expect(secretRow).toHaveCount(0, { timeout: 15_000 });
  }).toPass({ timeout: 90_000 });

  // ── Settings (folded into Overview): rename → Save → reload → assert ─────
  await page.goto(base);
  const nameField = page.getByLabel(t('projects.settings.name'), {
    exact: true,
  });
  await expect(nameField).toBeVisible({ timeout: 60_000 });
  await expect(nameField).toHaveValue(projectName, { timeout: 20_000 });
  await nameField.fill(renamedProjectName);

  const saveRename = visibleSaveButton(page);
  await expect(saveRename).toBeEnabled({ timeout: 20_000 });
  await saveRename.click();
  await expect(
    page.getByText(t('projects.settings.saveSuccess')).first(),
  ).toBeVisible({ timeout: 20_000 });

  await page.reload();
  const reloadedName = page.getByLabel(t('projects.settings.name'), {
    exact: true,
  });
  await expect(reloadedName).toBeVisible({ timeout: 60_000 });
  await expect(reloadedName).toHaveValue(renamedProjectName, {
    timeout: 20_000,
  });

  // ── Task editing: create, then live-edit status + priority + label ───────
  await page.goto(`${base}/tasks/board`);
  await page.getByRole('button', { name: t('tasks.actions.create') }).click();
  const taskCreateDialog = page.getByRole('dialog', {
    name: t('tasks.actions.create'),
  });
  await expect(taskCreateDialog).toBeVisible({ timeout: 60_000 });
  await taskCreateDialog
    .getByRole('textbox', { name: t('tasks.fields.title') })
    .fill(taskTitle);
  await taskCreateDialog
    .getByRole('button', { name: t('tasks.actions.create') })
    .click();
  await expect(taskCreateDialog).toBeHidden({ timeout: 30_000 });
  await expect(page.getByText(taskTitle).first()).toBeVisible({
    timeout: 60_000,
  });

  // Open the task for editing (edit mode = live mutations, no Save button).
  let taskDialog = await openTask(page, taskTitle);

  // (a) Status: pick "In progress" from the status picker (trigger aria-label
  // is `tasks.fields.status`). Each option row duplicates its label in a
  // trailing status badge, so its accessible name is "In progress In progress"
  // — match non-exact and scope to the picker's listbox (also aria-labelled
  // `Status`) so the substring can't drift to another control.
  await taskDialog
    .getByRole('button', { name: t('tasks.fields.status'), exact: true })
    .click();
  const statusListbox = page.getByRole('listbox', {
    name: t('tasks.fields.status'),
  });
  await statusListbox
    .getByRole('option', { name: t('tasks.status.in_progress') })
    .click();
  // The picker echoes the new status back as the trigger's badge (the activity
  // log can also mention it, so take the first match).
  await expect(
    taskDialog.getByText(t('tasks.status.in_progress')).first(),
  ).toBeVisible({ timeout: 20_000 });

  // (b) Priority: set "High". The icon exposes its localized label via
  // aria-label/title, so the change is assertable without reading a glyph; the
  // option row likewise duplicates its label in the trailing icon, so match
  // non-exact inside the priority listbox.
  await taskDialog
    .getByRole('button', { name: t('tasks.fields.priority'), exact: true })
    .click();
  const priorityListbox = page.getByRole('listbox', {
    name: t('tasks.fields.priority'),
  });
  await priorityListbox
    .getByRole('option', { name: t('tasks.priority.p1') })
    .click();
  await expect(
    taskDialog.getByLabel(t('tasks.priority.p1')).first(),
  ).toBeVisible({ timeout: 20_000 });

  // (c) Label: add the predefined project-scoped "feature" label via the
  // multi-select picker (labels render lowercase in the DOM, capitalized via
  // CSS). The option row nests a "Change color" button (also carrying the label
  // name), so match non-exact. Task labels are a TOGGLE (not removable chips) —
  // picking an option flips it to aria-selected; the chip then shows in the task
  // dialog and the reload below proves it persisted to the server.
  await taskDialog
    .getByRole('button', { name: t('tasks.labels.add'), exact: true })
    .click();
  const featureOption = page.getByRole('option', { name: 'feature' });
  await featureOption.click();
  await expect(featureOption).toHaveAttribute('aria-selected', 'true', {
    timeout: 20_000,
  });

  // The label picker stays open after a pick (multi-select). Dismiss it first
  // — its search input is its tell — then close the modal. The live mutations
  // have already persisted.
  const labelSearch = page.getByRole('textbox', {
    name: t('tasks.labels.add'),
  });
  await expect(labelSearch).toBeVisible({ timeout: 20_000 });
  await page.keyboard.press('Escape');
  await expect(labelSearch).toBeHidden({ timeout: 20_000 });
  await page.keyboard.press('Escape');
  await expect(taskDialog).toBeHidden({ timeout: 20_000 });

  // Persistence in the BOARD view: reload, reopen, assert status + priority +
  // label all came back from the server.
  await page.goto(`${base}/tasks/board`);
  await expect(page.getByText(taskTitle).first()).toBeVisible({
    timeout: 60_000,
  });
  taskDialog = await openTask(page, taskTitle);
  await expect(
    taskDialog.getByText(t('tasks.status.in_progress')).first(),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    taskDialog.getByLabel(t('tasks.priority.p1')).first(),
  ).toBeVisible();
  await expect(
    taskDialog.getByRole('button', {
      name: `${t('common.actions.delete')} feature`,
    }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(taskDialog).toBeHidden({ timeout: 20_000 });

  // Persistence in the LIST view: the same edits read back there too.
  await page.goto(`${base}/tasks/list`);
  await expect(page.getByText(taskTitle).first()).toBeVisible({
    timeout: 60_000,
  });
  taskDialog = await openTask(page, taskTitle);
  await expect(
    taskDialog.getByText(t('tasks.status.in_progress')).first(),
  ).toBeVisible({ timeout: 20_000 });
  await expect(
    taskDialog.getByLabel(t('tasks.priority.p1')).first(),
  ).toBeVisible();
  await expect(
    taskDialog.getByRole('button', {
      name: `${t('common.actions.delete')} feature`,
    }),
  ).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(taskDialog).toBeHidden({ timeout: 20_000 });

  // ── Files tab: render + upload affordance (upload itself needs RAG, skip) ─
  await page.goto(`${base}/files`);
  await expect(
    page.getByRole('heading', { name: t('projects.files.title') }).first(),
  ).toBeVisible({ timeout: 60_000 });
  // The drop-zone is labelled with the "Add file" affordance. Asserting it
  // renders is the hermetic boundary — actual ingestion drives embeddings,
  // which the mock-LLM stack doesn't provide.
  await expect(
    page.getByLabel(t('projects.files.addButton')).first(),
  ).toBeVisible({ timeout: 20_000 });

  // ── Threads tab: render + "New chat" affordance ──────────────────────────
  await page.goto(`${base}/threads`);
  await expect(
    page
      .getByRole('heading', { name: t('projects.threads.yourChats') })
      .first(),
  ).toBeVisible({ timeout: 60_000 });
  await expect(
    page
      .getByRole('button', { name: t('projects.overview.newChatCta') })
      .first(),
  ).toBeVisible({ timeout: 20_000 });

  // ── Metrics tab: render the page header + period switcher ────────────────
  await page.goto(`${base}/metrics`);
  await expect(
    page.getByRole('heading', { name: t('tasks.metrics.title'), level: 1 }),
  ).toBeVisible({ timeout: 60_000 });

  // ── Agents tab: render + real mutate (attach the seeded agent, Save) ─────
  await page.goto(`${base}/agents`);
  await expect(
    page
      .getByRole('heading', { name: t('projects.agents.agentsHeading') })
      .first(),
  ).toBeVisible({ timeout: 60_000 });

  // "Add agent" opens a searchable picker; pick the seeded agent by its display
  // name, then Save through the tab-strip cluster. The option's accessible name
  // is "<display name> <description>" (the row renders both), so match the
  // display-name substring rather than exact.
  await page
    .getByRole('button', { name: t('projects.agents.addAgent'), exact: true })
    .click();
  await page.getByRole('option', { name: SEEDED_AGENT_DISPLAY_NAME }).click();
  const saveAgents = visibleSaveButton(page);
  await expect(saveAgents).toBeEnabled({ timeout: 20_000 });
  await saveAgents.click();
  await expect(
    page.getByText(t('projects.agents.saveSuccess')).first(),
  ).toBeVisible({ timeout: 20_000 });

  // ── Clean up: delete the project (cascade-removes its task) ──────────────
  await page.goto(`/dashboard/${organizationId}/projects`);
  const projectRow = page
    .getByRole('row')
    .filter({ hasText: renamedProjectName });
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
  await deleteDialog
    .getByRole('button', { name: t('projects.settings.deleteSubmit') })
    .click();

  await expect(
    page.getByText(t('projects.settings.deleteSuccess')).first(),
  ).toBeVisible({ timeout: 30_000 });
  await expect(
    page.getByRole('row').filter({ hasText: renamedProjectName }),
  ).toHaveCount(0, { timeout: 30_000 });
});
