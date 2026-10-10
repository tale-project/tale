import { afterEach, describe, expect, it, vi } from 'vitest';

import type { ContactDoc } from '@/app/lib/backend/contract/docs';
import { engagementPaginatedAdapters } from '@/app/lib/backend/engagement';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { ContactViewDialog } from './contact-view-dialog';

const mockNavigate = vi.fn();
let mockCanWrite = true;

vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useNavigate: () => mockNavigate,
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

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
  useUpdateContact: () => ({ mutateAsync: vi.fn() }),
}));

function makeContactDoc(overrides = {}) {
  return {
    _id: 'contact-1' as never,
    _creationTime: Date.now(),
    organizationId: 'org-1',
    name: 'John Doe',
    email: 'john@example.com',
    source: 'manual_import' as const,
    locale: 'en',
    ...overrides,
  };
}

function renderDialog(overrides = {}, onClose = vi.fn()) {
  return render(
    <ContactViewDialog
      isOpen
      onClose={onClose}
      contact={makeContactDoc(overrides)}
    />,
  );
}

describe('ContactViewDialog', () => {
  it('names the contact and lists its details', () => {
    renderDialog({ phone: '+1-555-0123', notes: 'Prefers email' });

    const dialog = screen.getByRole('dialog', { name: 'Contact details' });
    expect(
      within(dialog).getByRole('heading', { name: 'John Doe' }),
    ).toBeInTheDocument();
    const emailLabel = within(dialog).getByText('Email', {
      selector: 'dt span',
    });
    expect(emailLabel.closest('div')?.querySelector('dd')).toHaveTextContent(
      'john@example.com',
    );
    expect(within(dialog).getByText('+1-555-0123')).toBeInTheDocument();
    expect(within(dialog).getByText('Prefers email')).toBeInTheDocument();
    expect(within(dialog).getByText('contact-1')).toBeInTheDocument();
  });

  it('falls back to the email as the heading when the name is missing', () => {
    renderDialog({ name: undefined });

    expect(
      screen.getByRole('heading', { name: 'john@example.com' }),
    ).toBeInTheDocument();
  });

  it('localizes the raw source enum instead of printing it verbatim (#2643)', () => {
    renderDialog();

    expect(screen.getByText('Manual')).toBeInTheDocument();
    expect(screen.queryByText('manual_import')).not.toBeInTheDocument();
  });

  it('renders an em-dash instead of fabricating a locale when unset (#2642)', () => {
    renderDialog({ locale: undefined });

    expect(screen.getByText('—')).toBeInTheDocument();
    expect(screen.queryByText('en')).not.toBeInTheDocument();
  });

  // --- Address (#3625) -------------------------------------------------------
  // `address` is a free-form object on the door: any JSON under any key is a
  // valid stored address, so the details must read it, never trust a field to
  // be a string.
  describe('address', () => {
    afterEach(() => {
      vi.restoreAllMocks();
    });

    /** The contact as the API reads it back, handed to the dialog through the
     *  contacts table's real page adapter. */
    async function apiContact(address: unknown): Promise<ContactDoc> {
      vi.spyOn(window, 'fetch').mockResolvedValue(
        new Response(
          JSON.stringify({
            items: [
              {
                id: 'contact-1',
                organizationId: 'org-1',
                name: 'John Doe',
                email: 'john@example.com',
                phone: null,
                externalId: null,
                source: 'api_import',
                locale: 'en',
                address,
                tags: [],
                metadata: null,
                notes: null,
                lifecycleStatus: 'active',
                createdAt: 1_789_383_600_000,
                updatedAt: 1_789_383_600_000,
              },
            ],
            nextCursor: null,
          }),
        ),
      );
      const adapter = engagementPaginatedAdapters[
        'contacts/queries:listContactsPaginated'
      ]?.({}, { organizationId: 'org-1' });
      const result = await adapter?.fetchPage(null, 20);
      return result?.page[0] as ContactDoc;
    }

    /** The lines the Address fact shows, or null when there is no such fact. */
    function addressLines(dialog: HTMLElement): (string | null)[] | null {
      const label = within(dialog).queryByText('Address', {
        selector: 'dt span',
      });
      const value = label?.closest('div')?.querySelector('dd');
      if (!value) return null;
      return Array.from(
        value.querySelectorAll('p'),
        (line) => line.textContent,
      );
    }

    async function renderApiContact(address: unknown) {
      render(
        <ContactViewDialog
          isOpen
          onClose={vi.fn()}
          contact={await apiContact(address)}
        />,
      );
      return screen.getByRole('dialog', { name: 'Contact details' });
    }

    it('shows a nested street as its words and keeps the other details readable', async () => {
      const dialog = await renderApiContact({
        street: { line1: 'One Test Street' },
        country: 'Switzerland',
      });

      expect(addressLines(dialog)).toEqual(['One Test Street', 'Switzerland']);
      expect(
        within(dialog).getByRole('heading', { name: 'John Doe' }),
      ).toBeInTheDocument();
      expect(within(dialog).getByText('john@example.com')).toBeInTheDocument();
      expect(within(dialog).getByText('contact-1')).toBeInTheDocument();
      expect(
        within(dialog).queryByRole('button', { name: 'Try again' }),
      ).not.toBeInTheDocument();
    });

    it('shows a flat address line by line', async () => {
      const dialog = await renderApiContact({
        street: 'One Test Street',
        city: 'Zurich',
        state: 'ZH',
        postalCode: '8001',
        country: 'Switzerland',
      });

      expect(addressLines(dialog)).toEqual([
        'One Test Street',
        'Zurich, ZH',
        '8001',
        'Switzerland',
      ]);
    });

    it('reads lists, numbers and deeper nesting under any field', async () => {
      const dialog = await renderApiContact({
        street: ['One Test Street', { unit: 'Apt 4' }],
        city: { name: 'Zurich' },
        state: { code: 'ZH', meta: { verified: true } },
        postalCode: 8001,
        country: { name: 'Switzerland', iso: ['CH'] },
      });

      expect(addressLines(dialog)).toEqual([
        'One Test Street, Apt 4',
        'Zurich, ZH',
        '8001',
        'Switzerland, CH',
      ]);
    });

    it('leaves out a field with no words to show', async () => {
      const dialog = await renderApiContact({
        street: { line1: '   ' },
        city: null,
        state: true,
        postalCode: [],
        country: 'Switzerland',
      });

      expect(addressLines(dialog)).toEqual(['Switzerland']);
    });

    it('shows no Address fact when none of its fields has words', async () => {
      const dialog = await renderApiContact({
        line1: 'One Test Street',
        street: {},
      });

      expect(addressLines(dialog)).toBeNull();
      expect(within(dialog).getByText('john@example.com')).toBeInTheDocument();
    });
  });

  // --- Edit / New email header actions (#2639) ------------------------------
  it('offers Edit and New email for an editable contact', () => {
    renderDialog();

    expect(screen.getByRole('button', { name: 'Edit' })).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'New email' }),
    ).toBeInTheDocument();
  });

  it('offers no Edit for a synced contact', () => {
    renderDialog({ source: 'conversation' as const });

    expect(
      screen.queryByRole('button', { name: 'Edit' }),
    ).not.toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: 'New email' }),
    ).toBeInTheDocument();
  });

  it('offers no Edit without write access', () => {
    mockCanWrite = false;
    try {
      renderDialog();

      expect(
        screen.queryByRole('button', { name: 'Edit' }),
      ).not.toBeInTheDocument();
    } finally {
      mockCanWrite = true;
    }
  });

  it('hides New email for a placeholder/unresolved address', () => {
    renderDialog({ email: 'unknown@example.com' });

    expect(
      screen.queryByRole('button', { name: 'New email' }),
    ).not.toBeInTheDocument();
  });

  it('closes and opens the compose pane on New email', async () => {
    const onClose = vi.fn();
    const { user } = renderDialog({}, onClose);

    await user.click(screen.getByRole('button', { name: 'New email' }));

    expect(onClose).toHaveBeenCalledOnce();
    expect(mockNavigate).toHaveBeenCalledWith(
      expect.objectContaining({
        search: { compose: 'new', composeContact: 'contact-1' },
      }),
    );
  });

  // Regression: Edit used to close the details through the table, which
  // unmounted the nested edit dialog before it could open.
  it('swaps to the edit dialog on Edit and back to the details on cancel', async () => {
    const onClose = vi.fn();
    const { user } = renderDialog({}, onClose);

    await user.click(screen.getByRole('button', { name: 'Edit' }));

    const editDialog = await screen.findByRole('dialog', {
      name: 'Edit contact',
    });
    expect(
      within(editDialog).getByDisplayValue('John Doe'),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();

    await user.click(
      within(editDialog).getByRole('button', { name: 'Cancel' }),
    );

    expect(
      await screen.findByRole('dialog', { name: 'Contact details' }),
    ).toBeInTheDocument();
    expect(onClose).not.toHaveBeenCalled();
  });

  it('closes the details once the edit is saved', async () => {
    const onClose = vi.fn();
    const { user } = renderDialog({}, onClose);

    await user.click(screen.getByRole('button', { name: 'Edit' }));
    const editDialog = await screen.findByRole('dialog', {
      name: 'Edit contact',
    });
    const nameField = within(editDialog).getByDisplayValue('John Doe');
    await user.clear(nameField);
    await user.type(nameField, 'Jane Doe');
    await user.click(within(editDialog).getByRole('button', { name: 'Save' }));

    await waitFor(() => expect(onClose).toHaveBeenCalledOnce());
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = renderDialog();
      await checkAccessibility(container);
    });

    it('passes axe audit with all optional fields', async () => {
      const { container } = renderDialog({
        phone: '+1-555-0123',
        address: {
          street: '456 Oak Ave',
          city: 'Portland',
          state: 'OR',
          postalCode: '97201',
          country: 'US',
        },
        tags: ['supplier', 'preferred'],
        notes: 'Reliable contact with fast responses',
      });
      await checkAccessibility(container);
    });

    it('passes axe audit with a nested address (#3625)', async () => {
      const { container } = renderDialog({
        address: {
          street: { line1: 'One Test Street', line2: 'Apt 4' },
          country: 'Switzerland',
        },
      });
      await checkAccessibility(container);
    });
  });
});
