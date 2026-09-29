/**
 * The skill library says who created every skill — a member by name, a
 * departed one as a former member, the catalog copies as built-in and a
 * managed configuration release as such, beside the member whose upload
 * installed it (the release marker is plain frontmatter any upload can
 * carry) — and finds skills by that name.
 */

import { describe, expect, it, vi } from 'vitest';

import { render, screen, within } from '@/tests/utils/render';

import { SkillsSettings } from './skills-settings';

const fixture = vi.hoisted(() => ({
  skills: [
    {
      slug: 'house-voice',
      description: 'How we write',
      visibility: 'org',
      origin: 'member',
      owner: 'user-ada',
      ownerName: 'Ada Lovelace',
      canEdit: true,
    },
    {
      slug: 'old-notes',
      description: 'Left behind',
      visibility: 'org',
      origin: 'member',
      owner: 'user-gone',
      canEdit: false,
    },
    {
      slug: 'docx',
      description: 'Word documents',
      visibility: 'org',
      origin: 'builtin',
      canEdit: false,
    },
    {
      slug: 'invoices',
      description: 'From the release',
      visibility: 'org',
      origin: 'release',
      owner: 'user-operator',
      ownerName: 'Ops Bot',
      canEdit: false,
    },
  ],
  failures: [],
  teams: [],
}));

vi.mock('../hooks/queries', () => ({
  useSkills: () => ({ data: fixture, isPending: false }),
}));
vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useOrgTeams: () => ({ teams: fixture.teams }),
  useTeamDirectory: () => ({ teams: fixture.teams, isLoading: false }),
}));
vi.mock('@tale/ui/error-boundaries/error-scope', () => ({
  useErrorScope: () => ({ organizationId: 'org1' }),
}));
vi.mock('./skill-create-dialog', () => ({ SkillCreateDialog: () => null }));
vi.mock('./skill-upload-dialog', () => ({ SkillUploadDialog: () => null }));
vi.mock('./skill-pane-dialog', () => ({ SkillDetailDialog: () => null }));

/** The Created by cell of the row a skill's name button sits in. */
function createdByOf(slug: string): string | null {
  const row = screen.getByRole('button', { name: slug }).closest('tr');
  if (row === null) throw new Error(`no row for ${slug}`);
  const header = screen.getByRole('columnheader', { name: 'Created by' });
  const column = [...(header.parentElement?.children ?? [])].indexOf(header);
  return within(row).getAllByRole('cell')[column]?.textContent ?? null;
}

describe('SkillsSettings — Created by', () => {
  it('names who created each skill', () => {
    render(<SkillsSettings organizationId="org1" />);

    expect(createdByOf('house-voice')).toBe('Ada Lovelace');
    expect(createdByOf('old-notes')).toBe('Former member');
    expect(createdByOf('docx')).toBe('Built-in');
    expect(createdByOf('invoices')).toBe('Configuration release · Ops Bot');
  });

  it('finds skills by the name of their creator', async () => {
    const { user } = render(<SkillsSettings organizationId="org1" />);

    await user.type(screen.getByPlaceholderText('Search skills'), 'Ada');

    expect(
      await screen.findByRole('button', { name: 'house-voice' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'docx' }),
    ).not.toBeInTheDocument();
  });

  it('finds a configuration release by the member who installed it', async () => {
    const { user } = render(<SkillsSettings organizationId="org1" />);

    await user.type(screen.getByPlaceholderText('Search skills'), 'Ops Bot');

    expect(
      await screen.findByRole('button', { name: 'invoices' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'house-voice' }),
    ).not.toBeInTheDocument();
  });
});
