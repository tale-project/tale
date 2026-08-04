/**
 * The detail pane holds the editor form in local state, seeded from the fetched
 * document and cleared when the pane navigates to another skill. The ORDER of
 * those two effects is the whole contract: both fire in one commit when the new
 * slug's document is already cached, so seeding before clearing leaves the form
 * permanently null and the editor blank.
 */

import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

const { useSkill, useOrgTeams } = vi.hoisted(() => ({
  useSkill: vi.fn(),
  useOrgTeams: vi.fn(),
}));

vi.mock('../hooks/queries', () => ({ useSkill }));
vi.mock('../hooks/mutations', () => ({
  useSaveSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));
vi.mock('@/app/features/settings/teams/hooks/queries', () => ({ useOrgTeams }));

import { SkillDetailPane } from './skill-detail-pane';

function skillDoc(slug: string, body: string) {
  return {
    slug,
    description: `${slug} description`,
    icon: undefined,
    labels: [],
    visibility: 'org',
    teams: [],
    usageMode: 'all',
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
