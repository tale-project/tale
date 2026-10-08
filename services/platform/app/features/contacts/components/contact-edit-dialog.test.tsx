// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { AppError } from '@/lib/shared/errors/app-error';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import { ContactEditDialog } from './contact-edit-dialog';

const mockMutateAsync = vi.fn();
const mockToast = vi.fn();

const PHONE_MESSAGE = 'Enter a phone number using digits and + ( ) - only';

vi.mock('@tale/ui/use-toast', () => ({
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
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByDisplayValue('John')).toBeInTheDocument();
    expect(screen.getByDisplayValue('test@example.com')).toBeInTheDocument();
    expect(screen.getByDisplayValue('+1-555-0100')).toBeInTheDocument();
  });

  it('allows saving with an empty name, matching import (#2640)', async () => {
    const onClose = vi.fn();
    const { user } = render(
      <ContactEditDialog
        contact={makeContact({ name: 'John' })}
        isOpen={true}
        onClose={onClose}
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
    const onClose = vi.fn();
    const { user } = render(
      <ContactEditDialog
        contact={makeContact({ name: 'John' })}
        isOpen={true}
        onClose={onClose}
      />,
    );

    const phoneInput = screen.getByDisplayValue('+1-555-0100');
    await user.clear(phoneInput);

    const submitButton = screen.getByRole('button', { name: /save/i });
    await user.click(submitButton);

    // Phone was already optional before #2640 — same "clear must persist"
    // requirement applies, as `null`: `undefined` is dropped as "unchanged",
    // and the door reads `''` as a phone that was not sent, so both kept the
    // old number behind a success toast.
    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith(
        expect.objectContaining({ phone: null }),
      );
    });
  });

  it('keeps letters typed into the phone field and explains why', async () => {
    const onClose = vi.fn();
    const { user } = render(
      <ContactEditDialog
        contact={makeContact({ name: 'John' })}
        isOpen={true}
        onClose={onClose}
      />,
    );

    const phoneInput = screen.getByDisplayValue('+1-555-0100');
    await user.clear(phoneInput);
    await user.type(phoneInput, '00kkkk');

    // Never rewritten behind the person's back (#3825): what they typed
    // stays, and the field says why it can't be saved yet.
    expect(phoneInput).toHaveValue('00kkkk');
    expect(await screen.findByText(PHONE_MESSAGE)).toBeInTheDocument();
    expect(phoneInput).toHaveAttribute('aria-invalid', 'true');
  });

  // #3825 (duplicates #3824, #3826): the letters used to be stripped as they
  // were typed and the schema then passed the cleaned value, so Save sent
  // `00` for `00kkkk` and the only explanation vanished.
  describe('a phone holding a character no number has', () => {
    it.each(['00kkkk', '+41abc'])(
      'blocks Save on %s and keeps the error under the field',
      async (typed) => {
        const onClose = vi.fn();
        const { user } = render(
          <ContactEditDialog
            contact={makeContact({ name: 'John' })}
            isOpen={true}
            onClose={onClose}
          />,
        );

        const phoneInput = screen.getByDisplayValue('+1-555-0100');
        await user.clear(phoneInput);
        await user.type(phoneInput, typed);
        await user.click(screen.getByRole('button', { name: /save/i }));

        // The refused submit hands focus back to the field: proof the
        // submit's validation ran and failed, not merely that it is pending.
        await waitFor(() => {
          expect(phoneInput).toHaveFocus();
        });
        expect(phoneInput).toHaveValue(typed);
        expect(phoneInput).toHaveAttribute('aria-invalid', 'true');
        expect(screen.getByRole('alert')).toHaveTextContent(PHONE_MESSAGE);
        expect(mockMutateAsync).not.toHaveBeenCalled();
        expect(mockToast).not.toHaveBeenCalled();
        expect(onClose).not.toHaveBeenCalled();
      },
    );

    it('saves the number once the person removes the letters', async () => {
      const { user } = render(
        <ContactEditDialog
          contact={makeContact({ name: 'John' })}
          isOpen={true}
          onClose={vi.fn()}
        />,
      );

      const phoneInput = screen.getByDisplayValue('+1-555-0100');
      await user.clear(phoneInput);
      await user.type(phoneInput, '00kkkk');
      await user.click(screen.getByRole('button', { name: /save/i }));
      await waitFor(() => {
        expect(phoneInput).toHaveFocus();
      });

      await user.type(phoneInput, '{Backspace>4/}');
      expect(phoneInput).toHaveValue('00');
      await waitFor(() => {
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      });
      await user.click(screen.getByRole('button', { name: /save/i }));

      await waitFor(() => {
        expect(mockMutateAsync).toHaveBeenCalledWith({
          contactId: 'contact-1',
          name: 'John',
          email: 'test@example.com',
          phone: '00',
          locale: 'en',
        });
      });
    });

    it.each(['+41 79 123 45 67', '+1 (555) 010-0100', '079.123.45.67'])(
      'still saves %s, digits and phone punctuation only',
      async (number) => {
        const { user } = render(
          <ContactEditDialog
            contact={makeContact({ name: 'John' })}
            isOpen={true}
            onClose={vi.fn()}
          />,
        );

        const phoneInput = screen.getByDisplayValue('+1-555-0100');
        await user.clear(phoneInput);
        await user.paste(number);
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
        await user.click(screen.getByRole('button', { name: /save/i }));

        await waitFor(() => {
          expect(mockMutateAsync).toHaveBeenCalledWith(
            expect.objectContaining({ phone: number }),
          );
        });
      },
    );
  });

  it('shows a visible, localized inline error when a required field is emptied', async () => {
    const onClose = vi.fn();
    const { user } = render(
      <ContactEditDialog
        contact={makeContact({ name: 'John' })}
        isOpen={true}
        onClose={onClose}
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
    expect(onClose).not.toHaveBeenCalled();
  });

  it('submits with name when contact has a name', async () => {
    const onClose = vi.fn();
    const { user } = render(
      <ContactEditDialog
        contact={makeContact({ name: 'John' })}
        isOpen={true}
        onClose={onClose}
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

    const onClose = vi.fn();
    const { user } = render(
      <ContactEditDialog
        contact={makeContact({ name: 'John' })}
        isOpen={true}
        onClose={onClose}
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

    expect(onClose).not.toHaveBeenCalled();
  });

  it("keeps a refusal's field-naming reason on the toast", async () => {
    mockMutateAsync.mockRejectedValueOnce(
      new AppError({
        code: 'invalid body',
        message: 'phone: Too big: expected string to have <=50 characters',
      }),
    );
    const { user } = render(
      <ContactEditDialog
        contact={makeContact({ name: 'John' })}
        isOpen={true}
        onClose={vi.fn()}
      />,
    );

    await user.type(screen.getByDisplayValue('John'), 'ny');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Couldn't update contact",
          description:
            'phone: Too big: expected string to have <=50 characters',
          variant: 'destructive',
        }),
      );
    });
  });

  it("names a phone over the door's cap under its field and sends nothing", async () => {
    const { user } = render(
      <ContactEditDialog
        contact={makeContact({ name: 'John' })}
        isOpen={true}
        onClose={vi.fn()}
      />,
    );

    const phone = screen.getByDisplayValue('+1-555-0100');
    await user.clear(phone);
    await user.click(phone);
    await user.paste('1'.repeat(51));
    await user.click(screen.getByRole('button', { name: /save/i }));

    expect(
      await screen.findByText('Phone must be 50 characters or fewer'),
    ).toBeInTheDocument();
    expect(phone).toHaveAttribute('aria-invalid', 'true');
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <ContactEditDialog
          contact={makeContact({ name: 'John' })}
          isOpen={true}
          onClose={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
