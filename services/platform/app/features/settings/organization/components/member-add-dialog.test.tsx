import { ConvexError } from 'convex/values';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import { AddMemberDialog } from './member-add-dialog';

const { createMemberMock } = vi.hoisted(() => ({
  createMemberMock: vi.fn(),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'test-org-id',
}));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('../hooks/mutations', () => ({
  useCreateMember: () => ({ mutateAsync: createMemberMock, isPending: false }),
}));

vi.mock('@/app/features/settings/governance/hooks/queries', async () => {
  const { DEFAULT_PASSWORD_POLICY } =
    await import('@/lib/shared/schemas/governance');
  return {
    usePasswordPolicy: () => DEFAULT_PASSWORD_POLICY,
  };
});

describe('AddMemberDialog', () => {
  describe('accessibility', () => {
    it('passes axe audit when open', async () => {
      const { container } = render(
        <AddMemberDialog
          organizationId="org-1"
          open={true}
          onOpenChange={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit when closed', async () => {
      const { container } = render(
        <AddMemberDialog
          organizationId="org-1"
          open={false}
          onOpenChange={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });
  });

  // Regression test for #1470: creating a new user without a password failed
  // with a generic toast. The backend now returns a PASSWORD_REQUIRED code and
  // the dialog shows a field-level error on the password input.
  describe('missing password for a new user (#1470)', () => {
    it('shows a password field error when the backend requires a password', async () => {
      createMemberMock.mockRejectedValueOnce(
        new ConvexError({
          code: 'PASSWORD_REQUIRED',
          message: 'Password is required when creating a new user',
        }),
      );

      const { user } = render(
        <AddMemberDialog
          organizationId="org-1"
          open={true}
          onOpenChange={vi.fn()}
        />,
      );

      const email = document.querySelector(
        'input[name="email"]',
      ) as HTMLInputElement;
      await user.type(email, 'new.user@example.com');

      const submit = document.querySelector(
        'button[type="submit"]',
      ) as HTMLButtonElement;
      await waitFor(() => expect(submit).toBeEnabled());
      await user.click(submit);

      // The specific error is surfaced on the field, not as a generic toast.
      await screen.findByText('Password is required to create a new user');
      expect(createMemberMock).toHaveBeenCalledTimes(1);
    });
  });

  // Regression test for #2018: adding an email that already belongs to a member
  // of the org surfaced as an opaque generic toast. The backend now returns a
  // DUPLICATE_MEMBER code and the dialog shows a field-level error on the email
  // input.
  describe('duplicate member (#2018)', () => {
    it('shows an email field error when the user is already a member', async () => {
      createMemberMock.mockClear();
      createMemberMock.mockRejectedValueOnce(
        new ConvexError({
          code: 'DUPLICATE_MEMBER',
          message: 'User is already a member of this organization',
        }),
      );

      const { user } = render(
        <AddMemberDialog
          organizationId="org-1"
          open={true}
          onOpenChange={vi.fn()}
        />,
      );

      const email = document.querySelector(
        'input[name="email"]',
      ) as HTMLInputElement;
      await user.type(email, 'existing.member@example.com');

      const submit = document.querySelector(
        'button[type="submit"]',
      ) as HTMLButtonElement;
      await waitFor(() => expect(submit).toBeEnabled());
      await user.click(submit);

      // The specific error is surfaced on the field, not as a generic toast.
      await screen.findByText(
        'This user is already a member of this organization',
      );
      expect(createMemberMock).toHaveBeenCalledTimes(1);
    });
  });
});
