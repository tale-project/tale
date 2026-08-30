import { beforeEach, describe, expect, it, vi } from 'vitest';

import { BackendError } from '@/app/lib/backend/backend-error';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

import { AddMemberDialog } from './member-add-dialog';

const { createMemberMock, userExistsMock } = vi.hoisted(() => ({
  createMemberMock: vi.fn(),
  userExistsMock: vi.fn(() => false),
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

// AddMemberDialog reads useUserExistsByEmail (a Convex query) to decide whether
// to show the password field. Mock it so the component test needs no
// ConvexProvider; default to "new user" so existing cases are unchanged, and
// flip it per-test for the existing-user branch.
vi.mock('../hooks/queries', () => ({
  // The mock ignores the email arg and returns a per-test controlled value.
  useUserExistsByEmail: () => userExistsMock(),
}));

vi.mock('@/app/features/settings/governance/hooks/queries', async () => {
  const { DEFAULT_PASSWORD_POLICY } =
    await import('@/lib/shared/schemas/governance');
  return {
    usePasswordPolicy: () => DEFAULT_PASSWORD_POLICY,
  };
});

// Satisfies every rule of DEFAULT_PASSWORD_POLICY (12+ chars, upper, lower,
// digit, special).
const VALID_PASSWORD = 'Sup3r$ecretPass';

beforeEach(() => {
  createMemberMock.mockClear();
  // Default: the email is a NEW user, so the password field is shown.
  userExistsMock.mockReturnValue(false);
});

function renderDialog() {
  return render(
    <AddMemberDialog
      organizationId="org-1"
      open={true}
      onOpenChange={vi.fn()}
    />,
  );
}

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

  // #2687: validation parity with the sibling password forms (change-password
  // dialog, onboarding account step) — submit is proactively disabled until
  // the required fields for the active path are valid, instead of letting the
  // click bounce off the backend's PASSWORD_REQUIRED error.
  describe('proactive validation for a new user (#2687)', () => {
    it('keeps submit disabled until the password satisfies the policy', async () => {
      const { user } = renderDialog();

      const submit = screen.getByRole('button', { name: 'Add member' });
      await user.type(
        screen.getByLabelText(/^Name/i, { exact: false }),
        'New User',
      );
      await user.type(screen.getByLabelText(/^email/i), 'new.user@example.com');

      // Name + valid new email but no password: a new user cannot be created
      // without one, so submit must stay disabled and a click must not fire.
      expect(submit).toBeDisabled();
      await user.click(submit);
      expect(createMemberMock).not.toHaveBeenCalled();

      // A policy-valid password enables submit …
      const password = screen.getByLabelText('Password');
      await user.type(password, VALID_PASSWORD);
      await waitFor(() => expect(submit).toBeEnabled());

      // … and clearing it disables submit again (an observed enabled→disabled
      // flip, so the earlier disabled assertion cannot be a timing fluke).
      await user.clear(password);
      await waitFor(() => expect(submit).toBeDisabled());
      expect(createMemberMock).not.toHaveBeenCalled();
    });

    it('still submits an existing user without a password', async () => {
      // The email already belongs to a user → their credentials are reused, so
      // no password is required and submit is gated by the schema alone.
      userExistsMock.mockReturnValue(true);
      createMemberMock.mockResolvedValueOnce({ isExistingUser: true });

      const { user } = renderDialog();

      await user.type(
        screen.getByLabelText(/^email/i),
        'existing.user@example.com',
      );

      const submit = screen.getByRole('button', { name: 'Add member' });
      await waitFor(() => expect(submit).toBeEnabled());
      await user.click(submit);

      await waitFor(() => expect(createMemberMock).toHaveBeenCalledTimes(1));
      expect(createMemberMock).toHaveBeenCalledWith(
        expect.objectContaining({
          email: 'existing.user@example.com',
          password: undefined,
        }),
      );
      // The success view confirms no new credentials were created.
      await screen.findByText(/already had an account/i);
    });
  });

  // Regression test for #1470: creating a new user without a password failed
  // with a generic toast; the backend returns a PASSWORD_REQUIRED code and the
  // dialog shows a field-level error on the password input. Since #2687 the
  // submit button is disabled while the password is empty for a new user, so
  // the backstop's remaining path is the debounced-lookup race: the lookup
  // still reports "existing user" (password field hidden, submit enabled)
  // while the submitted email is actually new.
  describe('missing password for a new user (#1470)', () => {
    it('surfaces the backend PASSWORD_REQUIRED error on the password field', async () => {
      userExistsMock.mockReturnValue(true);
      createMemberMock.mockRejectedValueOnce(
        new BackendError({
          code: 'PASSWORD_REQUIRED',
          message: 'Password is required when creating a new user',
        }),
      );

      const { user, rerender } = renderDialog();

      await user.type(screen.getByLabelText(/^email/i), 'new.user@example.com');

      const submit = screen.getByRole('button', { name: 'Add member' });
      await waitFor(() => expect(submit).toBeEnabled());
      await user.click(submit);
      await waitFor(() => expect(createMemberMock).toHaveBeenCalledTimes(1));

      // The lookup catches up — the email is new after all. The password field
      // reappears carrying the backstop error, not a generic toast.
      userExistsMock.mockReturnValue(false);
      rerender(
        <AddMemberDialog
          organizationId="org-1"
          open={true}
          onOpenChange={vi.fn()}
        />,
      );
      await screen.findByText('Password is required to create a new user');
    });
  });

  // Regression test for #2018: adding an email that already belongs to a member
  // of the org surfaced as an opaque generic toast. The backend now returns a
  // DUPLICATE_MEMBER code and the dialog shows a field-level error on the email
  // input. A duplicate member necessarily belongs to an existing user, so the
  // lookup reports "existing" — no password is needed for submit to enable.
  describe('duplicate member (#2018)', () => {
    it('shows an email field error when the user is already a member', async () => {
      userExistsMock.mockReturnValue(true);
      createMemberMock.mockRejectedValueOnce(
        new BackendError({
          code: 'DUPLICATE_MEMBER',
          message: 'User is already a member of this organization',
        }),
      );

      const { user } = renderDialog();

      await user.type(
        screen.getByLabelText(/^email/i),
        'existing.member@example.com',
      );

      const submit = screen.getByRole('button', { name: 'Add member' });
      await waitFor(() => expect(submit).toBeEnabled());
      await user.click(submit);

      // The specific error is surfaced on the field, not as a generic toast.
      await screen.findByText(
        'This user is already a member of this organization',
      );
      expect(createMemberMock).toHaveBeenCalledTimes(1);
    });
  });

  describe('existing user', () => {
    it('hides the password field and shows the existing-user hint', async () => {
      // The email already belongs to a user → the backend reuses their
      // credentials, so the dialog drops the password field for a hint.
      userExistsMock.mockReturnValue(true);

      render(
        <AddMemberDialog
          organizationId="org-1"
          open={true}
          onOpenChange={vi.fn()}
        />,
      );

      expect(document.querySelector('input[name="password"]')).toBeNull();
      await screen.findByText(/already has an account/i);
    });
  });
});
