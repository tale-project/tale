import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { describe, expect, it, vi } from 'vitest';

import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen } from '@/tests/utils/render';

import { SkillsTable } from './skills-table';

// Migrated from the `settings depth — skills` E2E "renders the skills page and
// exposes the upload affordance". That test only asserts two pure-UI facts:
// the section heading ("Skills", h2) and the always-present "Upload skill"
// header action — neither depends on backend RBAC, persistence, or routing.
// The settings/skills route is a plain `component:` render with no
// beforeLoad/loader redirect, so reproducing the exact route composition
// (SettingsSection title + SkillsTable) in jsdom is faithful. We mock the data
// hooks to the org's fresh, skill-less state (the empty-state the E2E hits) so
// the upload affordance is what proves the page mounted.
// The DataTable shell resolves the org from the router (useOrganizationId ->
// useParams) and primitives preload routes via useRouter. There is no
// RouterProvider in jsdom, so partial-mock the router (keeping real exports
// like Link) and pin the org id the table reads.
vi.mock('@tanstack/react-router', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-router')>()),
  useParams: () => ({ id: 'org-1' }),
  useNavigate: () => vi.fn(),
  useRouter: () => ({ preloadRoute: vi.fn() }),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

vi.mock('../hooks/queries', () => ({
  useListSkills: () => ({
    skills: [],
    isLoading: false,
    error: undefined,
    refetch: vi.fn(),
  }),
}));

vi.mock('../hooks/mutations', () => ({
  useDeleteSkill: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

// The upload dialog (mounted closed behind the action-menu trigger) wires a
// stack of Convex upload mutations + file-upload hooks that aren't part of this
// migration — the E2E only asserts the closed-state "Upload skill" trigger, it
// never opened the dialog. Stub the dialog so the real SkillsActionMenu (and
// its trigger button under test) still renders.
vi.mock('./skill-upload/skill-upload-dialog', () => ({
  SkillUploadDialog: () => null,
}));

function renderSkillsSettings() {
  // Mirrors app/routes/dashboard/$id/settings/skills/index.tsx so the assertion
  // exercises the same heading + table composition the E2E loaded. SkillsTable
  // reads a real QueryClient (invalidation + bulk-delete), so provide one
  // rather than mocking react-query away — that keeps the real action menu
  // (the upload affordance under test) intact.
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  return render(
    <QueryClientProvider client={queryClient}>
      <SettingsSection
        title="Skills"
        description="Reusable instruction bundles"
      >
        <SkillsTable organizationId="org-1" initialDetailSlug={null} />
      </SettingsSection>
    </QueryClientProvider>,
  );
}

describe('SkillsTable (settings)', () => {
  it('renders the skills section heading and exposes the upload affordance', () => {
    renderSkillsSettings();

    // Section heading — the E2E asserted `getByRole('heading', { level: 2 })`
    // with the navigation.skills label.
    expect(
      screen.getByRole('heading', { name: 'Skills', level: 2 }),
    ).toBeInTheDocument();

    // The header action menu trigger ("Upload skill") is always rendered for
    // the settings context regardless of row count — its presence is what the
    // E2E used to prove the page mounted and offers the manage affordance.
    expect(
      screen.getByRole('button', { name: /Upload skill/ }),
    ).toBeInTheDocument();
  });

  it('passes an axe audit in the empty state', async () => {
    const { container } = renderSkillsSettings();
    // `empty-table-header` is disabled: the shared DataTable's leading
    // selection column and trailing actions column intentionally have empty
    // <th> headers (every settings table in the app does, e.g. agents /
    // documents). That is a deliberate primitive-level decision, not a defect
    // of the skills page under test.
    await checkAccessibility(container, {
      rules: { 'empty-table-header': { enabled: false } },
    });
  });
});
