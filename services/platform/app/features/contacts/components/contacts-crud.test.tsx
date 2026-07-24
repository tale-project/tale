// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { ContactRowActions } from './contact-row-actions';
import { ContactsActionMenu } from './contacts-action-menu';

/**
 * Component-level mirror of the knowledge.spec.ts e2e
 * "creates, edits and deletes a contacts entity".
 *
 * Covers the contact dialog UI the e2e drives — the CSV manual-entry create
 * dialog, the row-actions → edit dialog, and the row-actions → delete
 * confirmation — with the mutations mocked, so we assert the same observable
 * behaviour (the right mutation fires with the right payload) without a backend.
 */

const mockBulkCreate = vi.fn();
const mockCreate = vi.fn();
const mockUpdate = vi.fn();
const mockDelete = vi.fn();
const mockToast = vi.fn();

vi.mock('@/app/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

vi.mock('../hooks/mutations', () => ({
  useBulkCreateContacts: () => ({ mutateAsync: mockBulkCreate }),
  useCreateContact: () => ({ mutateAsync: mockCreate }),
  useUpdateContact: () => ({ mutateAsync: mockUpdate }),
  useDeleteContact: () => ({ mutateAsync: mockDelete }),
}));

// A writer sees the create affordance + row edit/delete actions.
vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true, cannot: () => false }),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

function makeContact(overrides = {}) {
  return {
    _id: 'contact-1' as never,
    _creationTime: Date.now(),
    organizationId: 'org-1',
    name: 'E2E contacts seed',
    email: 'seed@example.test',
    phone: '+1-555-0100',
    source: 'manual_import' as const,
    locale: 'en',
    ...overrides,
  };
}

describe('contacts CRUD (e2e migration)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockBulkCreate.mockResolvedValue({ success: 1, failed: 0, errors: [] });
    mockCreate.mockResolvedValue({ success: true, contactId: 'contact-new' });
    mockUpdate.mockResolvedValue(undefined);
    mockDelete.mockResolvedValue(undefined);
  });

  // --- Create: Add contact menu → Paste contacts → CSV line → Import
  it('creates a contact via the CSV paste-contacts dialog', async () => {
    const { user } = render(<ContactsActionMenu organizationId="org-1" />);

    // One combined "Add contact" button (mirroring products): manual entry
    // and both bulk-import paths live in its menu. The structured
    // single-contact dialog is covered by contact-create-dialog.test.tsx.
    await user.click(screen.getByRole('button', { name: 'Add contact' }));
    await user.click(
      await screen.findByRole('menuitem', { name: 'Paste contacts' }),
    );

    // The CSV paste dialog opens.
    const dialog = await screen.findByRole('dialog', {
      name: 'Paste contacts',
    });

    // Header-less positional CSV: one `email,name` line creates exactly one
    // manual_import row. Contacts carry no status column.
    const textbox = within(dialog).getByRole('textbox');
    await user.type(textbox, 'e2e-contact@example.test,E2E contacts create');

    await user.click(within(dialog).getByRole('button', { name: /^Import$/ }));

    await waitFor(() => {
      expect(mockBulkCreate).toHaveBeenCalledWith({
        organizationId: 'org-1',
        contacts: [
          {
            // No locale column in the CSV line — stored unset, not
            // fabricated as 'en' (#2642).
            email: 'e2e-contact@example.test',
            name: 'E2E contacts create',
            source: 'manual_import',
          },
        ],
      });
    });
  });

  // --- Edit: row actions → Edit → prefilled name → rename → Save ------------
  it('edits a contact via the row actions menu', async () => {
    const { user } = render(
      <ContactRowActions contact={makeContact({ name: 'E2E contacts' })} />,
    );

    // Open the row's 3-dot actions menu, then the Edit item.
    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Edit' }));

    // The edit dialog opens with the name field prefilled.
    const dialog = await screen.findByRole('dialog', { name: 'Edit contact' });
    const nameField = within(dialog).getByDisplayValue('E2E contacts');

    await user.clear(nameField);
    await user.type(nameField, 'E2E contacts edited');

    await user.click(within(dialog).getByRole('button', { name: /^Save$/ }));

    await waitFor(() => {
      expect(mockUpdate).toHaveBeenCalledWith({
        contactId: 'contact-1',
        name: 'E2E contacts edited',
        email: 'seed@example.test',
        phone: '+1-555-0100',
        locale: 'en',
      });
    });

    // The post-edit success toast (contacts.updateSuccess) fires.
    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ title: 'Contact updated successfully' }),
      );
    });
  });

  // --- Delete: row actions → Delete → confirm -------------------------------
  it('deletes a contact via the row actions menu', async () => {
    const { user } = render(
      <ContactRowActions
        contact={makeContact({ name: 'E2E contacts edited' })}
      />,
    );

    await user.click(screen.getByRole('button', { name: 'Open menu' }));
    await user.click(await screen.findByRole('menuitem', { name: 'Delete' }));

    // The delete confirmation dialog opens and names the entity.
    const dialog = await screen.findByRole('dialog', {
      name: 'Delete contact',
    });
    expect(within(dialog).getByText(/E2E contacts edited/)).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /^Delete$/ }));

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith({ contactId: 'contact-1' });
    });
  });

  describe('accessibility', () => {
    it('passes axe audit on the open create dialog', async () => {
      const { user, container } = render(
        <ContactsActionMenu organizationId="org-1" />,
      );
      await user.click(screen.getByRole('button', { name: 'Add contact' }));
      await user.click(
        await screen.findByRole('menuitem', { name: 'Paste contacts' }),
      );
      await screen.findByRole('dialog', { name: 'Paste contacts' });
      await checkAccessibility(container);
    });
  });
});
