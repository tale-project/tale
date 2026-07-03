import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor, within } from '@/tests/utils/render';

import { TeamCreateDialog } from './team-create-dialog';

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'test-org-id',
}));

vi.mock('@/app/hooks/use-toast', () => ({
  useToast: () => ({ toast: vi.fn() }),
}));

vi.mock('@/lib/auth-client', () => ({
  authClient: {
    organization: {
      createTeam: vi.fn(),
    },
    getSession: vi.fn().mockResolvedValue({ data: { user: { id: 'user-1' } } }),
  },
}));

vi.mock('../hooks/mutations', () => ({
  useCreateTeamMember: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('./team-member-checklist', () => ({
  TeamMemberChecklist: () => <div data-testid="member-checklist">Members</div>,
}));

describe('TeamCreateDialog', () => {
  describe('accessibility', () => {
    it('passes axe audit when open', async () => {
      const { container } = render(
        <TeamCreateDialog
          organizationId="org-1"
          open={true}
          onOpenChange={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit when closed', async () => {
      const { container } = render(
        <TeamCreateDialog
          organizationId="org-1"
          open={false}
          onOpenChange={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });
  });

  // Migrated from the `validation` E2E "create team dialog: disables submit until
  // a non-empty name is entered; cancels without creating". The gating is pure
  // client UI: the name schema is `z.string().trim().min(1)` with RHF
  // `mode: 'onChange'`, and the FormDialog submit button is disabled while
  // `!isValid`. No backend call, router redirect, or persistence round-trip is
  // involved in the assertion, so it belongs at the component tier.
  describe('name validation gating', () => {
    it('disables submit until a non-empty name is entered; cancels without creating', async () => {
      const onOpenChange = vi.fn();
      const { user } = render(
        <TeamCreateDialog
          organizationId="org-1"
          open={true}
          onOpenChange={onOpenChange}
        />,
      );

      const dialog = screen.getByRole('dialog', { name: 'Create team' });
      const nameField = screen.getByRole('textbox', { name: /Team name/ });
      // The submit button shares its label with the dialog title; it is the only
      // button inside the dialog so the role query is unambiguous.
      const submit = screen.getByRole('button', { name: 'Create team' });

      // Empty name (the default) → invalid → submit DISABLED.
      expect(nameField).toHaveValue('');
      expect(submit).toBeDisabled();

      // Whitespace-only trims to empty: still invalid → required error, disabled.
      await user.type(nameField, '   ');
      expect(
        await screen.findByText('Team name is required'),
      ).toBeInTheDocument();
      expect(submit).toBeDisabled();

      // A real name clears the error and ENABLES submit (we never click it).
      await user.clear(nameField);
      await user.type(nameField, 'E2E Team validation');
      await waitFor(() => {
        expect(
          screen.queryByText('Team name is required'),
        ).not.toBeInTheDocument();
        expect(submit).toBeEnabled();
      });

      // Cancel without creating → the dialog requests close, nothing persists.
      await user.click(within(dialog).getByRole('button', { name: 'Cancel' }));
      expect(onOpenChange).toHaveBeenCalledWith(false);
    });

    // #1991: `createTeam` has no server cap, so an over-long name would persist
    // unbounded. The name schema now carries `.max(80)`, surfaced inline via the
    // shared `common.validation.maxLength` message, and submit is disabled while
    // over the cap.
    it('rejects a name over the 80-char cap and accepts one at the cap', async () => {
      const { user } = render(
        <TeamCreateDialog
          organizationId="org-1"
          open={true}
          onOpenChange={vi.fn()}
        />,
      );

      const nameField = screen.getByRole('textbox', { name: /Team name/ });
      const submit = screen.getByRole('button', { name: 'Create team' });

      // 81 chars → over the cap → inline message, submit DISABLED.
      await user.type(nameField, 'a'.repeat(81));
      expect(
        await screen.findByText('Team name must be 80 characters or fewer'),
      ).toBeInTheDocument();
      expect(submit).toBeDisabled();

      // Exactly 80 → valid → message clears, submit ENABLED.
      await user.clear(nameField);
      await user.type(nameField, 'a'.repeat(80));
      await waitFor(() => {
        expect(
          screen.queryByText('Team name must be 80 characters or fewer'),
        ).not.toBeInTheDocument();
        expect(submit).toBeEnabled();
      });
    });
  });
});
