// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => `${ns}.${key}`,
  }),
}));

let skillsData:
  | {
      skills: Array<{
        slug: string;
        description: string;
        visibility: 'private' | 'org';
        icon?: string;
        labels?: string[];
        canEdit: boolean;
      }>;
      failures: Array<{ slug: string; path: string; message: string }>;
    }
  | undefined;
const skillsPending = false;
vi.mock('../hooks/queries', () => ({
  useSkills: () => ({
    data: skillsData,
    isPending: skillsPending,
    isError: false,
  }),
}));

const saveSkill = vi.fn().mockResolvedValue({});
vi.mock('../hooks/mutations', () => ({
  useSaveSkill: () => ({ mutateAsync: saveSkill, isPending: false }),
  useDeleteSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

import { SkillsCatalog } from './skills-catalog';

describe('SkillsCatalog', () => {
  it('renders the viewer-visible skills as cards, flagging private ones', () => {
    skillsData = {
      skills: [
        {
          slug: 'visual-aspect-analyzer',
          description: 'Analyze visual aspects of documents.',
          visibility: 'org',
          labels: ['vision'],
          canEdit: true,
        },
        {
          slug: 'my-notes',
          description: 'Personal playbook.',
          visibility: 'private',
          canEdit: true,
        },
      ],
      failures: [],
    };
    const onOpen = vi.fn();
    render(<SkillsCatalog organizationId="org-1" onOpen={onOpen} />);

    expect(screen.getByText('visual-aspect-analyzer')).toBeInTheDocument();
    expect(screen.getByText('my-notes')).toBeInTheDocument();
    // Exactly the private card carries the visibility badge.
    expect(
      screen.getAllByText('settings.skills.visibility.private'),
    ).toHaveLength(1);
  });

  it('opens a skill on card click', async () => {
    skillsData = {
      skills: [
        {
          slug: 'visual-aspect-analyzer',
          description: 'Analyze visual aspects.',
          visibility: 'org',
          canEdit: true,
        },
      ],
      failures: [],
    };
    const onOpen = vi.fn();
    const { user } = render(
      <SkillsCatalog organizationId="org-1" onOpen={onOpen} />,
    );

    await user.click(screen.getByText('visual-aspect-analyzer'));
    expect(onOpen).toHaveBeenCalledWith('visual-aspect-analyzer');
  });

  it('surfaces unreadable bundles as an operator banner instead of hiding them', () => {
    skillsData = {
      skills: [],
      failures: [
        {
          slug: 'broken',
          path: 'skills/broken/SKILL.md',
          message: 'Frontmatter is missing',
        },
      ],
    };
    render(<SkillsCatalog organizationId="org-1" onOpen={vi.fn()} />);

    expect(
      screen.getByText('settings.skills.columns.loadError'),
    ).toBeInTheDocument();
    expect(screen.getByText('skills/broken/SKILL.md')).toBeInTheDocument();
  });

  it('shows the library empty state with a create path when no skills exist', () => {
    skillsData = { skills: [], failures: [] };
    render(<SkillsCatalog organizationId="org-1" onOpen={vi.fn()} />);

    expect(screen.getByText('emptyStates.skills.title')).toBeInTheDocument();
    expect(
      screen.getAllByText('settings.skills.addMenu.label').length,
    ).toBeGreaterThan(0);
  });
});
