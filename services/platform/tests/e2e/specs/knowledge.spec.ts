import { type Locator, type Page } from '@playwright/test';

import { isMockLlmMode, TIMEOUT } from '../helpers/env';
import { test, expect } from '../helpers/fixtures';
import { t } from '../helpers/i18n';

/**
 * Knowledge-entity CRUD breadth, parametrized over the shared DataTable lists.
 * Create differs per entity (CSV manual-entry vs. multi-step wizard vs. direct
 * form) so each carries its own `create`; edit/delete are shared because only
 * the manually-created rows expose those actions.
 */

/** A list row whose visible name cell exactly equals `name`. */
function rowByCell(page: Page, name: string): Locator {
  return page.getByRole('row').filter({
    has: page.getByRole('cell', { name, exact: true }),
  });
}

/**
 * Wait for a knowledge list to settle past its skeleton: the header create
 * affordance renders immediately for a writer regardless of row count, and the
 * empty-state title appears once a genuinely empty list settles — so either one
 * being visible means the page rendered and isn't mid-skeleton.
 */
async function expectListSettled(
  page: Page,
  createLabel: string,
  emptyStateTitle: string,
): Promise<void> {
  const createAffordance = page.getByRole('button', { name: createLabel });
  const emptyState = page.getByText(emptyStateTitle);
  await expect(createAffordance.or(emptyState).first()).toBeVisible({
    timeout: TIMEOUT.FIRST_PAINT,
  });
}

/**
 * Open a row's 3-dot actions menu (`common.actions.openMenu`) and click one of
 * its items. Scoped to the row so the trigger is unambiguous even though every
 * row renders one.
 */
async function openRowAction(
  page: Page,
  row: Locator,
  itemLabel: string,
): Promise<void> {
  await row.getByRole('button', { name: t('common.actions.openMenu') }).click();
  await page.getByRole('menuitem', { name: itemLabel, exact: true }).click();
}

interface CrudEntity {
  segment: string;
  /** Header create affordance label (a writer always sees it). */
  createLabel: string;
  emptyStateTitle: string;
  /** Edit/delete dialog titles + the post-edit success toast. */
  editDialogTitle: string;
  deleteDialogTitle: string;
  /** Field whose value identifies the row (renamed on edit). */
  nameFieldLabel: string;
  updateSuccess: string;
  /** Create one entity named `name`; resolves once it exists in the list. */
  create: (page: Page, name: string) => Promise<void>;
  /**
   * Resolve the list row carrying `name`. Defaults to {@link rowByCell} (an
   * exact-name cell match), which is correct for the text-only name cells
   * (customers/vendors/knowledge-entries). Override per entity when the name
   * cell isn't a plain text cell.
   */
  rowByName?: (page: Page, name: string) => Locator;
}

/** CSV manual-entry create (customers, vendors): one `email,name` line. */
async function createViaCsvImport(
  page: Page,
  options: {
    menuTrigger: string;
    menuItem: string;
    dialogTitle: string;
    importLabel: string;
    email: string;
    name: string;
  },
): Promise<void> {
  await page.getByRole('button', { name: options.menuTrigger }).click();
  await page.getByRole('menuitem', { name: options.menuItem }).click();

  const dialog = page.getByRole('dialog', { name: options.dialogTitle });
  await expect(dialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  // Header-less CSV: the mapper is positional, so one line creates exactly one
  // `manual_import` row named `name` — the only source with edit/delete actions.
  await dialog
    .getByRole('textbox')
    .first()
    .fill(`${options.email},${options.name}`);
  await dialog
    .getByRole('button', { name: options.importLabel, exact: true })
    .click();
}

const ENTITIES: CrudEntity[] = [
  {
    segment: 'customers',
    createLabel: t('customers.importMenu.importCustomers'),
    emptyStateTitle: t('emptyStates.customers.title'),
    editDialogTitle: t('customers.editCustomer'),
    deleteDialogTitle: t('customers.deleteCustomer'),
    nameFieldLabel: t('customers.name'),
    updateSuccess: t('customers.updateSuccess'),
    create: (page, name) =>
      createViaCsvImport(page, {
        menuTrigger: t('customers.importMenu.importCustomers'),
        menuItem: t('customers.importMenu.manualEntry'),
        dialogTitle: t('customers.import.addCustomers'),
        importLabel: t('customers.import.import'),
        // Unique email so the bulk-create never reports zero imported on a dup.
        email: `e2e-customer-${name.split(' ').pop() ?? ''}@example.test`,
        name,
      }),
  },
  {
    segment: 'vendors',
    createLabel: t('vendors.importMenu.importVendors'),
    emptyStateTitle: t('emptyStates.vendors.title'),
    editDialogTitle: t('vendors.editVendor'),
    deleteDialogTitle: t('vendors.deleteVendor'),
    nameFieldLabel: t('vendors.name'),
    updateSuccess: t('vendors.updateSuccess'),
    create: (page, name) =>
      createViaCsvImport(page, {
        menuTrigger: t('vendors.importMenu.importVendors'),
        menuItem: t('vendors.importMenu.manualEntry'),
        dialogTitle: t('vendors.addVendors'),
        importLabel: t('common.actions.import'),
        email: `e2e-vendor-${name.split(' ').pop() ?? ''}@example.test`,
        name,
      }),
  },
  {
    segment: 'products',
    createLabel: t('products.addButton'),
    emptyStateTitle: t('emptyStates.products.title'),
    editDialogTitle: t('products.edit.title'),
    deleteDialogTitle: t('products.delete.title'),
    nameFieldLabel: t('products.edit.labels.name'),
    updateSuccess: t('products.edit.toast.success'),
    // The product name cell renders a thumbnail (`<img alt={name}>`) beside the
    // name `<Text>`, so the cell's accessible name is the doubled `name name`
    // — `rowByCell`'s exact single-name match never hits. Match the doubled
    // value (which renames in lockstep with the cell) to keep it exact.
    rowByName: (page, name) =>
      page.getByRole('row').filter({
        has: page.getByRole('cell', { name: `${name} ${name}`, exact: true }),
      }),
    create: async (page, name) => {
      // Header "Add product" is a Radix dropdown; the empty-state CTA shares the
      // label but is a plain button — scope to the dropdown to disambiguate.
      await page
        .getByRole('button', { name: t('products.addButton') })
        .and(page.locator('[aria-haspopup="menu"]'))
        .click();
      await page
        .getByRole('menuitem', { name: t('products.importMenu.manualEntry') })
        .click();

      const dialog = page.getByRole('dialog', {
        name: t('products.create.title'),
      });
      await expect(dialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
      // Only the name gates the wizard; walk basics → pricing → review.
      await dialog.getByLabel(t('products.edit.labels.name')).fill(name);
      await dialog
        .getByRole('button', { name: t('common.actions.next'), exact: true })
        .click();
      await dialog
        .getByRole('button', { name: t('common.actions.next'), exact: true })
        .click();
      await dialog
        .getByRole('button', { name: t('common.actions.create'), exact: true })
        .click();
    },
  },
  {
    segment: 'knowledge-entries',
    createLabel: t('knowledgeEntries.addButton'),
    emptyStateTitle: t('emptyStates.knowledgeEntries.title'),
    editDialogTitle: t('knowledgeEntries.editEntry'),
    deleteDialogTitle: t('knowledgeEntries.delete.title'),
    nameFieldLabel: t('knowledgeEntries.topic'),
    updateSuccess: t('knowledgeEntries.toast.updateSuccess'),
    create: async (page, name) => {
      // Header button and empty-state CTA share the label and open the same
      // dialog, so `.first()` is unambiguous. The row write is synchronous; RAG
      // materialization is scheduled async, so the entry appears without it.
      await page
        .getByRole('button', { name: t('knowledgeEntries.addButton') })
        .first()
        .click();
      const dialog = page.getByRole('dialog', {
        name: t('knowledgeEntries.addEntry'),
      });
      await expect(dialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
      await dialog.getByLabel(t('knowledgeEntries.topic')).fill(name);
      await dialog
        .getByLabel(t('knowledgeEntries.content'))
        .fill(`E2E knowledge content for ${name}`);
      await dialog
        .getByRole('button', { name: t('common.actions.save'), exact: true })
        .click();
    },
  },
];

for (const entity of ENTITIES) {
  test(`creates, edits and deletes a ${entity.segment} entity`, async ({
    page,
    org,
  }) => {
    const { organizationId } = org;
    await page.goto(`/dashboard/${organizationId}/${entity.segment}`);
    await expectListSettled(page, entity.createLabel, entity.emptyStateTitle);

    // Unique per run so re-runs stay idempotent and topics/emails never collide.
    const suffix = Date.now().toString(36);
    const name = `E2E ${entity.segment} ${suffix}`;
    const renamed = `${name} edited`;
    const resolveRow = entity.rowByName ?? rowByCell;

    // --- Create -------------------------------------------------------------
    await entity.create(page, name);
    const createdRow = resolveRow(page, name);
    await expect(createdRow).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

    // --- Edit: row actions → Edit → rename → save --------------------------
    await openRowAction(page, createdRow, t('common.actions.edit'));
    const editDialog = page.getByRole('dialog', {
      name: entity.editDialogTitle,
    });
    await expect(editDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    const nameField = editDialog.getByLabel(entity.nameFieldLabel);
    await expect(nameField).toHaveValue(name);
    await nameField.fill(renamed);
    await editDialog
      .getByRole('button', { name: t('common.actions.save'), exact: true })
      .click();

    const renamedRow = resolveRow(page, renamed);
    await expect(renamedRow).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

    // --- Delete: row actions → Delete → confirm; leaves the list empty ------
    await openRowAction(page, renamedRow, t('common.actions.delete'));
    const deleteDialog = page.getByRole('dialog', {
      name: entity.deleteDialogTitle,
    });
    await expect(deleteDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
    await deleteDialog
      .getByRole('button', { name: t('common.actions.delete'), exact: true })
      .click();

    await expect(renamedRow).toHaveCount(0, { timeout: TIMEOUT.FIRST_PAINT });
  });
}

test('uploads a document and shows it queued for indexing', async ({
  page,
  org,
}) => {
  // Full ingestion needs the RAG service, which is NOT in the hermetic stack:
  // the upload commits the row and schedules indexing, the metadata starts
  // `queued`, then the scheduled action runs and — with no RAG backend to reach
  // — flips it to `failed`. So the deterministic outcome is the row landing in
  // a RAG-pipeline state: `Queued` (the brief pre-action window) or `Failed`
  // (the terminal state here). Asserting either avoids racing that transition.
  test.skip(
    !isMockLlmMode(),
    'document upload status assertion targets the hermetic stack',
  );

  const { organizationId } = org;
  await page.goto(`/dashboard/${organizationId}/documents`);
  await expectListSettled(
    page,
    t('documents.upload.importDocuments'),
    t('documents.emptyState.title'),
  );

  const suffix = Date.now().toString(36);
  const fileName = `e2e-doc-${suffix}.txt`;

  // Open the actions menu (header "Upload documents") → "From your device".
  await page
    .getByRole('button', { name: t('documents.upload.importDocuments') })
    .click();
  await page
    .getByRole('menuitem', { name: t('documents.upload.fromYourDevice') })
    .click();

  const dialog = page.getByRole('dialog', {
    name: t('documents.upload.importDocuments'),
  });
  await expect(dialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });

  // Attach an in-memory file via the drop zone's hidden file input (#document-
  // file-upload), then run the upload.
  await dialog.locator('#document-file-upload').setInputFiles({
    name: fileName,
    mimeType: 'text/plain',
    buffer: Buffer.from('hello e2e'),
  });
  await dialog
    .getByRole('button', { name: t('documents.upload.uploadDocuments') })
    .click();

  // The uploaded row appears carrying its filename. The name cell is an
  // "Open document <file>" button (so it has no bare-filename cell to match
  // exactly) — scope to the body row whose text includes the unique filename.
  const docRow = page.getByRole('row').filter({ hasText: fileName });
  await expect(docRow).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  // …and shows a RAG-pipeline badge: `Queued` while the index action is still
  // scheduled, or `Failed` once it runs with no RAG backend present. Either is
  // a valid landing state on the hermetic stack; match both to skip the race.
  const ragStatusBadge = new RegExp(
    `^(${t('documents.rag.status.queued')}|${t('documents.rag.status.failed')})$`,
  );
  await expect(docRow.getByText(ragStatusBadge).first()).toBeVisible({
    timeout: TIMEOUT.VISIBLE,
  });
});

test('opens the add-website dialog and renders its fields', async ({
  page,
  org,
}) => {
  const { organizationId } = org;
  await page.goto(`/dashboard/${organizationId}/websites`);
  await expectListSettled(
    page,
    t('websites.addButton'),
    t('emptyStates.websites.title'),
  );

  // Full website CRUD is NOT hermetic: creating a website inserts the row
  // synchronously, but editing the scan interval (`updateCrawlerScanInterval`)
  // and deleting (`deregisterDomainFromCrawler`) each make a synchronous call
  // to the crawler service (CRAWLER_URL, default localhost:8002), which the
  // hermetic e2e stack does not run — so a created row could neither be edited
  // nor cleaned up and would leak into the worker's org. We therefore assert
  // the add dialog opens and its fields render rather than creating an
  // undeletable row. The header button and empty-state CTA share the
  // "Add website" label and both open this dialog, so `.first()` is unambiguous.
  await page
    .getByRole('button', { name: t('websites.addButton') })
    .first()
    .click();

  const addDialog = page.getByRole('dialog', {
    name: t('websites.addWebsite'),
  });
  await expect(addDialog).toBeVisible({ timeout: TIMEOUT.VISIBLE });
  await expect(addDialog.getByLabel(t('websites.domain'))).toBeVisible();
  await expect(
    addDialog.getByText(t('websites.scanInterval')).first(),
  ).toBeVisible();
});
