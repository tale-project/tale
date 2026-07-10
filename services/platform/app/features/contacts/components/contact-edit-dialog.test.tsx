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

  it('blocks submission when the name is cleared', async () => {
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

    // Required-name validation must block the no-op update entirely:
    // no mutation fires, no misleading success toast, and the dialog
    // stays open so the user can correct the empty name.
    await waitFor(() => {
      expect(mockMutateAsync).not.toHaveBeenCalled();
    });
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
