/**
 * The detail pane holds the editor form in local state, seeded from the fetched
 * document and cleared when the pane navigates to another skill. The ORDER of
 * those two effects is the whole contract: both fire in one commit when the new
 * slug's document is already cached, so seeding before clearing leaves the form
 * permanently null and the editor blank.
 */

import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

const { useSkill, useOrgTeams, saveSkill } = vi.hoisted(() => ({
  useSkill: vi.fn(),
  useOrgTeams: vi.fn(),
  saveSkill: vi.fn().mockResolvedValue(undefined),
}));

vi.mock('../hooks/queries', () => ({ useSkill }));
vi.mock('../hooks/mutations', () => ({
  useSaveSkill: () => ({ mutateAsync: saveSkill, isPending: false }),
  useDeleteSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/app/features/settings/teams/hooks/queries', () => ({ useOrgTeams }));

import { SkillDetailPane } from './skill-detail-pane';

function skillDoc(slug: string, body: string, icon?: string) {
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
  };
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
});
