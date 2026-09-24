import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import { GrantCompetenceDialog } from './grant-competence-dialog';

const DAY = 24 * 60 * 60 * 1000;

const state = vi.hoisted(() => ({
  grant: vi.fn(),
  toast: vi.fn(),
}));

vi.mock('../hooks/mutations', () => ({
  useGrantCompetence: () => ({ mutateAsync: state.grant, isPending: false }),
}));
vi.mock('../hooks/queries', () => ({
  useOrgMembersForPicker: () => ({
    data: [
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
    ],
    isLoading: false,
  }),
}));
vi.mock('@tale/ui/use-toast', () => ({
  useToast: () => ({ toast: state.toast }),
}));
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-a',
}));

beforeEach(() => {
  vi.clearAllMocks();
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
});
