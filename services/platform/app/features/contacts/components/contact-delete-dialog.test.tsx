import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { ContactDeleteDialog } from './contact-delete-dialog';

const mockDelete = vi.fn().mockResolvedValue(undefined);

vi.mock('@tale/ui/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('../hooks/mutations', () => ({
  useDeleteContact: () => ({ mutateAsync: mockDelete }),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'test-org-id',
}));

function makeContact(overrides = {}) {
  return {
    _id: 'contact-1' as never,
    _creationTime: Date.now(),
    organizationId: 'test-org-id',
    name: 'Test Contact',
    email: 'test@example.com',
    source: 'manual_import' as const,
    locale: 'en',
    ...overrides,
  };
}

describe('ContactDeleteDialog', () => {
  it('names the contact and deletes it on confirm', async () => {
    const onClose = vi.fn();
    const { user } = render(
      <ContactDeleteDialog isOpen onClose={onClose} contact={makeContact()} />,
    );

    const dialog = screen.getByRole('dialog', { name: 'Delete contact' });
    expect(within(dialog).getByText('Test Contact')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: 'Delete' }));

    await waitFor(() => {
      expect(mockDelete).toHaveBeenCalledWith({ contactId: 'contact-1' });
    });
    expect(onClose).toHaveBeenCalled();
  });

  it('names a nameless contact by its email', () => {
    render(
      <ContactDeleteDialog
        isOpen
        onClose={vi.fn()}
        contact={makeContact({ name: undefined })}
      />,
    );

    expect(screen.getByText('test@example.com')).toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe audit when open', async () => {
      const { container } = render(
        <ContactDeleteDialog
          isOpen
          onClose={vi.fn()}
          contact={makeContact()}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
