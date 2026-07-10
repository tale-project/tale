import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { ContactRowActions } from './contact-row-actions';

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('../hooks/mutations', () => ({
  useDeleteContact: () => ({ mutateAsync: vi.fn() }),
  useUpdateContact: () => ({ mutateAsync: vi.fn() }),
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

describe('ContactRowActions', () => {
  describe('accessibility', () => {
    it('passes axe audit with editable contact', async () => {
      const { container } = render(
        <ContactRowActions contact={makeContact()} />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with file_upload source', async () => {
      const contact = { ...makeContact(), source: 'file_upload' as const };
      const { container } = render(<ContactRowActions contact={contact} />);
      await checkAccessibility(container);
    });
  });
});
