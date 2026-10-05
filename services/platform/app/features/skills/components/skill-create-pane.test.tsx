/**
 * The create step asks who sees the new skill, because it is shared from the
 * moment it exists. Organization is preselected while the viewer may publish
 * to the whole organization; when the organization reserves that, Teams is
 * preselected and Organization is disabled with the reason — and a member in
 * no team is told where to turn instead of offered a form that cannot save.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

const { useSkillPublishing, useOrgTeams, saveSkill } = vi.hoisted(() => ({
  useSkillPublishing: vi.fn(),
  useOrgTeams: vi.fn(),
  saveSkill: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../hooks/queries', () => ({ useSkillPublishing }));
vi.mock('../hooks/mutations', () => ({
  useSaveSkill: () => ({ mutateAsync: saveSkill, isPending: false }),
}));
vi.mock('@/app/features/settings/teams/hooks/queries', () => ({ useOrgTeams }));

import { SkillCreatePane } from './skill-create-pane';

const RESERVED_FOR_ADMINS =
  'Your organization reserves sharing with everyone for owners and admins, and members an admin allowed.';

function mountPane(existingSlugs: readonly string[] = []) {
  const onCreated = vi.fn();
  const view = render(
    <SkillCreatePane
      organizationId="org_1"
      existingSlugs={existingSlugs}
      onCreated={onCreated}
      onCancel={vi.fn()}
    />,
  );
  return { ...view, onCreated };
}

async function fillIdentity(user: ReturnType<typeof mountPane>['user']) {
  await user.type(screen.getByLabelText('Name'), 'house-voice');
  await user.type(screen.getByLabelText('Description'), 'How we write.');
}

beforeEach(() => {
  saveSkill.mockReset().mockResolvedValue(undefined);
  useOrgTeams.mockReturnValue({
    teams: [{ id: 'team-red', name: 'Red' }],
    isLoading: false,
  });
});

describe('SkillCreatePane', () => {
  it('disables Create when the name is already in the snapshot', async () => {
    useSkillPublishing.mockReturnValue({ mode: 'everyone', allowed: true });
    const { user, onCreated } = mountPane(['house-voice']);
    await fillIdentity(user);
    expect(screen.getByRole('alert')).toHaveTextContent(
      'A skill with this name already exists.',
    );
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    expect(saveSkill).not.toHaveBeenCalled();
    expect(onCreated).not.toHaveBeenCalled();
  });

  it('does not announce creation when a stale snapshot is refused', async () => {
    useSkillPublishing.mockReturnValue({ mode: 'everyone', allowed: true });
    saveSkill.mockRejectedValueOnce(
      Object.assign(new Error('Skill exists'), { code: 'SKILL_EXISTS' }),
    );
    const consoleError = vi
      .spyOn(console, 'error')
      .mockImplementation(() => undefined);
    try {
      const { user, onCreated } = mountPane();
      await fillIdentity(user);
      await user.click(screen.getByRole('button', { name: 'Create' }));
      expect(saveSkill).toHaveBeenCalledWith(
        expect.objectContaining({ createOnly: true }),
      );
      expect(onCreated).not.toHaveBeenCalled();
      expect(screen.getByLabelText('Description')).toHaveValue('How we write.');
    } finally {
      consoleError.mockRestore();
    }
  });

  it('preselects Organization while the viewer may publish, and creates it org-wide', async () => {
    useSkillPublishing.mockReturnValue({ mode: 'everyone', allowed: true });
    const { user, onCreated } = mountPane();

    expect(screen.getByRole('radio', { name: /Organization/ })).toBeChecked();
    await fillIdentity(user);
    await user.click(screen.getByRole('button', { name: 'Create' }));

    expect(saveSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'house-voice',
        visibility: 'org',
        createOnly: true,
      }),
    );
    expect(saveSkill.mock.calls[0]?.[0]).not.toHaveProperty('teams');
    expect(onCreated).toHaveBeenCalledWith('house-voice');
  });

  it('preselects Teams and withholds Organization, with the reason, when the organization reserves it', async () => {
    useSkillPublishing.mockReturnValue({ mode: 'admins', allowed: false });
    const { user } = mountPane();

    expect(screen.getByRole('radio', { name: /Teams/ })).toBeChecked();
    const org = screen.getByRole('radio', { name: /Organization/ });
    expect(org).toBeDisabled();
    expect(screen.getByText(RESERVED_FOR_ADMINS)).toBeInTheDocument();

    await fillIdentity(user);
    // Teams with none picked cannot be created yet.
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
    await user.click(
      screen.getByRole('combobox', { name: /Shared with teams/ }),
    );
    await user.click(await screen.findByRole('option', { name: /Red/ }));
    await user.keyboard('{Escape}');
    await user.click(await screen.findByRole('button', { name: 'Create' }));

    expect(saveSkill).toHaveBeenCalledWith(
      expect.objectContaining({
        slug: 'house-voice',
        visibility: 'team',
        teams: ['team-red'],
      }),
    );
  });

  it('names the Editors mode in its reason', () => {
    useSkillPublishing.mockReturnValue({ mode: 'editors', allowed: false });
    mountPane();
    expect(
      screen.getByText(
        'Your organization reserves sharing with everyone for Editors and above, and members an admin allowed.',
      ),
    ).toBeInTheDocument();
  });

  it('tells a member in no team where to turn, and creates nothing', async () => {
    useSkillPublishing.mockReturnValue({ mode: 'admins', allowed: false });
    useOrgTeams.mockReturnValue({ teams: [], isLoading: false });
    const { user } = mountPane();

    expect(
      screen.getByText(
        "You aren't in a team, and your organization reserves sharing with everyone. Ask an admin to add you to a team or to let you publish skills.",
      ),
    ).toBeInTheDocument();
    expect(screen.queryByRole('radio')).not.toBeInTheDocument();
    await fillIdentity(user);
    expect(screen.getByRole('button', { name: 'Create' })).toBeDisabled();
  });
});
