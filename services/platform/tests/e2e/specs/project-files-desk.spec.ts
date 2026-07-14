import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Page } from '@playwright/test';

import {
  automationName,
  gotoAutomationsHubAllTab,
  installWizardDialog,
  walkInstallWizard,
} from '../helpers/automations';
import { TIMEOUT } from '../helpers/env';
import { expect, test } from '../helpers/fixtures';
import { t } from '../helpers/i18n';

/**
 * Project-scoped automation desk — Files isolation + Project→Desk entry.
 *
 * Fixture: `project-files-desk-e2e` (thin status-flip workflow, no sandbox). On
 * the hermetic stack it is already in the pinned builtin catalog; against a
 * live `bun run dev` the spec uploads the zip when the catalog does not list it.
 *
 * Proves:
 *  1. Install Finish closes in place; the desk renders at its project VIEW URL.
 *  2. The project tab strip exposes the desk view as a first-class tab.
 *  3. Periods list is project-scoped (Acme never sees Beta's folders).
 *  4. `_setup` is excluded from Periods; Start stays hidden until it exists.
 *  5. Start creates a job visible on that project's Jobs tab only.
 */

const SLUG = 'project-files-desk-e2e';
const DESK_NAME = () => automationName(SLUG);

const dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ZIP = path.join(
  dirname,
  '..',
  'fixtures',
  'project-files-desk-e2e.zip',
);

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
    new RegExp(`/dashboard/${organizationId}/projects/[A-Za-z0-9]{16,}`),
    { timeout: TIMEOUT.NAV },
  );
  const projectId = /\/projects\/([A-Za-z0-9]{16,})/.exec(page.url())?.[1];
  if (!projectId) {
    throw new Error('expected a project id in the URL after create');
  }
  return projectId;
}

async function createRootFolder(
  page: Page,
  organizationId: string,
  projectId: string,
  folderName: string,
): Promise<void> {
  await page.goto(`/dashboard/${organizationId}/projects/${projectId}/files`);
  await expect(
    page.getByRole('heading', { name: t('projects.files.title') }),
  ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  // exact: true — the Files toolbar also exposes "New folder inside", which
  // substring-matches the same accessible name without it.
  await page
    .getByRole('button', { name: t('documents.folder.newFolder'), exact: true })
    .click();
  const dialog = page.getByRole('dialog', {
    name: t('documents.folder.createFolder'),
  });
  await expect(dialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await dialog
    .getByRole('textbox', { name: t('documents.folder.folderName') })
    .fill(folderName);
  await dialog
    .getByRole('button', { name: t('documents.folder.createFolder') })
    .click();
  await expect(dialog).toBeHidden({ timeout: TIMEOUT.PERSIST });
  await expect(
    page.getByRole('tree').getByText(folderName, { exact: true }),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });
}

/**
 * Ensure the desk is in the catalog. Hermetic stacks already seed it from
 * `fixtures/config/default/automations/`; live stacks upload the zip via the
 * Add-automation menu when the card is absent.
 */
async function ensureDeskInCatalog(
  page: Page,
  organizationId: string,
): Promise<void> {
  await gotoAutomationsHubAllTab(page, organizationId);
  const listed = page.getByText(DESK_NAME(), { exact: true });
  const addMenu = page.getByRole('button', {
    name: t('automations.addMenu.label'),
  });
  // Wait for the hub to paint — either the seeded card or the upload affordance.
  await expect(listed.or(addMenu).first()).toBeVisible({
    timeout: TIMEOUT.FIRST_PAINT,
  });
  if (await listed.isVisible().catch(() => false)) return;

  await addMenu.click();
  await page
    .getByRole('menuitem', { name: t('automations.upload.uploadApp') })
    .click();
  const dialog = page.getByRole('dialog', {
    name: t('automations.upload.dialogTitle'),
  });
  await expect(dialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });

  const fileInput = dialog.locator('input[type="file"]').first();
  await fileInput.setInputFiles(FIXTURE_ZIP);

  const submit = dialog.getByRole('button', {
    name: t('automations.upload.submit'),
  });
  await expect(submit).toBeEnabled({ timeout: TIMEOUT.VISIBLE });
  await submit.click();

  // Replace confirm if a previous run left the private copy on disk.
  const replace = page.getByRole('button', {
    name: t('automations.upload.replaceConfirm'),
  });
  if (await replace.isVisible({ timeout: 2_000 }).catch(() => false)) {
    await replace.click();
  }

  await expect(dialog).toBeHidden({ timeout: TIMEOUT.EXECUTION });
  await gotoAutomationsHubAllTab(page, organizationId);
  await expect(listed).toBeVisible({ timeout: TIMEOUT.VISIBLE });
}

/**
 * First-time install: the wizard picks the project and Finish closes the
 * wizard in place — install no longer redirects anywhere
 * (`walkInstallWizard` already asserts the close). Reaching the desk is an
 * explicit navigation.
 */
async function installIntoProject(
  page: Page,
  organizationId: string,
  projectName: string,
  projectId: string,
): Promise<void> {
  await page.goto(`/dashboard/${organizationId}/automations/${SLUG}`);
  await expect(
    page.getByText(t('automations.details.scopeProject')).first(),
  ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  await page
    .getByRole('button', {
      name: t('automations.install.install'),
      exact: true,
    })
    .click();

  const wizard = installWizardDialog(page, DESK_NAME());
  await expect(wizard).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await walkInstallWizard(wizard, { projectName });

  // The desk is a first-class project view tab now.
  await page.goto(
    `/dashboard/${organizationId}/projects/${projectId}/views/${SLUG}/desk`,
  );
  await expect(page.getByText('Period folders', { exact: true })).toBeVisible({
    timeout: TIMEOUT.FIRST_PAINT,
  });
}

/**
 * Bind an additional project via Configuration → Bound projects (Save).
 * Install wizard is first-install only; further membership is the MultiSelect.
 */
async function bindAdditionalProject(
  page: Page,
  organizationId: string,
  projectName: string,
  projectId: string,
): Promise<void> {
  await page.goto(`/dashboard/${organizationId}/automations/${SLUG}`);
  const configTab = page.getByRole('link', {
    name: t('automations.tabs.configuration'),
  });
  await expect(configTab).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  await configTab.click();

  const bound = page.getByRole('combobox', {
    name: t('automations.membership.boundProjectsTitle'),
  });
  await expect(bound).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await bound.click();
  const listbox = page.getByRole('listbox', {
    name: t('automations.membership.boundProjectsTitle'),
  });
  await expect(listbox).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await listbox.getByRole('option', { name: projectName, exact: true }).click();
  await page.keyboard.press('Escape');

  const save = page
    .getByRole('button', { name: t('common.actions.save'), exact: true })
    .filter({ visible: true });
  await expect(save).toBeEnabled({ timeout: TIMEOUT.VISIBLE });
  await save.click();
  await expect(save).toBeDisabled({ timeout: TIMEOUT.PERSIST });

  await page.goto(
    `/dashboard/${organizationId}/projects/${projectId}/views/${SLUG}/desk`,
  );
  await expect(page.getByText('Period folders', { exact: true })).toBeVisible({
    timeout: TIMEOUT.FIRST_PAINT,
  });
}

test('two projects isolate period folders and Project nav reaches the desk', async ({
  page,
  org,
}) => {
  test.setTimeout(TIMEOUT.EXECUTION * 4);

  const consoleErrors: string[] = [];
  page.on('console', (msg) => {
    if (msg.type() === 'error') consoleErrors.push(msg.text());
  });
  page.on('pageerror', (err) => {
    consoleErrors.push(`pageerror: ${err.message}`);
  });

  const { organizationId } = org;
  const suffix = Date.now().toString(36);
  const acmeName = `E2E Acme ${suffix}`;
  const betaName = `E2E Beta ${suffix}`;
  const acmePeriod = `2025Q4-acme-${suffix}`;
  const betaPeriod = `2025Q4-beta-${suffix}`;

  await ensureDeskInCatalog(page, organizationId);

  const acmeId = await createProject(page, organizationId, acmeName);
  const betaId = await createProject(page, organizationId, betaName);

  // Acme: period only first — Start must stay hidden without `_setup`.
  await createRootFolder(page, organizationId, acmeId, acmePeriod);

  await installIntoProject(page, organizationId, acmeName, acmeId);

  // Surface the Collection error-boundary cause if Periods fails to load.
  const periodVisible = page.getByText(acmePeriod, { exact: true });
  try {
    await expect(periodVisible).toBeVisible({
      timeout: TIMEOUT.FIRST_PAINT,
    });
  } catch (err) {
    throw new Error(
      `Periods did not list ${acmePeriod}. console/page errors:\n${consoleErrors.join('\n') || '(none)'}`,
      { cause: err },
    );
  }
  // Scoped to table cells: the desk's markdown-rendered description also
  // contains a literal `_setup` (as inline code), which a page-wide
  // getByText would now match — the assertion is about the PERIODS ROWS.
  await expect(page.getByRole('cell', { name: '_setup' })).toHaveCount(0);
  const acmePeriodRow = page.getByRole('row').filter({ hasText: acmePeriod });
  await expect(acmePeriodRow).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await expect(
    acmePeriodRow.getByRole('button', { name: t('automations.list.start') }),
  ).toHaveCount(0);

  // Add setup folder → Start appears.
  await createRootFolder(page, organizationId, acmeId, '_setup');
  await page.goto(
    `/dashboard/${organizationId}/projects/${acmeId}/views/${SLUG}/desk`,
  );
  await expect(page.getByText(acmePeriod, { exact: true })).toBeVisible({
    timeout: TIMEOUT.FIRST_PAINT,
  });
  const acmeRowWithSetup = page
    .getByRole('row')
    .filter({ hasText: acmePeriod });
  await expect(
    acmeRowWithSetup.getByRole('button', {
      name: t('automations.list.start'),
    }),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

  // Project nav: the desk view is a first-class tab on the project strip.
  // Scope to the project TabNavigation — the org sidebar also exposes links
  // with overlapping accessible names.
  await page.goto(`/dashboard/${organizationId}/projects/${acmeId}`);
  const projectNav = page.getByRole('navigation', {
    name: t('common.aria.projectsNavigation'),
  });
  const deskViewTab = projectNav.getByRole('link', {
    name: 'Project files desk',
    exact: true,
  });
  await expect(deskViewTab).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  await deskViewTab.click();
  await page.waitForURL(
    new RegExp(
      `/dashboard/${organizationId}/projects/${acmeId}/views/${SLUG}/desk`,
    ),
    { timeout: TIMEOUT.NAV },
  );
  await expect(page.getByText(acmePeriod, { exact: true })).toBeVisible({
    timeout: TIMEOUT.FIRST_PAINT,
  });

  // The Automations tab remains the management list; a row opens the
  // automation's project-nested admin page (Configuration by default —
  // views no longer render there).
  const automationsTab = projectNav.getByRole('link', {
    name: t('projects.navigation.automations'),
    exact: true,
  });
  await automationsTab.click();
  await page.waitForURL(
    new RegExp(
      `/dashboard/${organizationId}/projects/${acmeId}/automations/?$`,
    ),
    { timeout: TIMEOUT.NAV },
  );
  await page.getByRole('link', { name: DESK_NAME() }).click();
  await page.waitForURL(
    new RegExp(
      `/dashboard/${organizationId}/projects/${acmeId}/automations/${SLUG}`,
    ),
    { timeout: TIMEOUT.NAV },
  );
  await expect(
    page.getByRole('combobox', {
      name: t('automations.membership.boundProjectsTitle'),
    }),
  ).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  await page.goto(
    `/dashboard/${organizationId}/projects/${acmeId}/views/${SLUG}/desk`,
  );
  await expect(page.getByText(acmePeriod, { exact: true })).toBeVisible({
    timeout: TIMEOUT.FIRST_PAINT,
  });

  // Bind Beta + seed its Files.
  await createRootFolder(page, organizationId, betaId, betaPeriod);
  await createRootFolder(page, organizationId, betaId, '_setup');
  await bindAdditionalProject(page, organizationId, betaName, betaId);

  await expect(page.getByText(betaPeriod, { exact: true })).toBeVisible({
    timeout: TIMEOUT.FIRST_PAINT,
  });
  await expect(page.getByText(acmePeriod, { exact: true })).toHaveCount(0);
  // Scoped to table cells: the desk's markdown-rendered description also
  // contains a literal `_setup` (as inline code), which a page-wide
  // getByText would now match — the assertion is about the PERIODS ROWS.
  await expect(page.getByRole('cell', { name: '_setup' })).toHaveCount(0);

  // Start on Beta → Jobs shows Beta's task only.
  const betaRow = page.getByRole('row').filter({ hasText: betaPeriod });
  await betaRow
    .getByRole('button', { name: t('automations.list.start') })
    .click();
  // Create returns as soon as the task row exists (workflow start is
  // scheduled). Assert the Jobs row — not the Start→Created latch — so a
  // slow/failed engine kick cannot strand the proof that create worked.
  await page.getByRole('tab', { name: 'Jobs', exact: true }).click();
  await expect(
    page.getByText(`Period job — ${betaPeriod}`, { exact: true }),
  ).toBeVisible({ timeout: TIMEOUT.EXECUTION });

  // Jobs Mark done (review confirm) — stub parks at in_review after the
  // scheduled workflow runs.
  const betaJobRow = page
    .getByRole('row')
    .filter({ hasText: `Period job — ${betaPeriod}` });
  await expect(
    betaJobRow.getByRole('button', { name: t('automations.list.markDone') }),
  ).toBeVisible({ timeout: TIMEOUT.EXECUTION });
  await betaJobRow
    .getByRole('button', { name: t('automations.list.markDone') })
    .click();
  const confirmDialog = page.getByRole('dialog');
  await expect(confirmDialog.getByText(/Mark done after review/i)).toBeVisible({
    timeout: TIMEOUT.VISIBLE,
  });
  await confirmDialog
    .getByRole('button', { name: t('common.actions.confirm') })
    .click();
  await expect(betaJobRow.getByText('Done', { exact: true })).toBeVisible({
    timeout: TIMEOUT.PERSIST,
  });

  // Periods → Open files deep-links into Project Files with folderId.
  await page.getByRole('tab', { name: 'Periods', exact: true }).click();
  const betaPeriodRow = page.getByRole('row').filter({ hasText: betaPeriod });
  await betaPeriodRow.getByRole('button', { name: 'Open files' }).click();
  await page.waitForURL(
    new RegExp(
      `/dashboard/${organizationId}/projects/${betaId}/files\\?folderId=`,
    ),
    { timeout: TIMEOUT.NAV },
  );

  // Acme desk must not list Beta's job.
  await page.goto(
    `/dashboard/${organizationId}/projects/${acmeId}/views/${SLUG}/desk`,
  );
  await page.getByRole('tab', { name: 'Jobs', exact: true }).click();
  await expect(
    page.getByText(`Period job — ${betaPeriod}`, { exact: true }),
  ).toHaveCount(0);
});
