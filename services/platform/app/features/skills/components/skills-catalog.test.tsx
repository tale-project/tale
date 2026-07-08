// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import type { SkillListEntry } from '../hooks/queries';

let mockSkills: SkillListEntry[] | undefined = [];
let mockIsLoading = false;
let mockError: Error | null = null;
const mockRefetch = vi.fn();

vi.mock('../hooks/queries', () => ({
  useListSkills: () => ({
    skills: mockSkills,
    isLoading: mockIsLoading,
    error: mockError,
    refetch: mockRefetch,
  }),
  // The (closed) template dialog behind the Add menu lists the builtin
  // catalog — irrelevant to the catalog's own contract.
  useListCatalogSkills: () => ({
    templates: [],
    isLoading: false,
    error: null,
  }),
}));

// The catalog's write actions all wrap Convex mutations that invalidate
// react-query — no QueryClient mounts in this suite, so stub each to the
// real `{ mutateAsync }` shape. Create feeds the (closed) Add-menu dialogs;
// duplicate/export/delete feed each card's ⋯ menu (delete via the closed
// SkillDeleteDialog the menu renders).
vi.mock('../hooks/mutations', () => ({
  useCreateSkill: () => ({ mutateAsync: vi.fn() }),
  useDuplicateSkill: () => ({ mutateAsync: vi.fn() }),
  useExportSkill: () => ({ mutateAsync: vi.fn() }),
  useDeleteSkill: () => ({ mutateAsync: vi.fn() }),
}));

// FormDialog (the closed create dialogs' shell) resolves the org for its
// error boundary via router params; no router mounts in this suite.
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

// The full-management detail panel wires read/audit/duplicate Convex hooks
// that aren't under test here — the catalog's contract is only that a card
// click opens the panel pointed at the right slug, in write mode.
vi.mock('./skill-detail-panel', () => ({
  SkillDetailPanel: ({
    slug,
    readOnly,
  }: {
    slug: string;
    readOnly?: boolean;
  }) => (
    <div data-testid="skill-detail-panel" data-slug={slug}>
      {readOnly ? 'read-only' : 'writable'}
    </div>
  ),
}));

// The upload dialog (mounted closed behind the Add menu) wires a stack of
// Convex upload mutations + file-upload hooks — stub it so the real
// SkillsActionMenu trigger still renders in the page-composition test.
vi.mock('./skill-upload/skill-upload-dialog', () => ({
  SkillUploadDialog: () => null,
}));

import { SkillsActionMenu } from './skills-action-menu';
import { SkillsCatalog } from './skills-catalog';

const SKILLS = [
  {
    slug: 'issue-triage',
    name: 'Issue triage',
    description: 'Label and route incoming issues.',
    hash: 'hash-1',
  },
  {
    slug: 'broken-skill',
    status: 'corrupted',
    message: 'SKILL.md could not be parsed',
  },
] as SkillListEntry[];

beforeEach(() => {
  vi.clearAllMocks();
  mockSkills = SKILLS;
  mockIsLoading = false;
  mockError = null;
});

describe('SkillsCatalog', () => {
  it('renders one card per skill row from the list', () => {
    render(<SkillsCatalog organizationId="org-1" />);
    expect(
      screen.getByRole('button', { name: 'Issue triage' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('Label and route incoming issues.'),
    ).toBeInTheDocument();
    // Broken bundles surface as rows named by their slug, never dropped.
    expect(
      screen.getByRole('button', { name: 'broken-skill' }),
    ).toBeInTheDocument();
  });

  it('badges a broken row and shows its read-error message', () => {
    render(<SkillsCatalog organizationId="org-1" />);
    expect(screen.getByText('Failed to read SKILL.md')).toBeInTheDocument();
    expect(
      screen.getByText('SKILL.md could not be parsed'),
    ).toBeInTheDocument();
  });

  it('opens the writable detail panel on a whole-card click', async () => {
    const { user } = render(<SkillsCatalog organizationId="org-1" />);
    expect(screen.queryByTestId('skill-detail-panel')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Issue triage' }));

    const panel = screen.getByTestId('skill-detail-panel');
    expect(panel).toHaveAttribute('data-slug', 'issue-triage');
    // Settings context manages bundles — never the read-only binding view.
    expect(panel).toHaveTextContent('writable');
  });

  it('pre-opens the panel for an initial deep-link slug', () => {
    render(
      <SkillsCatalog organizationId="org-1" initialDetailSlug="issue-triage" />,
    );
    expect(screen.getByTestId('skill-detail-panel')).toHaveAttribute(
      'data-slug',
      'issue-triage',
    );
  });

  it('filters cards through the toolbar search and offers a no-results state', async () => {
    const { user } = render(<SkillsCatalog organizationId="org-1" />);
    await user.type(
      screen.getByPlaceholderText('Search skills…'),
      'zzz-nomatch',
    );
    expect(screen.getByText('No matching skills')).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Issue triage' }),
    ).not.toBeInTheDocument();
  });

  it('renders the empty state when the org has no skills', () => {
    mockSkills = [];
    render(<SkillsCatalog organizationId="org-1" />);
    expect(screen.getByText('No skills yet')).toBeInTheDocument();
  });

  it('renders the settings page composition: section heading + Add menu', () => {
    // Mirrors app/routes/dashboard/$id/settings/skills/index.tsx so the
    // heading + Add affordance assertion exercises the shipped composition.
    render(
      <SettingsSection
        title="Skills"
        description="Reusable instruction bundles"
        action={<SkillsActionMenu organizationId="org-1" />}
      >
        <SkillsCatalog organizationId="org-1" />
      </SettingsSection>,
    );
    expect(
      screen.getByRole('heading', { name: 'Skills', level: 2 }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole('button', { name: /Add skill/ }),
    ).toBeInTheDocument();
  });

  describe('accessibility', () => {
    it('passes axe audit in the empty state', async () => {
      mockSkills = [];
      const { container } = render(<SkillsCatalog organizationId="org-1" />);
      await checkAccessibility(container);
    });

    it('passes axe audit with cards', async () => {
      const { container } = render(<SkillsCatalog organizationId="org-1" />);
      await checkAccessibility(container);
    });
  });
});
