// @vitest-environment jsdom
import { describe, expect, it, vi } from 'vitest';

import { SettingsSection } from '@/app/features/settings/components/settings-section';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

// Migrated from the core-settings E2E "providers: lists the seeded provider and
// opens its detail drawer". What that test proved is pure rendered-UI / local
// component state: the providers list renders the seeded provider's display
// name in its table, and the deep-link variant (`initialDetailProvider`) opens
// the detail drawer with its "General" section + the same display name. There
// is no persistence round-trip, router redirect/loader, streaming, or
// backend-enforced gate in that assertion path — the drawer is opened from
// `useState` seeded by a prop — so it belongs at the component tier. We mock the
// providers query (one seeded provider) + the detail read, and assert the same
// seams the E2E did.

const PROVIDER_SLUG = 'e2e-mock';
const PROVIDER_DISPLAY_NAME = 'E2E Mock Provider';
const PROVIDER_BASE_URL = 'https://mock.example.com/v1';

const seededProviderConfig = {
  displayName: PROVIDER_DISPLAY_NAME,
  description: 'A mock provider seeded for tests',
  baseUrl: PROVIDER_BASE_URL,
  providerOptions: {},
  models: [],
};

const seededListEntry = {
  name: PROVIDER_SLUG,
  displayName: PROVIDER_DISPLAY_NAME,
  description: seededProviderConfig.description,
  baseUrl: PROVIDER_BASE_URL,
  modelCount: 0,
  models: [],
};

// Stable references for every mocked hook return so re-renders never see a
// fresh object identity — a fresh object per render here loops + OOMs the
// worker (the drawer subtree memoizes against these).
const LIST_RESULT = {
  providers: [seededListEntry],
  isLoading: false,
  error: undefined,
  refetch: () => {},
};
const READ_RESULT = {
  data: { ok: true, config: seededProviderConfig, hash: 'h1' },
  isLoading: false,
};
const SECRET_RESULT = { data: null, error: undefined };
const EMPTY_CAPS = new Map();
const CONVEX_QUERY_RESULT = { data: [], isLoading: false };

// Both the list (table) and the detail drawer read through these hooks.
vi.mock('../hooks/queries', () => ({
  useListProviders: () => LIST_RESULT,
  useReadProvider: () => READ_RESULT,
  useHasProviderSecret: () => SECRET_RESULT,
  useHasModelSecret: () => SECRET_RESULT,
  useModelCapabilities: () => EMPTY_CAPS,
}));

// The drawer subtree (api-key / models / default-models sections) and the
// ProviderConfigProvider all read mutations from this module; stub the surface.
vi.mock('../hooks/mutations', () => ({
  useSaveProvider: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useDeleteProvider: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useSaveProviderSecret: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useFetchProviderModels: () => ({ mutateAsync: vi.fn(), isPending: false }),
  useFetchConfiguredProviderModels: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
  useTestProviderConnection: () => ({ mutateAsync: vi.fn(), isPending: false }),
}));

// Models-section reads the catalog capabilities through this hook.
vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => CONVEX_QUERY_RESULT,
}));

// The table reads the query client to invalidate after delete; there is no
// RouterProvider/QueryClientProvider in the component test, so stub it.
vi.mock('@tanstack/react-query', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tanstack/react-query')>()),
  useQueryClient: () => ({ invalidateQueries: vi.fn() }),
}));

// The DataTable reads the org id from the router; outside a RouterProvider that
// hook throws, so stub it (only used for row-level deep links).
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

import { ProviderDetailDrawer } from './provider-detail-drawer';
import { ProvidersTable } from './providers-table';

// Mirror the route chrome: the level-2 section heading ("AI providers") that the
// E2E asserts comes from the SettingsSection the route wraps the table in.
function renderList(initialDetailProvider?: string) {
  return render(
    <SettingsSection title="AI providers">
      <ProvidersTable
        organizationId="org-1"
        initialDetailProvider={initialDetailProvider}
      />
    </SettingsSection>,
  );
}

describe('Providers list + detail drawer', () => {
  it('renders the section heading and lists the seeded provider', () => {
    renderList();

    // Section heading (the providers list title) — level 2.
    expect(
      screen.getByRole('heading', { name: 'AI providers', level: 2 }),
    ).toBeInTheDocument();

    // The seeded provider row renders its display name.
    expect(screen.getByText(PROVIDER_DISPLAY_NAME)).toBeInTheDocument();
  });

  it('opens the detail drawer (auto-opened via deep-link) showing the General section and seeded name', async () => {
    renderList(PROVIDER_SLUG);

    // The deep-link variant auto-opens the drawer on mount. Its "General"
    // section heading is level 3.
    const generalHeading = await screen.findByRole('heading', {
      name: 'General',
      level: 3,
    });
    expect(generalHeading).toBeInTheDocument();

    // The drawer shows the seeded display name (the General section's Display
    // name row). It is also present in the list behind it, so assert it is
    // visible within the drawer dialog specifically.
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText(PROVIDER_DISPLAY_NAME)).toBeInTheDocument();
  });

  it('opens the drawer on row click (local state)', async () => {
    const { user } = renderList();

    // No drawer initially.
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    // Clicking the seeded row opens the detail drawer.
    await user.click(screen.getByText(PROVIDER_DISPLAY_NAME));

    expect(
      await screen.findByRole('heading', { name: 'General', level: 3 }),
    ).toBeInTheDocument();
  });

  // The row menu's "Edit provider" action routes into this same drawer with
  // `initialEditGeneral`, so it opens the shared editor rather than a separate
  // standalone dialog. Assert the drawer honours that deep-link: it opens the
  // General section's edit form (title + the fields the old dialog owned).
  it('opens the General edit form when deep-linked via initialEditGeneral', async () => {
    render(
      <SettingsSection title="AI providers">
        <ProviderDetailDrawer
          open
          onOpenChange={() => {}}
          organizationId="org-1"
          providerName={PROVIDER_SLUG}
          initialEditGeneral
        />
      </SettingsSection>,
    );

    // The drawer opens straight into the General edit form (a modal over the
    // drawer) — the same editor the row menu's "Edit provider" now targets,
    // rather than a separate standalone dialog.
    expect(await screen.findByText('Edit general details')).toBeInTheDocument();
    // The consolidated editor still exposes the fields the old dialog owned.
    const baseUrl = screen.getByRole('textbox', { name: /Base URL/i });
    expect(baseUrl).toHaveValue(PROVIDER_BASE_URL);
  });

  it('passes an axe audit of the opened detail drawer', async () => {
    renderList(PROVIDER_SLUG);
    // Audit the migrated subject — the opened detail drawer dialog. We scope to
    // the dialog rather than the whole page because the shared `DataTable`
    // emits an intentionally-empty actions/select column header
    // (`empty-table-header`), a known issue owned by that shared primitive and
    // out of scope of what this E2E exercised.
    await screen.findByRole('heading', { name: 'General', level: 3 });
    await checkAccessibility(screen.getByRole('dialog'));
  });
});
