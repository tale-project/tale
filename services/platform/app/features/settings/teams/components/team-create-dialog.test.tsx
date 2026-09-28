import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { authClient } from '@/lib/auth-client';
import { i18n } from '@/lib/i18n/i18n';
import { checkAccessibility } from '@/tests/utils/a11y';
import {
  SESSION_ENDED,
  SHIPPED_LOCALES,
  forgetSavedLocale,
  saveLocale,
} from '@/tests/utils/lapsed-session';
import { cleanup, render, screen, waitFor, within } from '@/tests/utils/render';

import { TeamCreateDialog } from './team-create-dialog';

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'test-org-id',
}));

vi.mock('@tanstack/react-query', async (original) => ({
  ...(await original<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

const toast = vi.hoisted(() => vi.fn());
vi.mock('@tale/ui/use-toast', () => ({
  useToast: () => ({ toast }),
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
  // client UI: the name schema is `z.string().trim().min(1)` and the FormDialog
  // submit button is disabled while `!isValid`. Validation timing follows the
  // shared `useForm` wrapper's `mode: 'onTouched'` default (#1943): the field
  // error renders only after the first blur, not on the first keystroke — while
  // `isValid` (and therefore the submit gating) stays accurate throughout. No
  // backend call, router redirect, or persistence round-trip is involved, so it
  // belongs at the component tier.
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

      // First keystroke does NOT surface a validation error (the #1943 fix:
      // `onTouched` waits for the first blur). Submit stays disabled because the
      // whitespace-only value still trims to empty and gates `isValid`.
      await user.type(nameField, '   ');
      expect(
        screen.queryByText('Team name is required'),
      ).not.toBeInTheDocument();
      expect(submit).toBeDisabled();

      // Blurring the still-invalid field surfaces the required error.
      await user.tab();
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

      // 81 chars → over the cap. The inline message surfaces only after the
      // first blur (onTouched, #1943); submit is disabled while over the cap.
      await user.type(nameField, 'a'.repeat(81));
      await user.tab();
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

  // E-01: the server refuses a name another team of the organization
  // already reads as (`TEAM_NAME_TAKEN`, 409). The dialog says so under the
  // field and stays open, instead of a generic failure toast.
  describe('a taken name', () => {
    it('shows the uniqueness refusal under the field and keeps the dialog open', async () => {
      vi.mocked(authClient.organization.createTeam).mockResolvedValue({
        data: null,
        error: {
          code: 'TEAM_NAME_TAKEN',
          message: 'A team named "Finance" already exists',
          status: 409,
          statusText: 'Conflict',
        },
      });
      const onOpenChange = vi.fn();
      const { user } = render(
        <TeamCreateDialog
          organizationId="org-1"
          open={true}
          onOpenChange={onOpenChange}
        />,
      );

      await user.type(
        screen.getByRole('textbox', { name: /Team name/ }),
        'finance',
      );
      await user.click(screen.getByRole('button', { name: 'Create team' }));

      expect(
        await screen.findByText('A team with this name already exists'),
      ).toBeInTheDocument();
      expect(onOpenChange).not.toHaveBeenCalledWith(false);
    });
  });

  /** Name a team and press Create, in whatever language the page is in. */
  async function createTeamNamed(name: string) {
    const settings = i18n.getFixedT(i18n.language, 'settings');
    const { user } = render(
      <TeamCreateDialog
        organizationId="org-1"
        open={true}
        onOpenChange={vi.fn()}
      />,
    );
    await user.type(screen.getByRole('textbox'), name);
    await user.click(
      screen.getByRole('button', { name: settings('teams.createTeam') }),
    );
  }

  // Better Auth answers a create whose session has ended with a bare 401; the
  // dialog toasted "Failed to create team" in English under the localized
  // title.
  describe('after a lapsed session', () => {
    beforeEach(() => {
      toast.mockClear();
    });
    // Unmount first: the app shell still applying the saved language would
    // otherwise switch it back after the reset.
    afterEach(async () => {
      cleanup();
      await forgetSavedLocale();
    });

    it.each(SHIPPED_LOCALES)('says the session ended (%s)', async (locale) => {
      saveLocale(locale);
      await i18n.changeLanguage(locale);
      vi.mocked(authClient.organization.createTeam).mockResolvedValue({
        data: null,
        error: { status: 401, statusText: 'UNAUTHORIZED' },
      });

      await createTeamNamed('Finance');

      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith({
          title: i18n.t('teams.teamCreateFailed', { ns: 'settings' }),
          description: SESSION_ENDED[locale],
          variant: 'destructive',
        }),
      );
    });
  });

  describe('a failure with no words for the person', () => {
    beforeEach(() => {
      toast.mockClear();
    });

    it.each([
      {
        failure: 'a refusal without a message',
        answer: {
          data: null,
          error: { status: 500, statusText: 'Internal Server Error' },
        },
      },
      {
        failure: 'an answer that names no team',
        answer: { data: { name: 'Finance' }, error: null },
      },
    ])('shows only the title for $failure', async ({ answer }) => {
      vi.mocked(authClient.organization.createTeam).mockResolvedValue(
        answer as Awaited<
          ReturnType<typeof authClient.organization.createTeam>
        >,
      );

      await createTeamNamed('Finance');

      await waitFor(() =>
        expect(toast).toHaveBeenCalledWith({
          title: "Couldn't create team",
          description: undefined,
          variant: 'destructive',
        }),
      );
    });
  });
});
