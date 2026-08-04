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
 * Covers the contact dialog UI the e2e drives — the Add-contact menu and its
 * file-upload import dialog, the row-actions → edit dialog, and the
 * row-actions → delete confirmation — with the mutations mocked, so we assert
 * the same observable behaviour (the right mutation fires with the right
 * payload) without a backend. The CSV/spreadsheet parsing itself is covered by
 * use-file-import.test.ts.
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

  // --- Create: Add contact menu → the two ways in
  it('offers exactly manual entry and a file import', async () => {
    const { user } = render(<ContactsActionMenu organizationId="org-1" />);

    // One combined "Add contact" button (mirroring products): manual entry
    // and the file import live in its menu. The structured single-contact
    // dialog is covered by contact-create-dialog.test.tsx.
    await user.click(screen.getByRole('button', { name: 'Add contact' }));

    const items = await screen.findAllByRole('menuitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Manual entry',
      'From your device',
    ]);
  });

  it('opens the file-upload import dialog from the menu', async () => {
    const { user } = render(<ContactsActionMenu organizationId="org-1" />);

    await user.click(screen.getByRole('button', { name: 'Add contact' }));
    await user.click(
      await screen.findByRole('menuitem', { name: 'From your device' }),
    );

    const dialog = await screen.findByRole('dialog', {
      name: 'Upload contacts',
    });
    // The file picker is the only data source — there is no CSV textbox.
    expect(within(dialog).queryByRole('textbox')).toBeNull();
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
        expect.objectContaining({ title: 'Contact updated' }),
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
        await screen.findByRole('menuitem', { name: 'From your device' }),
      );
      await screen.findByRole('dialog', { name: 'Upload contacts' });
      await checkAccessibility(container);
    });
  });
});
