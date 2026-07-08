// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

// Route tests run in the `server` project (no `setup-ui.ts`); jsdom ships no
// `matchMedia`, which `useIsMobile` (via `AdaptiveHeaderRoot`) reads on mount.
Object.defineProperty(window, 'matchMedia', {
  writable: true,
  value: vi.fn().mockImplementation((query: string) => ({
    matches: false,
    media: query,
    onchange: null,
    addEventListener: vi.fn(),
    removeEventListener: vi.fn(),
    dispatchEvent: vi.fn(),
  })),
});

afterEach(() => {
  cleanup();
});

// Regression coverage for #2543: the detail breadcrumb rendered parent crumbs
// ("Agents", folder segments) as plain links outside the page `Heading`, so
// they fell back to the inherited body typography while the leaf agent name
// carried the `text-base font-semibold` page-title style — a visible weight
// and size mismatch. The whole `ol` trail (now the shared `HeaderBreadcrumbs`)
// carries the page-title typography (parents are dimmed via colour only), and
// folder segments render the raw path segment — table folder navigation shows
// paths verbatim, exactly as the documents table does.

const { mockUseParams } = vi.hoisted(() => ({
  mockUseParams: () => ({ id: 'org-1', agentId: 'agent-1' }),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useParams: mockUseParams,
    ...config,
  }),
  // Class passthrough matters: the assertions below read the crumbs' classes.
  Link: ({
    children,
    className,
  }: {
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href="/" className={className}>
      {children}
    </a>
  ),
  Outlet: () => null,
  // `LayoutErrorBoundary` (inside `PageLayout`) resets on pathname changes.
  useLocation: () => ({ pathname: '/dashboard/org-1/agents/agent-1' }),
}));

vi.mock('@convex-dev/react-query', () => ({
  convexQuery: (fn: unknown, args: unknown) => ({
    queryKey: ['convex-query', fn, args],
  }),
}));

vi.mock('@/convex/_generated/api', () => ({
  api: {
    users: { queries: { getCurrentUser: 'getCurrentUser-ref' } },
    agents: { file_actions: { readAgent: 'readAgent-ref' } },
  },
}));

// Loaded agent: the config resolves the leaf display name; the roster row
// carries the folder that becomes the parent folder crumb.
vi.mock('@/app/features/agents/hooks/queries', () => ({
  useReadAgent: () => ({
    data: {
      ok: true,
      config: { displayName: 'Support Agent', supportedModels: [] },
    },
    isLoading: false,
    error: null,
    refetch: vi.fn(),
  }),
  useListAgents: () => ({
    agents: [
      { name: 'agent-1', displayName: 'Support Agent', folder: 'workforce' },
    ],
  }),
}));

// The tab strip drags in mutation hooks and dialogs irrelevant to the header.
vi.mock('@/app/features/agents/components/agent-navigation', () => ({
  AgentNavigation: () => null,
}));

import { AdaptiveHeaderProvider } from '@/app/components/layout/adaptive-header';

import { Route } from './$agentId';

// The router mock above replaces `createFileRoute`, so `Route` is the plain
// config object and `Route.component` is the layout under test.
const AgentDetailLayout = (
  Route as unknown as { component: () => React.ReactElement }
).component;

function renderDetailLayout() {
  return render(
    <AdaptiveHeaderProvider>
      <AgentDetailLayout />
    </AdaptiveHeaderProvider>,
  );
}

/** Tailwind font-size / font-weight utilities on an element — a crumb with
 *  any of these diverges from the typography the trail inherits. */
function typographyOverrides(el: Element): string[] {
  return [...el.classList].filter((c) =>
    /^(font-.+|text-(xs|sm|base|lg|xl|\d+xl))$/.test(c),
  );
}

describe('agent detail breadcrumb typography (#2543)', () => {
  it('gives parent crumbs and the leaf the same page-title typography', () => {
    renderDetailLayout();

    // The trail itself carries the page-title typography, so every crumb
    // inherits the same size and weight…
    const nav = screen.getByRole('navigation', { name: 'Breadcrumb' });
    const trail = nav.querySelector('ol');
    expect(trail).toHaveClass('text-base', 'font-semibold');

    // …matching the leaf `Heading size="base"` (also the `AdaptiveHeaderTitle`
    // style of the list view and the automations detail breadcrumb).
    const leaf = screen.getByRole('heading', { level: 1 });
    expect(leaf).toHaveTextContent('Support Agent');
    expect(leaf).toHaveClass('text-base', 'font-semibold');

    // Parent crumbs override colour only — no size/weight utility may diverge
    // from what the trail inherits.
    for (const crumb of [
      screen.getByRole('link', { name: 'Agents' }),
      screen.getByRole('link', { name: 'workforce' }),
    ]) {
      expect(typographyOverrides(crumb)).toEqual([]);
    }
  });

  it('shows the raw folder path segment, verbatim', () => {
    renderDetailLayout();

    expect(screen.getByRole('link', { name: 'workforce' })).toBeInTheDocument();
    expect(screen.queryByText('Workforce')).not.toBeInTheDocument();
  });

  it('marks only the leaf as the current page', () => {
    const { container } = renderDetailLayout();

    const current = container.querySelectorAll('[aria-current="page"]');
    expect(current).toHaveLength(1);
    expect(current[0]).toBe(screen.getByRole('heading', { level: 1 }));
  });
});
