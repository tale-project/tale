import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { SkillLibraryCatalog } from './skill-library-catalog';

/**
 * Component coverage for the skill library's list pane — the surface this
 * catalog vocabulary was extracted FROM, so it also guards that the shared
 * toolbar / view / facet pipeline did not change its behaviour.
 *
 * The listing is a Convex action reading `SKILL.md` bundles off disk; it is
 * stubbed at the module boundary. Unreadable bundles must surface as an
 * operator banner rather than silently shrinking the list.
 */

const fixtures = vi.hoisted(() => ({
  skills: [] as unknown[],
  failures: [] as unknown[],
  isPending: false,
  isError: false,
}));

vi.mock('../hooks/queries', () => ({
  useSkills: () => ({
    data: { skills: fixtures.skills, failures: fixtures.failures },
    isPending: fixtures.isPending,
    isError: fixtures.isError,
    error: null,
  }),
}));

vi.mock('@/app/features/settings/teams/hooks/queries', () => ({
  useOrgTeams: () => ({ teams: [{ id: 'team-1', name: 'Research' }] }),
}));

const skill = (over: Record<string, unknown> = {}) => ({
  slug: 'summarise-thread',
  description: 'Condense a long thread into decisions and open questions.',
  visibility: 'org',
  canEdit: true,
  ...over,
});

const onOpen = vi.fn();
const onAdd = vi.fn();

function renderCatalog() {
  return render(
    <SkillLibraryCatalog
      organizationId="org-1"
      onOpen={onOpen}
      onAdd={onAdd}
    />,
  );
}

describe('SkillLibraryCatalog', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    fixtures.isPending = false;
    fixtures.isError = false;
    fixtures.failures = [];
    fixtures.skills = [
      skill({ labels: ['research'] }),
      skill({
        slug: 'draft-reply',
        description: 'Draft a reply in the requester’s tone.',
        visibility: 'private',
        labels: ['writing'],
      }),
      skill({
        slug: 'team-playbook',
        description: 'Apply the team’s escalation playbook.',
        visibility: 'team',
        teams: ['team-1'],
      }),
    ];
  });

  it('renders a card per skill with its visibility marker', async () => {
    const { container } = renderCatalog();
    expect(
      screen.getByRole('heading', { name: 'summarise-thread' }),
    ).toBeInTheDocument();
    expect(screen.getByText('Private')).toBeInTheDocument();
    // A team-scoped skill names the team rather than saying "team".
    expect(screen.getByText('Research')).toBeInTheDocument();
    await checkAccessibility(container, {
      rules: { 'aria-valid-attr-value': { enabled: false } },
    });
  });

  it('opens a skill by its card', async () => {
    const { user } = renderCatalog();
    await user.click(
      screen.getByRole('button', { name: 'Open skill summarise-thread' }),
    );
    expect(onOpen).toHaveBeenCalledWith('summarise-thread');
  });

  it('narrows by scope tab', async () => {
    const { user } = renderCatalog();
    await user.click(screen.getByRole('tab', { name: 'Personal' }));
    expect(
      screen.getByRole('heading', { name: 'draft-reply' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'summarise-thread' }),
    ).not.toBeInTheDocument();
  });

  it('searches slug, description and labels', async () => {
    const { user } = renderCatalog();
    const search = screen.getByPlaceholderText(/Search/);
    await user.type(search, 'escalation');
    expect(
      screen.getByRole('heading', { name: 'team-playbook' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'draft-reply' }),
    ).not.toBeInTheDocument();
  });

  it('narrows by label', async () => {
    const { user } = renderCatalog();
    await user.click(screen.getByRole('combobox', { name: 'Filter by label' }));
    await user.click(await screen.findByRole('option', { name: 'writing' }));
    expect(
      screen.getByRole('heading', { name: 'draft-reply' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'summarise-thread' }),
    ).not.toBeInTheDocument();
  });

  it('offers the create CTA when the org owns no skills', () => {
    fixtures.skills = [];
    renderCatalog();
    // Zero-data: creating one is exactly the right next step, so the empty
    // state carries its own CTA alongside the toolbar's Add menu.
    expect(screen.getAllByRole('button', { name: /Add skill/ })).toHaveLength(
      2,
    );
  });

  it('offers the search reset — not the create CTA — when nothing matches', async () => {
    const { user } = renderCatalog();
    await user.type(screen.getByPlaceholderText(/Search/), 'zzzzz no match');
    expect(
      screen.getByRole('heading', { name: 'No results found' }),
    ).toBeInTheDocument();
    // Telling a reader who owns three skills to create a first one is wrong:
    // only the toolbar's Add menu remains, the empty state offers no CTA.
    expect(screen.getAllByRole('button', { name: /Add skill/ })).toHaveLength(
      1,
    );
  });

  it('masks with a shape-matched skeleton while the listing resolves', () => {
    fixtures.isPending = true;
    renderCatalog();
    expect(screen.getByRole('status')).toBeInTheDocument();
    expect(
      screen.queryByRole('heading', { name: 'summarise-thread' }),
    ).not.toBeInTheDocument();
  });

  it('reports unreadable bundles instead of silently shrinking the list', () => {
    fixtures.failures = [
      { path: 'skills/broken/SKILL.md', message: 'yaml_syntax' },
    ];
    renderCatalog();
    expect(screen.getByText('skills/broken/SKILL.md')).toBeInTheDocument();
    // The readable skills still render alongside the banner.
    expect(
      screen.getByRole('heading', { name: 'summarise-thread' }),
    ).toBeInTheDocument();
  });

  it('surfaces a whole-listing failure', () => {
    fixtures.isError = true;
    fixtures.skills = [];
    renderCatalog();
    expect(screen.getByRole('alert')).toBeInTheDocument();
  });
});
