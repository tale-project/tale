import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { ContactRowActions } from './contact-row-actions';

let mockCanWrite = true;

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({
    can: () => mockCanWrite,
    cannot: () => !mockCanWrite,
  }),
}));

vi.mock('@tale/ui/use-toast', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tale/ui/use-toast')>()),
  toast: vi.fn(),
}));

vi.mock('../hooks/mutations', () => ({
  useDeleteContact: () => ({ mutateAsync: vi.fn() }),
  useUpdateContact: () => ({ mutateAsync: vi.fn() }),
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

async function openMenu(contact = makeContact()) {
  const { user } = render(<ContactRowActions contact={contact} />);
  await user.click(screen.getByRole('button', { name: 'Open menu' }));
  const items = await screen.findAllByRole('menuitem');
  return { user, labels: items.map((item) => item.textContent) };
}

describe('ContactRowActions', () => {
  it('offers View, Edit, New email, then Delete', async () => {
    const { labels } = await openMenu();

    expect(labels).toEqual(['View', 'Edit', 'New email', 'Delete']);
  });

  it('still offers View to a member who cannot edit', async () => {
    mockCanWrite = false;
    try {
      const { labels } = await openMenu(
        makeContact({ email: 'unknown@example.com' }),
      );

      expect(labels).toEqual(['View']);
    } finally {
      mockCanWrite = true;
    }
  });

  it('opens the contact details from View', async () => {
    const { user } = await openMenu();

    await user.click(screen.getByRole('menuitem', { name: 'View' }));

    expect(
      await screen.findByRole('dialog', { name: 'Contact details' }),
    ).toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe audit with editable contact', async () => {
      const { container } = render(
        <ContactRowActions contact={makeContact()} />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with file_upload source', async () => {
      const contact = makeContact({ source: 'file_upload' as const });
      const { container } = render(<ContactRowActions contact={contact} />);
      await checkAccessibility(container);
    });
  });
});
