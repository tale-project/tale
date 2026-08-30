// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendError } from '@/app/lib/backend/backend-error';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import { ContactCreateDialog } from './contact-create-dialog';

const mockMutateAsync = vi.fn();
const mockToast = vi.fn();

vi.mock('@/app/hooks/use-toast', () => ({
  toast: (...args: unknown[]) => mockToast(...args),
}));

vi.mock('../hooks/mutations', () => ({
  useCreateContact: () => ({ mutateAsync: mockMutateAsync }),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

describe('ContactCreateDialog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockMutateAsync.mockResolvedValue({ success: true, contactId: 'c1' });
  });

  it('renders an empty structured form (name, email, phone, locale)', () => {
    render(
      <ContactCreateDialog
        isOpen={true}
        onClose={vi.fn()}
        organizationId="org-1"
      />,
    );

    expect(screen.getByLabelText(/name/i)).toHaveValue('');
    expect(screen.getByLabelText(/email/i)).toHaveValue('');
    expect(screen.getByLabelText(/phone/i)).toHaveValue('');
  });

  it('shows a visible, localized inline error when required Email is empty', async () => {
    const onClose = vi.fn();
    const { user } = render(
      <ContactCreateDialog
        isOpen={true}
        onClose={onClose}
        organizationId="org-1"
      />,
    );

    // Save is disabled on a pristine form (`FormDialog` gates on `isDirty`) —
    // type into Name so the form is dirty while Email stays blank.
    await user.type(screen.getByLabelText(/name/i), 'Jane Doe');

    const submitButton = screen.getByRole('button', { name: /save/i });
    await user.click(submitButton);

    await waitFor(() => {
      expect(screen.getByRole('alert')).toBeInTheDocument();
    });
    expect(mockMutateAsync).not.toHaveBeenCalled();
  });

  it('creates a contact with a name, phone and email in one submit (#2639)', async () => {
    const onClose = vi.fn();
    const { user } = render(
      <ContactCreateDialog
        isOpen={true}
        onClose={onClose}
        organizationId="org-1"
      />,
    );

    await user.type(screen.getByLabelText(/name/i), 'Jane Doe');
    await user.type(screen.getByLabelText(/email/i), 'jane@example.com');
    await user.type(screen.getByLabelText(/phone/i), '+1 555 0100');

    await user.click(screen.getByRole('button', { name: /save/i }));

    // Reachable in ≤2 clicks (open dialog, submit) with phone included —
    // bulk import's "Manual entry" textarea has no phone field at all.
    await waitFor(() => {
      expect(mockMutateAsync).toHaveBeenCalledWith({
        organizationId: 'org-1',
        name: 'Jane Doe',
        email: 'jane@example.com',
        phone: '+1 555 0100',
        locale: 'en',
        source: 'manual_import',
      });
    });

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'success' }),
      );
    });
  });

  it('shows a duplicate-email error toast on CONTACT_DUPLICATE_EMAIL', async () => {
    mockMutateAsync.mockRejectedValueOnce(
      new BackendError({ code: 'CONTACT_DUPLICATE_EMAIL' }),
    );

    const { user } = render(
      <ContactCreateDialog
        isOpen={true}
        onClose={vi.fn()}
        organizationId="org-1"
      />,
    );

    await user.type(screen.getByLabelText(/email/i), 'dupe@example.com');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({
          title: 'A contact with this email already exists',
          variant: 'destructive',
        }),
      );
    });
  });

  it('shows a generic error toast on other failures', async () => {
    mockMutateAsync.mockRejectedValueOnce(new Error('Network error'));

    const { user } = render(
      <ContactCreateDialog
        isOpen={true}
        onClose={vi.fn()}
        organizationId="org-1"
      />,
    );

    await user.type(screen.getByLabelText(/email/i), 'jane@example.com');
    await user.click(screen.getByRole('button', { name: /save/i }));

    await waitFor(() => {
      expect(mockToast).toHaveBeenCalledWith(
        expect.objectContaining({ variant: 'destructive' }),
      );
    });
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <ContactCreateDialog
          isOpen={true}
          onClose={vi.fn()}
          organizationId="org-1"
        />,
      );
      await checkAccessibility(container);
    });
  });
});
