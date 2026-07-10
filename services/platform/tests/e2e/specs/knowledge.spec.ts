import { type Locator, type Page } from '@playwright/test';

import { isMockLlmMode, TIMEOUT } from '../helpers/env';
import { test, expect } from '../helpers/fixtures';
import { t } from '../helpers/i18n';

/**
 * Knowledge-entity CRUD round-trip, parametrized over the shared DataTable
 * lists. Create carries its own `create` per entity (contacts uses CSV
 * manual-entry); edit/delete are shared because only the manually-created rows
 * expose those actions.
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
   * exact-name cell match), which is correct for the text-only name cell
   * (contacts). Override per entity when the name cell isn't a plain text cell.
   */
  rowByName?: (page: Page, name: string) => Locator;
}

/** CSV manual-entry create (contacts): one `email,name` line. */
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
    segment: 'contacts',
    createLabel: t('contacts.importMenu.importContacts'),
    emptyStateTitle: t('emptyStates.contacts.title'),
    editDialogTitle: t('contacts.editContact'),
    deleteDialogTitle: t('contacts.deleteContact'),
    nameFieldLabel: t('contacts.name'),
    updateSuccess: t('contacts.updateSuccess'),
    create: (page, name) =>
      createViaCsvImport(page, {
        menuTrigger: t('contacts.importMenu.importContacts'),
        menuItem: t('contacts.importMenu.manualEntry'),
        dialogTitle: t('contacts.import.addContacts'),
        importLabel: t('common.actions.import'),
        email: `e2e-contact-${name.split(' ').pop() ?? ''}@example.test`,
        name,
      }),
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

test('accepts an ODT upload for indexing', async ({ page, org }) => {
  // Regression for the ODT-ingestion work item: `.odt` was previously rejected
  // as an unsupported type, so no row was ever created. Now it's an accepted
  // document format — the deterministic, RAG-independent proof is that the
  // upload creates a row and reaches a RAG-pipeline badge (`Queued`/`Failed`),
  // exactly like any other accepted type on the hermetic stack. A rejected type
  // would surface an "unsupported file type" toast and never stage a row.
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
  const fileName = `e2e-doc-${suffix}.odt`;

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

  // A real ODF file is a zip; acceptance is gated on MIME/extension, not
  // structure (indexing lands `Failed` with no RAG backend regardless), so an
  // in-memory buffer with the ODT MIME type exercises the accept path.
  await dialog.locator('#document-file-upload').setInputFiles({
    name: fileName,
    mimeType: 'application/vnd.oasis.opendocument.text',
    buffer: Buffer.from('odt e2e'),
  });
  await dialog
    .getByRole('button', { name: t('documents.upload.uploadDocuments') })
    .click();

  const docRow = page.getByRole('row').filter({ hasText: fileName });
  await expect(docRow).toBeVisible({ timeout: TIMEOUT.FIRST_PAINT });

  const ragStatusBadge = new RegExp(
    `^(${t('documents.rag.status.queued')}|${t('documents.rag.status.failed')})$`,
  );
  await expect(docRow.getByText(ragStatusBadge).first()).toBeVisible({
    timeout: TIMEOUT.VISIBLE,
  });
});
