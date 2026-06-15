import { expect, test, type Locator, type Page } from '@playwright/test';

import { t } from '../helpers/i18n';
import { readRunContext } from '../helpers/test-context';

/**
 * Knowledge-entity CRUD breadth (WAVE 2). `knowledge.spec.ts` already covers the
 * list-render smoke for all six knowledge entities AND the full customer CRUD;
 * this spec adds the create → appears → edit → delete cycle for the OTHER
 * hermetic entities so each writable list path is exercised end-to-end:
 *
 *  - PRODUCTS         — full CRUD. Create via the header "Add product" dropdown →
 *    "Manual entry" → 3-step wizard (basics/pricing/review). The create is a
 *    pure Convex mutation (no embeddings), so it is fully hermetic.
 *  - VENDORS          — full CRUD. Mirrors the customer flow: the manual-entry
 *    import takes a header-less `email,name` CSV line (the vendor mapper is
 *    positional — no `recordMapper` — so one line creates exactly one
 *    `manual_import` vendor, the only source whose rows expose edit/delete).
 *  - KNOWLEDGE-ENTRIES — full CRUD. `createKnowledgeEntry`/`updateKnowledgeEntry`
 *    are mutations that write the row synchronously and only schedule RAG
 *    materialization asynchronously ("a failure here leaves the entry visible
 *    with its indexing status reported as failed"), so the row appears and is
 *    editable/deletable WITHOUT the embedding pipeline the mock LLM can't serve.
 *
 *  - WEBSITES         — create-dialog-render-only (see the test + NOTE below).
 *    Adding a website inserts the row synchronously, but EDIT (scan-interval
 *    change → `updateCrawlerScanInterval`) and DELETE (`deregisterDomainFrom-
 *    Crawler`) both make a *synchronous* call to the crawler service at
 *    `CRAWLER_URL` (default `http://localhost:8002`). The hermetic e2e stack
 *    (`scripts/dev.ts`) boots only Convex + Vite + the mock LLM — no crawler —
 *    so both edit and delete HARD-fail (connection refused → thrown error).
 *    A created row therefore could not be cleaned up, which would break the
 *    single shared org's idempotency, so this case asserts the add dialog opens
 *    and its fields render rather than creating an undeletable row.
 *
 * Documents and customers are intentionally NOT covered here (documents need a
 * real upload + embeddings; customers are fully covered by `knowledge.spec.ts`).
 *
 * All specs run as the pre-authenticated owner and start from an empty list, so
 * each create uses a unique `Date.now().toString(36)` suffix and the test
 * deletes what it created, leaving the shared org as it found it.
 */

/**
 * Wait for a knowledge list to finish its skeleton load. The header create
 * affordance renders immediately for a writer regardless of row count, and the
 * empty-state title appears once a genuinely empty list settles — so either one
 * being visible means the page rendered and isn't mid-skeleton (mirrors
 * `automation.spec.ts`'s `installedRow.or(emptyState)` settle wait).
 */
async function expectListSettled(
  page: Page,
  createLabel: string,
  emptyStateTitle: string,
): Promise<void> {
  const createAffordance = page.getByRole('button', { name: createLabel });
  const emptyState = page.getByText(emptyStateTitle);
  await expect(createAffordance.or(emptyState).first()).toBeVisible({
    timeout: 60_000,
  });
}

/**
 * A list row whose name cell contains `name`. Substring (not `exact`) on
 * purpose: the products name cell wraps an avatar `<Image alt={name}>` next to
 * the label, so its cell accessible name is the name repeated (`"<name>
 * <name>"`); an exact match would never resolve it. Every `name`/`renamed`
 * value the callers pass is unique per run, so a contained match still selects
 * exactly the intended row.
 */
function rowByCell(page: Page, name: string): Locator {
  return page.getByRole('row').filter({
    has: page.getByRole('cell', { name }),
  });
}

/**
 * Open a row's 3-dot actions menu (`EntityRowActions` → `common.actions.openMenu`)
 * and click one of its menu items. Scoped to the row so the menu trigger is
 * unambiguous even though every row renders one.
 */
async function openRowAction(
  page: Page,
  row: Locator,
  itemLabel: string,
): Promise<void> {
  await row.getByRole('button', { name: t('common.actions.openMenu') }).click();
  await page.getByRole('menuitem', { name: itemLabel, exact: true }).click();
}

test('creates, edits and deletes a product', async ({ page }) => {
  const { organizationId } = readRunContext();
  await page.goto(`/dashboard/${organizationId}/products`);
  await expectListSettled(
    page,
    t('products.addButton'),
    t('emptyStates.products.title'),
  );

  const suffix = Date.now().toString(36);
  const name = `E2E Product ${suffix}`;
  const renamed = `${name} edited`;

  // --- Create: header "Add product" dropdown → "Manual entry" → wizard. ---
  // The header trigger is a Radix dropdown (`aria-haspopup="menu"`); the
  // empty-state CTA shares the "Add product" label but is a plain button, so
  // scope to the dropdown to keep the locator unambiguous on the empty list.
  await page
    .getByRole('button', { name: t('products.addButton') })
    .and(page.locator('[aria-haspopup="menu"]'))
    .click();
  await page
    .getByRole('menuitem', { name: t('products.importMenu.manualEntry') })
    .click();

  const createDialog = page.getByRole('dialog', {
    name: t('products.create.title'),
  });
  await expect(createDialog).toBeVisible({ timeout: 20_000 });

  // Step 1 (basics): only the name gates the wizard's Next. Fill it, then walk
  // basics → pricing → review (the footer is one button: "Next" until the last
  // step, then the "Create" finish action).
  await createDialog.getByLabel(t('products.edit.labels.name')).fill(name);
  await createDialog
    .getByRole('button', { name: t('common.actions.next'), exact: true })
    .click();
  await createDialog
    .getByRole('button', { name: t('common.actions.next'), exact: true })
    .click();
  await createDialog
    .getByRole('button', { name: t('common.actions.create'), exact: true })
    .click();

  const createdRow = rowByCell(page, name);
  await expect(createdRow).toBeVisible({ timeout: 60_000 });

  // --- Edit: row actions → Edit → rename → save. ---
  await openRowAction(page, createdRow, t('common.actions.edit'));
  const editDialog = page.getByRole('dialog', {
    name: t('products.edit.title'),
  });
  await expect(editDialog).toBeVisible({ timeout: 20_000 });
  const nameField = editDialog.getByLabel(t('products.edit.labels.name'));
  await expect(nameField).toHaveValue(name);
  await nameField.fill(renamed);
  await editDialog
    .getByRole('button', { name: t('common.actions.save'), exact: true })
    .click();

  // Save toast confirms the round-trip; the renamed row then shows in-list.
  await expect(
    page.getByText(t('products.edit.toast.success')).first(),
  ).toBeVisible({ timeout: 20_000 });
  const renamedRow = rowByCell(page, renamed);
  await expect(renamedRow).toBeVisible({ timeout: 60_000 });

  // --- Delete: row actions → Delete → confirm. ---
  await openRowAction(page, renamedRow, t('common.actions.delete'));
  const deleteDialog = page.getByRole('dialog', {
    name: t('products.delete.title'),
  });
  await expect(deleteDialog).toBeVisible({ timeout: 20_000 });
  await deleteDialog
    .getByRole('button', { name: t('common.actions.delete'), exact: true })
    .click();

  // Gone from the list — restores the shared org to an empty products list.
  await expect(renamedRow).toHaveCount(0, { timeout: 60_000 });
});

test('creates, edits and deletes a vendor', async ({ page }) => {
  const { organizationId } = readRunContext();
  await page.goto(`/dashboard/${organizationId}/vendors`);
  await expectListSettled(
    page,
    t('vendors.importMenu.importVendors'),
    t('emptyStates.vendors.title'),
  );

  // Unique email so the bulk-create never reports zero imported on a duplicate.
  const suffix = Date.now().toString(36);
  const name = `E2E Vendor ${suffix}`;
  const renamed = `${name} edited`;
  const email = `e2e-vendor-${suffix}@example.test`;

  // --- Create: header "Import vendors" dropdown → "Manual entry" → CSV line. ---
  await page
    .getByRole('button', { name: t('vendors.importMenu.importVendors') })
    .click();
  await page
    .getByRole('menuitem', { name: t('vendors.importMenu.manualEntry') })
    .click();

  // The manual-entry dialog ("Add vendors") hosts a single CSV textarea. The
  // vendor mapper is positional (no header row), so one `email,name` line
  // creates exactly one `manual_import` vendor named `name`.
  const createDialog = page.getByRole('dialog', {
    name: t('vendors.addVendors'),
  });
  await expect(createDialog).toBeVisible({ timeout: 20_000 });
  await createDialog.getByRole('textbox').first().fill(`${email},${name}`);
  await createDialog
    .getByRole('button', { name: t('common.actions.import'), exact: true })
    .click();

  const createdRow = rowByCell(page, name);
  await expect(createdRow).toBeVisible({ timeout: 60_000 });

  // --- Edit: row actions → Edit → rename → save. ---
  await openRowAction(page, createdRow, t('common.actions.edit'));
  const editDialog = page.getByRole('dialog', {
    name: t('vendors.editVendor'),
  });
  await expect(editDialog).toBeVisible({ timeout: 20_000 });
  const nameField = editDialog.getByLabel(t('vendors.name'));
  await expect(nameField).toHaveValue(name);
  await nameField.fill(renamed);
  await editDialog
    .getByRole('button', { name: t('common.actions.save'), exact: true })
    .click();

  await expect(page.getByText(t('vendors.updateSuccess')).first()).toBeVisible({
    timeout: 20_000,
  });
  const renamedRow = rowByCell(page, renamed);
  await expect(renamedRow).toBeVisible({ timeout: 60_000 });

  // --- Delete: row actions → Delete → confirm. ---
  await openRowAction(page, renamedRow, t('common.actions.delete'));
  const deleteDialog = page.getByRole('dialog', {
    name: t('vendors.deleteVendor'),
  });
  await expect(deleteDialog).toBeVisible({ timeout: 20_000 });
  await deleteDialog
    .getByRole('button', { name: t('common.actions.delete'), exact: true })
    .click();

  await expect(renamedRow).toHaveCount(0, { timeout: 60_000 });
});

test('creates, edits and deletes a knowledge entry', async ({ page }) => {
  const { organizationId } = readRunContext();
  await page.goto(`/dashboard/${organizationId}/knowledge-entries`);
  await expectListSettled(
    page,
    t('knowledgeEntries.addButton'),
    t('emptyStates.knowledgeEntries.title'),
  );

  // Topics dedupe on a normalized topic key, so keep both the original and the
  // renamed topic unique per run.
  const suffix = Date.now().toString(36);
  const topic = `E2E Knowledge ${suffix}`;
  const renamed = `${topic} edited`;
  const content = `E2E knowledge content ${suffix}`;

  // --- Create: header "Add entry" button → add dialog (topic + content). ---
  // The header button and the empty-state CTA share the "Add entry" label and
  // BOTH open the same `AddKnowledgeEntryDialog`, so `.first()` is unambiguous.
  await page
    .getByRole('button', { name: t('knowledgeEntries.addButton') })
    .first()
    .click();

  const createDialog = page.getByRole('dialog', {
    name: t('knowledgeEntries.addEntry'),
  });
  await expect(createDialog).toBeVisible({ timeout: 20_000 });
  await createDialog.getByLabel(t('knowledgeEntries.topic')).fill(topic);
  await createDialog.getByLabel(t('knowledgeEntries.content')).fill(content);
  await createDialog
    .getByRole('button', { name: t('common.actions.save'), exact: true })
    .click();

  const createdRow = rowByCell(page, topic);
  await expect(createdRow).toBeVisible({ timeout: 60_000 });

  // --- Edit: row actions → Edit → rename topic → save. ---
  await openRowAction(page, createdRow, t('common.actions.edit'));
  const editDialog = page.getByRole('dialog', {
    name: t('knowledgeEntries.editEntry'),
  });
  await expect(editDialog).toBeVisible({ timeout: 20_000 });
  const topicField = editDialog.getByLabel(t('knowledgeEntries.topic'));
  await expect(topicField).toHaveValue(topic);
  await topicField.fill(renamed);
  await editDialog
    .getByRole('button', { name: t('common.actions.save'), exact: true })
    .click();

  await expect(
    page.getByText(t('knowledgeEntries.toast.updateSuccess')).first(),
  ).toBeVisible({ timeout: 20_000 });
  const renamedRow = rowByCell(page, renamed);
  await expect(renamedRow).toBeVisible({ timeout: 60_000 });

  // --- Delete: row actions → Delete → confirm. ---
  await openRowAction(page, renamedRow, t('common.actions.delete'));
  const deleteDialog = page.getByRole('dialog', {
    name: t('knowledgeEntries.delete.title'),
  });
  await expect(deleteDialog).toBeVisible({ timeout: 20_000 });
  await deleteDialog
    .getByRole('button', { name: t('common.actions.delete'), exact: true })
    .click();

  await expect(renamedRow).toHaveCount(0, { timeout: 60_000 });
});

test('opens the add-website dialog and renders its fields', async ({
  page,
}) => {
  const { organizationId } = readRunContext();
  await page.goto(`/dashboard/${organizationId}/websites`);
  await expectListSettled(
    page,
    t('websites.addButton'),
    t('emptyStates.websites.title'),
  );

  // NOTE: full website CRUD is NOT hermetic. Creating a website inserts the row
  // synchronously, but editing the scan interval and deleting both make a
  // synchronous call to the crawler service (CRAWLER_URL, default
  // localhost:8002), which the mock-LLM e2e stack does not run — so a created
  // row could not be edited or cleaned up and would leak into the shared org.
  // We therefore assert the add dialog opens and its fields render (no row is
  // created, so nothing needs cleanup). The header button and empty-state CTA
  // share the "Add website" label and both open this dialog, so `.first()` is
  // unambiguous.
  await page
    .getByRole('button', { name: t('websites.addButton') })
    .first()
    .click();

  const addDialog = page.getByRole('dialog', {
    name: t('websites.addWebsite'),
  });
  await expect(addDialog).toBeVisible({ timeout: 20_000 });
  await expect(addDialog.getByLabel(t('websites.domain'))).toBeVisible();
  await expect(
    addDialog.getByText(t('websites.scanInterval')).first(),
  ).toBeVisible();
});
