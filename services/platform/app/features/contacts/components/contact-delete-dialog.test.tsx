import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { ContactDeleteDialog } from './contact-delete-dialog';

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('../hooks/mutations', () => ({
  useDeleteContact: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'test-org-id',
}));

function makeContact() {
  return {
    _id: 'contact-1' as never,
    _creationTime: Date.now(),
    organizationId: 'test-org-id',
    name: 'Test Contact',
    email: 'test@example.com',
    source: 'manual_import' as const,
    locale: 'en',
  };
}

describe('ContactDeleteDialog', () => {
  describe('accessibility', () => {
    it('passes axe audit when open', async () => {
      const { container } = render(
        <ContactDeleteDialog
          contact={makeContact()}
          isOpen={true}
          onOpenChange={vi.fn()}
          asChild
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with trigger button', async () => {
      const { container } = render(
        <ContactDeleteDialog contact={makeContact()} />,
      );
      await checkAccessibility(container);
    });
  });
});
