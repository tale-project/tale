import { expect, type Locator, type Page } from '@playwright/test';

import { TIMEOUT } from './env';
import { t } from './i18n';

/**
 * Upload one workflow document through the automation list's Create menu and
 * keep it a draft: the upload dialog's deploy offer is declined, so nothing
 * runs until a test says so. Ends on the list, with the success dialog gone.
 */
export async function uploadAutomationDraft(
  page: Page,
  organizationId: string,
  workflowYml: string,
): Promise<void> {
  // The list toolbar's create menu — a dropdown of three lanes. Its trigger
  // is the DataTable `addAction`, labelled with the Create verb every list
  // page carries (`list.createButton`).
  await page.goto(`/dashboard/${organizationId}/automations`);
  const createButton = page
    .getByRole('button', { name: t('automations.list.createButton') })
    .first();
  await expect(createButton).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });
  await createButton.click();
  await page
    .getByRole('menuitem', { name: t('automations.upload.trigger') })
    .click();

  // The drop zone's aria-label duplicates the field label, so target the
  // file input directly rather than by accessible name.
  const uploadDialog = page.getByRole('dialog', {
    name: t('automations.upload.title'),
  });
  await expect(uploadDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await uploadDialog.locator('input[type="file"]').setInputFiles({
    name: 'workflow.yml',
    mimeType: 'application/yaml',
    buffer: Buffer.from(workflowYml, 'utf8'),
  });
  await uploadDialog
    .getByRole('button', { name: t('automations.upload.submit'), exact: true })
    .click();

  // Saved as a draft — the dialog re-titles itself and offers to deploy;
  // decline so the upload stays a draft.
  const successDialog = page.getByRole('dialog', {
    name: t('automations.upload.successTitle'),
  });
  await expect(successDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await successDialog
    .getByRole('button', { name: t('automations.upload.deployLater') })
    .click();
  await expect(successDialog).not.toBeVisible({ timeout: TIMEOUT.VISIBLE });
}

/**
 * Delete the automation of a list row through its row menu and the named
 * confirmation, and wait for the row to leave the list.
 */
export async function deleteAutomationRow(
  page: Page,
  row: Locator,
): Promise<void> {
  await expect(row).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await row.getByRole('button', { name: t('common.actions.openMenu') }).click();
  await page
    .getByRole('menuitem', { name: t('common.actions.delete') })
    .click();
  const deleteDialog = page.getByRole('dialog', {
    name: t('automations.detail.delete.title'),
  });
  await expect(deleteDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await deleteDialog
    .getByRole('button', { name: t('common.actions.delete'), exact: true })
    .click();
  await expect(row).not.toBeVisible({ timeout: TIMEOUT.VISIBLE });
}
