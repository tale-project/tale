// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { CustomerRowActions } from './customer-row-actions';
import { CustomersActionMenu } from './customers-action-menu';

/**
 * Component-level mirror of the knowledge.spec.ts e2e
 * "creates, edits and deletes a customers entity".
 *
 * The shared edit/delete persistence round-trip is proven e2e by the vendors
 * entity (which stays). Here we cover the CUSTOMER-specific dialog UI the e2e
 * drives — the CSV manual-entry create dialog, the row-actions → edit dialog,
 * and the row-actions → delete confirmation — with the mutations mocked, so we
 * assert the same observable behaviour (the right mutation fires with the
 * right payload) without a backend.
 */

const mockBulkCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockToast = vi.fn();

vi.mock('@/app/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

vi.mock('../hooks/mutations', () => ({
  useBulkCreateCustomers: () => ({ mutateAsync: mockBulkCreate }),
  useUpdateCustomer: () => ({ mutateAsync: mockUpdate }),
  useDeleteCustomer: () => ({ mutateAsync: mockDelete }),
}));

// A writer sees the create affordance + row edit/delete actions.
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

function makeCustomer(overrides = {}) {
  return {
    _id: 'customer-1' as never,
    _creationTime: Date.now(),
    organizationId: 'org-1',
    name: 'E2E customers seed',
    email: 'seed@example.test',
    status: 'active' as const,
    source: 'manual_import' as const,
    locale: 'en',
    ...overrides,
  };
}

describe('customers CRUD (e2e migration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBulkCreate.mockResolvedValue({ success: 1, failed: 0, errors: [] });
    mockUpdate.mockResolvedValue(undefined);
    mockDelete.mockResolvedValue(undefined);
  });

  // --- Create: action menu → Manual entry → CSV line → Import ---------------
  it('creates a customer via the CSV manual-entry dialog', async () => {
    const { user } = render(<CustomersActionMenu organizationId="org-1" />);

    // Header create affordance (a writer always sees it).
    await user.click(screen.getByRole('button', { name: 'Import customers' }));
    await user.click(
      await screen.findByRole('menuitem', { name: 'Manual entry' }),
    );

    // The CSV manual-entry dialog opens.
    const dialog = await screen.findByRole('dialog', { name: 'Add customers' });

    // Header-less positional CSV: one `email,name` line creates exactly one
    // manual_import row.
    const textbox = within(dialog).getByRole('textbox');
    await user.type(textbox, 'e2e-customer@example.test,E2E customers create');

    await user.click(within(dialog).getByRole('button', { name: /^Import$/ }));

    await waitFor(() => {
      expect(mockBulkCreate).toHaveBeenCalledWith({
        organizationId: 'org-1',
        customers: [
          {
            email: 'e2e-customer@example.test',
            name: 'E2E customers create',
            locale: 'en',
            status: 'active',
            source: 'manual_import',
          },
        ],
      });
    });
  });

  // --- Edit: row actions → Edit → prefilled name → rename → Save ------------
  it('edits a customer via the row actions menu', async () => {
    const { user } = render(
      <CustomerRowActions customer={makeCustomer({ name: 'E2E customers' })} />,
    );

    // Open the row's 3-dot actions menu, then the Edit item.
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));

    // The edit dialog opens with the name field prefilled.
    const dialog = await screen.findByRole('dialog', { name: 'Edit customer' });
    const nameField = within(dialog).getByDisplayValue('E2E customers');

    await user.clear(nameField);
    await user.type(nameField, 'E2E customers edited');

    await user.click(within(dialog).getByRole('button', { name: /^Save$/ }));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith({
        customerId: 'customer-1',
        name: 'E2E customers edited',
        email: 'seed@example.test',
        locale: 'en',
        status: 'active',
      });
    });

    // The post-edit success toast (customers.updateSuccess) fires.
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Customer updated successfully' }),
      );
    });
  });

  // --- Delete: row actions → Delete → confirm -------------------------------
  it('deletes a customer via the row actions menu', async () => {
    const { user } = render(
      <CustomerRowActions
        customer={makeCustomer({ name: 'E2E customers edited' })}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    // The delete confirmation dialog opens and names the entity.
    const dialog = await screen.findByRole('dialog', {
      name: 'Delete customer',
    });
    expect(
      within(dialog).getByText(/E2E customers edited/),
    ).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /^Delete$/ }));

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith({ customerId: 'customer-1' });
    });
  });

  describe('accessibility', () => {
    it('passes axe audit on the open create dialog', async () => {
      const { user, container } = render(
        <CustomersActionMenu organizationId="org-1" />,
      );
      await user.click(
        screen.getByRole('button', { name: 'Import customers' }),
      );
      await user.click(
        await screen.findByRole('menuitem', { name: 'Manual entry' }),
      );
      await screen.findByRole('dialog', { name: 'Add customers' });
      await checkAccessibility(container);
    });
  });
});
