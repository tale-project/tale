/**
 * The detail pane holds the editor form in local state, seeded from the fetched
 * document and cleared when the pane navigates to another skill. The ORDER of
 * those two effects is the whole contract: both fire in one commit when the new
 * slug's document is already cached, so seeding before clearing leaves the form
 * permanently null and the editor blank.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

const { useSkill, useSkillPublishing, useOrgTeams, saveSkill } = vi.hoisted(
  () => ({
    useSkill: vi.fn(),
    useSkillPublishing: vi.fn(),
    useOrgTeams: vi.fn(),
    saveSkill: vi.fn().mockResolvedValue(undefined),
  }),
);

vi.mock('../hooks/queries', () => ({ useSkill, useSkillPublishing }));
vi.mock('../hooks/mutations', () => ({
  useSaveSkill: () => ({ mutateAsync: saveSkill, isPending: false }),
  useDeleteSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/app/features/settings/teams/hooks/queries', () => ({ useOrgTeams }));

import { SkillDetailPane } from './skill-detail-pane';

function skillDoc(
  slug: string,
  body: string,
  icon?: string,
  attribution: Record<string, string> = { origin: 'builtin' },
) {
  return {
    slug,
    description: `${slug} description`,
    icon,
    labels: [],
    visibility: 'org',
    teams: [],
    body,
    canEdit: true,
    files: [{ path: 'SKILL.md' }],
    ...attribution,
  };
}

/** The value a read-only attribution row shows beside its label. */
function rowValue(label: string): string | null {
  const row = screen
    .getByText(label, { selector: 'span' })
    .closest('[data-settings-field-row]');
  return row?.querySelector('p')?.textContent ?? null;
}

function mountPane(slug: string) {
  return render(
    <SkillDetailPane
      organizationId="org_1"
      slug={slug}
      onDeleted={vi.fn()}
      onClose={vi.fn()}
    />,
  );
}

beforeEach(() => {
  saveSkill.mockClear();
  useSkillPublishing.mockReturnValue({ mode: 'everyone', allowed: true });
});

describe('SkillDetailPane', () => {
  // The door keeps a stored icon when the field is omitted and clears it on
  // `null`; "No icon" used to drop the field, so the rocket survived every
  // save and reload (SKILL-F4).
  it('sends icon: null when No icon is picked, so the stored icon is cleared', async () => {
    useOrgTeams.mockReturnValue({ teams: [], isLoading: false });
    useSkill.mockReturnValue({
      data: skillDoc('alpha', 'Alpha body', 'lucide:rocket'),
      isPending: false,
    });
    const { user } = mountPane('alpha');

    await user.click(screen.getByRole('button', { name: 'Change icon' }));
    await user.click(await screen.findByRole('option', { name: 'No icon' }));
    await user.click(screen.getByRole('button', { name: 'Save' }));

    expect(saveSkill).toHaveBeenCalledWith(
      expect.objectContaining({ slug: 'alpha', icon: null }),
    );
  });

  it('seeds the body editor from the fetched document', () => {
    useOrgTeams.mockReturnValue({ teams: [], isLoading: false });
    useSkill.mockReturnValue({
      data: skillDoc('alpha', 'Alpha body'),
      isPending: false,
    });

    mountPane('alpha');

    expect(screen.getByDisplayValue('Alpha body')).toBeInTheDocument();
  });

  it('reseeds when the slug changes and the new document is already cached', () => {
    useOrgTeams.mockReturnValue({ teams: [], isLoading: false });
    useSkill.mockReturnValue({
      data: skillDoc('alpha', 'Alpha body'),
      isPending: false,
    });

    const { rerender } = mountPane('alpha');
    expect(screen.getByDisplayValue('Alpha body')).toBeInTheDocument();

    // No loading gap: the second skill resolves in the same commit as the slug
    // change, so the reset and the seed effect both fire together.
    useSkill.mockReturnValue({
      data: skillDoc('beta', 'Beta body'),
      isPending: false,
    });
    rerender(
      <SkillDetailPane
        organizationId="org_1"
        slug="beta"
        onDeleted={vi.fn()}
        onClose={vi.fn()}
      />,
    );

    expect(screen.getByDisplayValue('Beta body')).toBeInTheDocument();
    expect(screen.queryByDisplayValue('Alpha body')).not.toBeInTheDocument();
  });

  describe('who created and last edited it', () => {
    it('names the creator and the last editor', () => {
      useOrgTeams.mockReturnValue({ teams: [], isLoading: false });
      useSkill.mockReturnValue({
        data: skillDoc('alpha', 'Alpha body', undefined, {
          origin: 'member',
          owner: 'user-ada',
          ownerName: 'Ada Lovelace',
          updatedBy: 'user-grace',
          updatedByName: 'Grace Hopper',
        }),
        isPending: false,
      });
      mountPane('alpha');

      expect(rowValue('Created by')).toBe('Ada Lovelace');
      expect(rowValue('Last edited by')).toBe('Grace Hopper');
    });

    it('reads a departed creator as a former member and leaves out an unknown editor', () => {
      useOrgTeams.mockReturnValue({ teams: [], isLoading: false });
      useSkill.mockReturnValue({
        data: skillDoc('alpha', 'Alpha body', undefined, {
          origin: 'member',
          owner: 'user-gone',
        }),
        isPending: false,
      });
      mountPane('alpha');

      expect(rowValue('Created by')).toBe('Former member');
      expect(screen.queryByText('Last edited by')).not.toBeInTheDocument();
    });

    it('labels a built-in skill and names who installed a configuration release', () => {
      useOrgTeams.mockReturnValue({ teams: [], isLoading: false });
      useSkill.mockReturnValue({
        data: skillDoc('docx', 'Word', undefined, { origin: 'builtin' }),
        isPending: false,
      });
      const { unmount } = mountPane('docx');
      expect(rowValue('Created by')).toBe('Built-in');
      unmount();

      useSkill.mockReturnValue({
        data: skillDoc('invoices', 'Invoices', undefined, {
          origin: 'release',
          owner: 'user-operator',
          ownerName: 'Ops Bot',
        }),
        isPending: false,
      });
      mountPane('invoices');
      expect(rowValue('Created by')).toBe('Configuration release · Ops Bot');
    });
  });

  describe('when the organization reserves organization-wide skills', () => {
    const reserved = { mode: 'admins', allowed: false };
    const reason =
      'Your organization reserves sharing with everyone for owners and admins, and members an admin allowed.';

    it('says why an organization-wide skill cannot be changed in place, and keeps Save off while it stays shared with everyone', async () => {
      useSkillPublishing.mockReturnValue(reserved);
      useOrgTeams.mockReturnValue({
        teams: [{ id: 'team-red', name: 'Red' }],
        isLoading: false,
      });
      useSkill.mockReturnValue({
        data: skillDoc('alpha', 'Alpha body'),
        isPending: false,
      });
      const { user } = mountPane('alpha');

      // The reason heads the notice and stands in for Organization's help.
      expect(screen.getAllByText(reason)).toHaveLength(2);
      expect(
        screen.getByText(
          'While it stays shared with the whole organization, only a member allowed to publish can change it. You can narrow it to your teams (and edit it in the same save) or delete it.',
        ),
      ).toBeInTheDocument();
      await user.clear(screen.getByDisplayValue('Alpha body'));
      await user.type(
        screen.getByRole('textbox', { name: /Instructions/ }),
        'Changed',
      );
      expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled();
      // The Organization audience itself is withheld, with the same reason.
      expect(
        screen.getByRole('radio', { name: /Organization/ }),
      ).toBeDisabled();
      expect(saveSkill).not.toHaveBeenCalled();
    });

    it('lets its owner narrow it to a team in the same save', async () => {
      useSkillPublishing.mockReturnValue(reserved);
      useOrgTeams.mockReturnValue({
        teams: [{ id: 'team-red', name: 'Red' }],
        isLoading: false,
      });
      useSkill.mockReturnValue({
        data: skillDoc('alpha', 'Alpha body'),
        isPending: false,
      });
      const { user } = mountPane('alpha');

      await user.click(screen.getByRole('radio', { name: /Teams/ }));
      await user.click(await screen.findByRole('button', { name: 'Confirm' }));
      await user.click(
        screen.getByRole('combobox', { name: /Shared with teams/ }),
      );
      await user.click(await screen.findByRole('option', { name: /Red/ }));
      // Every step away from the whole organization asks first.
      await user.click(await screen.findByRole('button', { name: 'Confirm' }));
      // Close the team picker.
      await user.keyboard('{Escape}');
      await user.click(await screen.findByRole('button', { name: 'Save' }));

      expect(saveSkill).toHaveBeenCalledWith(
        expect.objectContaining({
          slug: 'alpha',
          visibility: 'team',
          teams: ['team-red'],
        }),
      );
    });

    it('leaves a team skill editable, with Organization withheld', () => {
      useSkillPublishing.mockReturnValue(reserved);
      useOrgTeams.mockReturnValue({
        teams: [{ id: 'team-red', name: 'Red' }],
        isLoading: false,
      });
      useSkill.mockReturnValue({
        data: {
          ...skillDoc('alpha', 'Alpha body'),
          visibility: 'team',
          teams: ['team-red'],
        },
        isPending: false,
      });
      mountPane('alpha');

      expect(
        screen.queryByText(
          'While it stays shared with the whole organization, only a member allowed to publish can change it. You can narrow it to your teams (and edit it in the same save) or delete it.',
        ),
      ).not.toBeInTheDocument();
      expect(
        screen.getByRole('radio', { name: /Organization/ }),
      ).toBeDisabled();
    });
  });
});
