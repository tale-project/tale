import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import { GrantCompetenceDialog } from './grant-competence-dialog';

const DAY = 24 * 60 * 60 * 1000;

const state = vi.hoisted(() => ({
  grant: vi.fn(),
  toast: vi.fn(),
  refetchMembers: vi.fn(),
  // The member list as `useOrgMembersForPicker` answers it (`setMembers`).
  members: {} as Record<string, unknown>,
  // The model endpoints switch as `useMyModelApiAccess` answers it
  // (`setModelApi`).
  modelApi: {} as Record<string, unknown>,
}));

vi.mock('../hooks/mutations', () => ({
  useGrantCompetence: () => ({ mutateAsync: state.grant, isPending: false }),
}));
vi.mock('../hooks/queries', () => ({
  useOrgMembersForPicker: () => state.members,
  useMyModelApiAccess: () => state.modelApi,
}));
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  Link: ({
    children,
    to,
    className,
  }: {
    children: ReactNode;
    to: string;
    className?: string;
  }) => (
    <a href={to} className={className}>
      {children}
    </a>
  ),
}));
vi.mock('@tale/ui/use-toast', () => ({
  useToast: () => ({ toast: state.toast }),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-a',
}));

const MEMBERS = [
  {
    userId: 'user-worker',
    email: 'worker@example.com',
    displayName: 'Integration Worker',
    role: 'developer',
  },
  {
    userId: 'user-reviewer',
    email: 'reviewer@example.com',
    displayName: 'Tax Reviewer',
    role: 'member',
  },
];

/** How the member list reads: answered with its rows, still pending, or
 * failed with no answer (`readStateOf`'s `unavailable`). */
type MembersRead = { rows: readonly object[] } | 'pending' | 'failed';

/** Set the member list's read, in the shape of the react-query result. */
function setMembers(read: MembersRead) {
  state.members = {
    data: typeof read === 'object' ? read.rows : undefined,
    isLoading: read === 'pending',
    isError: read === 'failed',
    isFetching: read === 'pending',
    errorUpdateCount: read === 'failed' ? 1 : 0,
    refetch: state.refetchMembers,
  };
}

/** How the model endpoints switch reads: answered on or off, still
 * pending, or failed with no answer. */
type ModelApiRead = 'on' | 'off' | 'pending' | 'failed';

/** Set the switch's read, in the shape of the react-query result. */
function setModelApi(read: ModelApiRead) {
  state.modelApi = {
    data:
      read === 'on' || read === 'off'
        ? { enabled: read === 'on', allowed: true, models: [] }
        : undefined,
    isLoading: read === 'pending',
    isError: read === 'failed',
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  setMembers({ rows: MEMBERS });
  setModelApi('on');
});

function renderDialog() {
  const onOpenChange = vi.fn();
  const utils = render(
    <GrantCompetenceDialog
      open
      onOpenChange={onOpenChange}
      organizationId="org-a"
    />,
  );
  return { ...utils, onOpenChange };
}

async function choose(
  user: ReturnType<typeof renderDialog>['user'],
  field: string,
  option: string,
) {
  await user.click(screen.getByRole('button', { name: field }));
  await user.click(await screen.findByRole('option', { name: option }));
}

describe('GrantCompetenceDialog', () => {
  it('grants a platform capability that never expires', async () => {
    state.grant.mockResolvedValue({ recordId: 'record-a' });
    const { user, onOpenChange } = renderDialog();

    await choose(user, 'Member', 'Integration Worker worker@example.com');
    await choose(user, 'Competence', 'Act for another member tale:rest.act-as');
    // The chosen capability explains itself under the field.
    expect(
      screen.getByText(/so the record shows that person instead of the key/),
    ).toBeInTheDocument();
    await user.click(screen.getByRole('button', { name: 'Grant' }));

    expect(state.grant).toHaveBeenCalledWith({
      organizationId: 'org-a',
      userId: 'user-worker',
      competence: 'tale:rest.act-as',
    });
    expect(state.toast).toHaveBeenCalledWith(
      expect.objectContaining({ title: 'Competence granted' }),
    );
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });

  it('grants a named qualification with an expiry and evidence', async () => {
    state.grant.mockResolvedValue({ recordId: 'record-b' });
    const { user } = renderDialog();

    await choose(user, 'Member', 'Tax Reviewer reviewer@example.com');
    await choose(
      user,
      'Competence',
      'Qualification A name your review policy asks for',
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Qualification name' }),
      '  tax-reviewer ',
    );
    await user.click(screen.getByRole('combobox', { name: 'Expires' }));
    await user.click(await screen.findByRole('option', { name: 'In 30 days' }));
    await user.type(
      screen.getByRole('textbox', { name: 'Evidence' }),
      'Certified 2026',
    );
    const before = Date.now();
    await user.click(screen.getByRole('button', { name: 'Grant' }));
    const after = Date.now();

    expect(state.grant).toHaveBeenCalledTimes(1);
    const args = state.grant.mock.calls[0]![0] as Record<string, unknown>;
    expect(args).toMatchObject({
      userId: 'user-reviewer',
      competence: 'tax-reviewer',
      evidence: 'Certified 2026',
    });
    expect(args.expiresAt).toBeGreaterThanOrEqual(before + 30 * DAY);
    expect(args.expiresAt).toBeLessThanOrEqual(after + 30 * DAY);
  });

  it('refuses a qualification under the reserved platform namespace', async () => {
    const { user } = renderDialog();

    await choose(user, 'Member', 'Tax Reviewer reviewer@example.com');
    await choose(
      user,
      'Competence',
      'Qualification A name your review policy asks for',
    );
    await user.type(
      screen.getByRole('textbox', { name: 'Qualification name' }),
      'TALE:anything',
    );

    expect(
      await screen.findByText(
        'Names starting with "tale:" are reserved for platform capabilities.',
      ),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Grant' })).toBeDisabled();
    expect(state.grant).not.toHaveBeenCalled();
  });

  it('keeps a refusal beside the fields until the choice changes', async () => {
    state.grant.mockRejectedValue({
      data: { code: 'COMPETENCE_ALREADY_GRANTED' },
    });
    const { user, onOpenChange } = renderDialog();

    await choose(user, 'Member', 'Integration Worker worker@example.com');
    await choose(user, 'Competence', 'Act for another member tale:rest.act-as');
    await user.click(screen.getByRole('button', { name: 'Grant' }));

    const dialog = screen.getByRole('dialog');
    expect(
      within(dialog).getByText(/This member already holds this competence/),
    ).toBeInTheDocument();
    expect(onOpenChange).not.toHaveBeenCalledWith(false);

    await choose(
      user,
      'Competence',
      'Export notifications tale:notifications.export',
    );
    expect(
      within(dialog).queryByText(/This member already holds this competence/),
    ).not.toBeInTheDocument();
  });

  it('passes an axe audit when open', async () => {
    renderDialog();
    await screen.findByRole('dialog');
    await checkAccessibility(document.body);
  });

  // The model endpoints are the organization's to enable: a grant of Call
  // models over the API while they are off says so, with the way to them,
  // and is still allowed. Only an answer says they are off (#4586).
  describe('while the model endpoints are off', () => {
    const OFF =
      'Model endpoints are not enabled for this organization. The member can call the models only once they are.';
    const MODELS_API = 'Call models over the API tale:models.api';

    it('says so for Call models over the API, links to Models and still grants', async () => {
      setModelApi('off');
      state.grant.mockResolvedValue({ recordId: 'record-c' });
      const { user } = renderDialog();

      await choose(user, 'Member', 'Tax Reviewer reviewer@example.com');
      expect(screen.queryByText(OFF)).not.toBeInTheDocument();
      await choose(user, 'Competence', MODELS_API);

      const notice = screen
        .getByText(OFF)
        .closest<HTMLElement>('[data-slot="alert"]');
      if (notice === null) throw new Error(`"${OFF}" is in no alert`);
      expect(notice).toHaveAttribute('data-variant', 'warning');
      expect(
        within(notice).getByRole('link', { name: 'Open model access' }),
      ).toHaveAttribute(
        'href',
        '/dashboard/$id/settings/governance/content-models',
      );
      await checkAccessibility(document.body);

      await user.click(screen.getByRole('button', { name: 'Grant' }));
      expect(state.grant).toHaveBeenCalledWith({
        organizationId: 'org-a',
        userId: 'user-reviewer',
        competence: 'tale:models.api',
      });
    });

    it('says nothing of them for another capability', async () => {
      setModelApi('off');
      const { user } = renderDialog();

      await choose(user, 'Competence', MODELS_API);
      expect(screen.getByText(OFF)).toBeInTheDocument();
      await choose(
        user,
        'Competence',
        'Export notifications tale:notifications.export',
      );
      expect(screen.queryByText(OFF)).not.toBeInTheDocument();
    });

    it.each(['on', 'pending', 'failed'] as const)(
      'says nothing of them when the switch read is %s',
      async (read) => {
        setModelApi(read);
        const { user } = renderDialog();

        await choose(user, 'Competence', MODELS_API);
        expect(screen.queryByText(OFF)).not.toBeInTheDocument();
        expect(
          screen.queryByRole('link', { name: 'Open model access' }),
        ).not.toBeInTheDocument();
      },
    );
  });

  // A member list that has not answered offers nobody, and that never reads
  // as nobody to grant to: a pending read masks the picker, a failed one
  // says the list couldn't load and offers Try again (#4840, the #4586 class).
  describe('before the member list answers', () => {
    const LOAD_FAILED = "Couldn't load the members.";

    function memberPicker(): HTMLElement {
      const trigger = document.getElementById('competence-member');
      if (trigger === null) throw new Error('No member picker');
      return trigger;
    }

    it('names a failed member read with Try again, never as no members', async () => {
      setMembers('failed');
      const { user } = renderDialog();

      await user.click(memberPicker());
      expect(screen.queryByText('No members found')).not.toBeInTheDocument();
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(memberPicker()).toBeDisabled();
      expect(screen.getByRole('button', { name: 'Grant' })).toBeDisabled();

      const alert = screen
        .getByText(LOAD_FAILED)
        .closest<HTMLElement>('[role="alert"]');
      if (alert === null) throw new Error(`"${LOAD_FAILED}" is in no alert`);
      await user.click(
        within(alert).getByRole('button', { name: 'Try again' }),
      );
      expect(state.refetchMembers).toHaveBeenCalledTimes(1);
      await checkAccessibility(document.body);
    });

    it('masks the member picker while its read is pending', async () => {
      setMembers('pending');
      const { user } = renderDialog();

      await user.click(memberPicker());
      expect(screen.queryByText('No members found')).not.toBeInTheDocument();
      expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
      expect(memberPicker()).toBeDisabled();
      expect(memberPicker()).toHaveAttribute('aria-hidden', 'true');
      expect(screen.queryByText(LOAD_FAILED)).not.toBeInTheDocument();
    });

    it('says no members were found once the list answered empty', async () => {
      setMembers({ rows: [] });
      const { user } = renderDialog();

      expect(screen.queryByText(LOAD_FAILED)).not.toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'Member' }));
      expect(await screen.findByText('No members found')).toBeInTheDocument();
    });

    it('offers the members once a retry answers', async () => {
      setMembers('failed');
      const { user, rerender, onOpenChange } = renderDialog();
      expect(screen.getByText(LOAD_FAILED)).toBeInTheDocument();

      setMembers({ rows: MEMBERS });
      rerender(
        <GrantCompetenceDialog
          open
          onOpenChange={onOpenChange}
          organizationId="org-a"
        />,
      );

      expect(screen.queryByText(LOAD_FAILED)).not.toBeInTheDocument();
      await choose(user, 'Member', 'Tax Reviewer reviewer@example.com');
      expect(screen.getByRole('button', { name: 'Member' })).toHaveTextContent(
        'Tax Reviewer',
      );
    });
  });
});
