// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import { ContactEditDialog } from './contact-edit-dialog';

const mockMutateAsync = vi.fn();
const mockToast = vi.fn();

vi.mock('@/app/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

vi.mock('../hooks/mutations', () => ({
  useUpdateContact: () => ({ mutateAsync: mockMutateAsync }),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

function makeContact(overrides = {}) {
  return {
    _id: 'contact-1' as never,
    _creationTime: Date.now(),
    organizationId: 'org-1',
    email: 'test@example.com',
    phone: '+1-555-0100',
    source: 'manual_import' as const,
    locale: 'en',
    ...overrides,
  };
}

describe('ContactEditDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync.mockResolvedValue(undefined);
  });

  it('renders with contact data', () => {
    render(
      <ContactEditDialog
        contact={makeContact({ name: 'John' })}
        isOpen={true}
        onOpenChange={vi.fn()}
      />,
    );

    expect(screen.getByDisplayValue('John')).toBeInTheDocument();
    expect(screen.getByDisplayValue('test@example.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('+1-555-0100')).toBeInTheDocument();
  });

  it('allows saving with an empty name, matching import (#2640)', async () => {
    const onOpenChange = vi.fn();
    const { user } = render(
      <ContactEditDialog
        contact={makeContact({ name: 'John' })}
        isOpen={true}
        onOpenChange={onOpenChange}
      />,
    );

    const nameInput = screen.getByDisplayValue('John');
    await user.clear(nameInput);

    const submitButton = screen.getByRole('button', { name: /save/i });
    await user.click(submitButton);

    // Bulk import already allows a name-less contact (email alone); edit must
    // agree instead of stranding those rows behind a fabricated name. Sent as
    // `''`, not `undefined` — `updateContact` treats `undefined` args as
    // "unchanged" (see `convex/contacts/update_contact.ts`), so `undefined`
    // here would silently skip patching and leave the old name in the DB
    // behind a misleading success toast.
    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ name: '' }),
      );
    });
  });

  it('clears an existing phone number instead of silently keeping it', async () => {
    const onOpenChange = vi.fn();
    const { user } = render(
      <ContactEditDialog
        contact={makeContact({ name: 'John' })}
        isOpen={true}
        onOpenChange={onOpenChange}
      />,
    );

    const phoneInput = screen.getByDisplayValue('+1-555-0100');
    await user.clear(phoneInput);

    const submitButton = screen.getByRole('button', { name: /save/i });
    await user.click(submitButton);

    // Phone was already optional before #2640 — same "clear must persist"
    // requirement applies: `''`, not `undefined`.
    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ phone: '' }),
      );
    });
  });

  it('shows a visible, localized inline error when a required field is emptied', async () => {
    const onOpenChange = vi.fn();
    const { user } = render(
      <ContactEditDialog
        contact={makeContact({ name: 'John' })}
        isOpen={true}
        onOpenChange={onOpenChange}
      />,
    );

    const emailInput = screen.getByDisplayValue('test@example.com');
    await user.clear(emailInput);

    const submitButton = screen.getByRole('button', { name: /save/i });
    await user.click(submitButton);

    // Required-email validation must block the no-op update entirely: no
    // mutation fires, no misleading success toast, the dialog stays open,
    // AND the field renders a visible inline error (#2640 — previously the
    // native HTML `required` attribute intercepted the submit before React
    // Hook Form ran, so nothing was ever shown).
    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(mockMutateAsync).not.toHaveBeenCalled();
    expect(mockToast).not.toHaveBeenCalledWith(
      expect.objectContaining({ variant: 'success' }),
    );
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  it('submits with name when contact has a name', async () => {
    const onOpenChange = vi.fn();
    const { user } = render(
      <ContactEditDialog
        contact={makeContact({ name: 'John' })}
        isOpen={true}
        onOpenChange={onOpenChange}
      />,
    );

    const nameInput = screen.getByDisplayValue('John');
    await user.clear(nameInput);
    await user.type(nameInput, 'Jane');

    const submitButton = screen.getByRole('button', { name: /save/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        contactId: 'contact-1',
        name: 'Jane',
        email: 'test@example.com',
        phone: '+1-555-0100',
        locale: 'en',
      });
    });
  });

  it('shows error toast on failure', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Network error'));

    const onOpenChange = vi.fn();
    const { user } = render(
      <ContactEditDialog
        contact={makeContact({ name: 'John' })}
        isOpen={true}
        onOpenChange={onOpenChange}
      />,
    );

    const nameInput = screen.getByDisplayValue('John');
    await user.clear(nameInput);
    await user.type(nameInput, 'Jane');

    const submitButton = screen.getByRole('button', { name: /save/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'destructive' }),
      );
    });

    expect(onOpenChange).not.toHaveBeenCalledWith(false);
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <ContactEditDialog
          contact={makeContact({ name: 'John' })}
          isOpen={true}
          onOpenChange={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
