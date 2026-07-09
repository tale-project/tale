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
 * Phase 0 VATplus desk — project Files isolation + Project→Desk entry.
 *
 * Fixture: `vat-return-desk-e2e` (thin status-flip workflow, no sandbox). On the
 * hermetic stack it is already in the pinned builtin catalog; against a live
 * `bun run dev` the spec uploads the zip when the catalog does not list it.
 *
 * Proves:
 *  1. Install Finish lands on the project automation URL.
 *  2. Project nav exposes a tab into the desk.
 *  3. Quarters list is project-scoped (Acme never sees Beta's folders).
 *  4. `_setup` is excluded from Quarters; Start stays hidden until it exists.
 *  5. Start creates a return task visible on that project's Returns tab only.
 */

const SLUG = 'vat-return-desk-e2e';
const DESK_NAME = () => automationName(SLUG);

const dirname = path.dirname(fileURLToPath(import.meta.url));
const FIXTURE_ZIP = path.join(
  dirname,
  '..',
  'fixtures',
  'vat-return-desk-e2e.zip',
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

/** First-time install: wizard picks the project and Finish lands on its desk. */
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

  await page.waitForURL(
    new RegExp(
      `/dashboard/${organizationId}/projects/${projectId}/automations/${SLUG}`,
    ),
    { timeout: TIMEOUT.NAV },
  );
  // Finish lands on the automation shell; the desk view is a tab, not the
  // default Editor (developers see Editor first).
  await page.goto(
    `/dashboard/${organizationId}/projects/${projectId}/automations/${SLUG}?tab=desk`,
  );
  await expect(page.getByText('Quarter folders', { exact: true })).toBeVisible({
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
    `/dashboard/${organizationId}/projects/${projectId}/automations/${SLUG}?tab=desk`,
  );
  await expect(page.getByText('Quarter folders', { exact: true })).toBeVisible({
    timeout: TIMEOUT.FIRST_PAINT,
  });
}

test('two projects isolate quarter folders and Project nav reaches the desk', async ({
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
  const acmeQuarter = `2025Q4-acme-${suffix}`;
  const betaQuarter = `2025Q4-beta-${suffix}`;

  await ensureDeskInCatalog(page, organizationId);

  const acmeId = await createProject(page, organizationId, acmeName);
  const betaId = await createProject(page, organizationId, betaName);

  // Acme: quarter only first — Start must stay hidden without `_setup`.
  await createRootFolder(page, organizationId, acmeId, acmeQuarter);

  await installIntoProject(page, organizationId, acmeName, acmeId);

  // Surface the Collection error-boundary cause if Quarters fails to load.
  const quarterVisible = page.getByText(acmeQuarter, { exact: true });
  try {
    await expect(quarterVisible).toBeVisible({
      timeout: TIMEOUT.FIRST_PAINT,
    });
  } catch (err) {
    throw new Error(
      `Quarters did not list ${acmeQuarter}. console/page errors:\n${consoleErrors.join('\n') || '(none)'}`,
      { cause: err },
    );
  }
  await expect(page.getByText('_setup', { exact: true })).toHaveCount(0);
  const acmeQuarterRow = page.getByRole('row').filter({ hasText: acmeQuarter });
  await expect(acmeQuarterRow).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await expect(
    acmeQuarterRow.getByRole('button', { name: t('automations.list.start') }),
  ).toHaveCount(0);

  // Add setup folder → Start appears.
  await createRootFolder(page, organizationId, acmeId, '_setup');
  await page.goto(
    `/dashboard/${organizationId}/projects/${acmeId}/automations/${SLUG}?tab=desk`,
  );
  await expect(page.getByText(acmeQuarter, { exact: true })).toBeVisible({
    timeout: TIMEOUT.FIRST_PAINT,
  });
  const acmeRowWithSetup = page
    .getByRole('row')
    .filter({ hasText: acmeQuarter });
  await expect(
    acmeRowWithSetup.getByRole('button', {
      name: t('automations.list.start'),
    }),
  ).toBeVisible({ timeout: TIMEOUT.VISIBLE });

  // Project nav: Automations list → desk by name → desk tab.
  // Scope to the project TabNavigation — the org sidebar also exposes an
  // Automations rail link with the same accessible name.
  await page.goto(`/dashboard/${organizationId}/projects/${acmeId}`);
  const automationsTab = page
    .getByRole('navigation', {
      name: t('common.aria.projectsNavigation'),
    })
    .getByRole('link', {
      name: t('projects.navigation.automations'),
      exact: true,
    });
  await expect(automationsTab).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
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
  // List entry may land on Editor; open the desk view.
  await page.goto(
    `/dashboard/${organizationId}/projects/${acmeId}/automations/${SLUG}?tab=desk`,
  );
  await expect(page.getByText(acmeQuarter, { exact: true })).toBeVisible({
    timeout: TIMEOUT.FIRST_PAINT,
  });

  // Bind Beta + seed its Files.
  await createRootFolder(page, organizationId, betaId, betaQuarter);
  await createRootFolder(page, organizationId, betaId, '_setup');
  await bindAdditionalProject(page, organizationId, betaName, betaId);

  await expect(page.getByText(betaQuarter, { exact: true })).toBeVisible({
    timeout: TIMEOUT.FIRST_PAINT,
  });
  await expect(page.getByText(acmeQuarter, { exact: true })).toHaveCount(0);
  await expect(page.getByText('_setup', { exact: true })).toHaveCount(0);

  // Start on Beta → Returns shows Beta's task only.
  const betaRow = page.getByRole('row').filter({ hasText: betaQuarter });
  await betaRow
    .getByRole('button', { name: t('automations.list.start') })
    .click();
  // doneLabelKey flips the Start button to "Created" once the task exists.
  await expect(
    betaRow.getByRole('button', { name: t('automations.list.created') }),
  ).toBeVisible({ timeout: TIMEOUT.EXECUTION });

  // Desk view tabs are role=tab (not the automation section links).
  await page.getByRole('tab', { name: 'Returns', exact: true }).click();
  await expect(
    page.getByText(`VAT return — ${betaQuarter}`, { exact: true }),
  ).toBeVisible({ timeout: TIMEOUT.PERSIST });

  // Acme desk must not list Beta's return task.
  await page.goto(
    `/dashboard/${organizationId}/projects/${acmeId}/automations/${SLUG}?tab=desk`,
  );
  await page.getByRole('tab', { name: 'Returns', exact: true }).click();
  await expect(
    page.getByText(`VAT return — ${betaQuarter}`, { exact: true }),
  ).toHaveCount(0);
});
