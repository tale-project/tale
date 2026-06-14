import { expect, test, type Page } from '@playwright/test';

import { t } from '../helpers/i18n';
import { readRunContext } from '../helpers/test-context';

/**
 * Knowledge (CRM-like) entity coverage.
 *
 * The Knowledge section lives behind the pathless `_knowledge` layout route, so
 * every entity list is reachable at `/dashboard/$id/<entity>` (customers,
 * products, vendors, websites, documents, knowledge-entries). Each list is a
 * shared `DataTable` fed by a Convex paginated query behind a skeleton (whose
 * rows carry no text). The seeded fixture org ships only one
 * agent/provider/workflow/prompt — NO knowledge entities — so each list starts
 * empty and paints its empty-state.
 *
 *  (a) `renders the … list` — one parametrized test per entity that visits the
 *      route and waits for the list to SETTLE: either the header action menu
 *      (always rendered for a writer) OR the empty-state title appeared. This
 *      mirrors `automation.spec.ts`'s `installedRow.or(emptyState)` wait so the
 *      assertion never reads mid-skeleton.
 *
 *  (b) `creates, edits and deletes a customer` — a full CRUD smoke on the one
 *      representative entity that supports a hermetic create (CUSTOMERS): the
 *      manual-entry import takes a CSV line (`email,name`) with NO header row
 *      (`parseCSV` runs header-less because the customer mapper passes no
 *      recordMapper), so a single line creates exactly one `manual_import`
 *      customer — which is the only `source` whose rows expose edit/delete
 *      actions. The row is created with a unique suffix, edited (rename), then
 *      deleted so the spec is idempotent and leaves the shared org as it found
 *      it (empty customers list).
 *
 * Documents are intentionally list-only here: creating a document needs a real
 * file upload (and ingestion needs embeddings, which the mock LLM does not
 * serve), so it is not hermetic — see the parametrized render coverage and the
 * note on the `documents` case below.
 */

interface KnowledgeRoute {
  /** URL segment under `/dashboard/$id/`. */
  segment: string;
  /** Header action-menu trigger label (a writer always sees it). */
  actionMenuLabel: string;
  /** Empty-state title shown when the list has no rows. */
  emptyStateTitle: string;
}

// documents resolves its empty-state from its own `documents` namespace; the
// rest share the `emptyStates.<entity>` catalog.
const KNOWLEDGE_ROUTES: KnowledgeRoute[] = [
  {
    segment: 'customers',
    actionMenuLabel: t('customers.importMenu.importCustomers'),
    emptyStateTitle: t('emptyStates.customers.title'),
  },
  {
    segment: 'products',
    actionMenuLabel: t('products.addButton'),
    emptyStateTitle: t('emptyStates.products.title'),
  },
  {
    segment: 'vendors',
    actionMenuLabel: t('vendors.importMenu.importVendors'),
    emptyStateTitle: t('emptyStates.vendors.title'),
  },
  {
    segment: 'websites',
    actionMenuLabel: t('websites.addButton'),
    emptyStateTitle: t('emptyStates.websites.title'),
  },
  {
    // List-only: a hermetic document create would need a real file upload, and
    // ingestion needs embeddings the mock LLM doesn't serve. Asserting the
    // list/empty-state loads is the most we can do here.
    segment: 'documents',
    actionMenuLabel: t('documents.upload.importDocuments'),
    emptyStateTitle: t('documents.emptyState.title'),
  },
  {
    segment: 'knowledge-entries',
    actionMenuLabel: t('knowledgeEntries.addButton'),
    emptyStateTitle: t('emptyStates.knowledgeEntries.title'),
  },
];

/**
 * Wait for a knowledge list to finish its skeleton load. The header action
 * menu renders immediately for a writer regardless of row count, and the
 * empty-state title appears once a genuinely empty list settles — so either one
 * being visible means the page rendered (and isn't mid-skeleton).
 */
async function expectKnowledgeListRendered(
  page: Page,
  route: KnowledgeRoute,
): Promise<void> {
  const actionMenu = page.getByRole('button', {
    name: route.actionMenuLabel,
  });
  const emptyState = page.getByText(route.emptyStateTitle);
  await expect(actionMenu.or(emptyState).first()).toBeVisible({
    timeout: 60_000,
  });
}

for (const route of KNOWLEDGE_ROUTES) {
  test(`renders the ${route.segment} knowledge list`, async ({ page }) => {
    const { organizationId } = readRunContext();
    await page.goto(`/dashboard/${organizationId}/${route.segment}`);
    await expectKnowledgeListRendered(page, route);
  });
}

test('creates, edits and deletes a customer', async ({ page }) => {
  const { organizationId } = readRunContext();
  await page.goto(`/dashboard/${organizationId}/customers`);

  const customersRoute = KNOWLEDGE_ROUTES[0];
  if (!customersRoute) throw new Error('customers route missing');
  await expectKnowledgeListRendered(page, customersRoute);

  // Unique per run so the derived email never collides on the shared backend
  // (a duplicate email would make the bulk-create report zero imported).
  const suffix = Date.now().toString(36);
  const name = `E2E Customer ${suffix}`;
  const renamed = `${name} edited`;
  const email = `e2e-${suffix}@example.test`;

  // --- Create: open the import menu → manual entry → submit one CSV line. ---
  await page
    .getByRole('button', { name: t('customers.importMenu.importCustomers') })
    .click();
  await page
    .getByRole('menuitem', { name: t('customers.importMenu.manualEntry') })
    .click();

  // The manual-entry dialog ("Add customers") hosts a single CSV textarea.
  const createDialog = page.getByRole('dialog', {
    name: t('customers.import.addCustomers'),
  });
  await expect(createDialog).toBeVisible({ timeout: 20_000 });
  // header-less CSV: `email,name` → one manual_import customer named `name`.
  await createDialog.getByRole('textbox').first().fill(`${email},${name}`);
  await createDialog
    .getByRole('button', { name: t('customers.import.import'), exact: true })
    .click();

  // The new row appears in the list (optimistic + reactive subscription). Scope
  // by the exact name cell so partial matches don't bleed across rows.
  const createdRow = page.getByRole('row').filter({
    has: page.getByRole('cell', { name, exact: true }),
  });
  await expect(createdRow).toBeVisible({ timeout: 60_000 });

  // --- Edit: open the row actions menu → Edit → rename → save. ---
  await createdRow
    .getByRole('button', { name: t('common.actions.openMenu') })
    .click();
  await page.getByRole('menuitem', { name: t('common.actions.edit') }).click();

  const editDialog = page.getByRole('dialog', {
    name: t('customers.editCustomer'),
  });
  await expect(editDialog).toBeVisible({ timeout: 20_000 });
  const nameField = editDialog.getByLabel(t('customers.name'));
  await expect(nameField).toHaveValue(name);
  await nameField.fill(renamed);
  await editDialog
    .getByRole('button', { name: t('common.actions.save'), exact: true })
    .click();

  // The save toast confirms the round-trip; the renamed row then shows in-list.
  await expect(
    page.getByText(t('customers.updateSuccess')).first(),
  ).toBeVisible({ timeout: 20_000 });
  const renamedRow = page.getByRole('row').filter({
    has: page.getByRole('cell', { name: renamed, exact: true }),
  });
  await expect(renamedRow).toBeVisible({ timeout: 60_000 });

  // --- Delete: row actions menu → Delete → confirm in the dialog. ---
  await renamedRow
    .getByRole('button', { name: t('common.actions.openMenu') })
    .click();
  await page
    .getByRole('menuitem', { name: t('common.actions.delete') })
    .click();

  const deleteDialog = page.getByRole('dialog', {
    name: t('customers.deleteCustomer'),
  });
  await expect(deleteDialog).toBeVisible({ timeout: 20_000 });
  // The confirm button defaults to common.actions.delete (same label as the
  // menu item), so scope it to the dialog to keep the locator unambiguous.
  await deleteDialog
    .getByRole('button', { name: t('common.actions.delete'), exact: true })
    .click();

  // Gone from the list — restores the shared org to an empty customers list.
  await expect(renamedRow).toHaveCount(0, { timeout: 60_000 });
});
