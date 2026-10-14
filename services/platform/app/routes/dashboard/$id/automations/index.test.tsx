import { beforeEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

const { search, navigate } = vi.hoisted(() => ({
  search: { current: {} as Record<string, unknown> },
  navigate: vi.fn(),
}));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
    useParams: () => ({ id: 'org-1' }),
    useSearch: () => search.current,
    fullPath: '/dashboard/$id/automations/',
  }),
  useNavigate: () => navigate,
}));

// The page's shell has its own suites.
vi.mock('@tale/ui/page-layout', () => ({
  PageLayout: ({
    header,
    children,
  }: {
    header: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <main>
      {header}
      {children}
    </main>
  ),
}));
vi.mock('@tale/ui/adaptive-header', () => ({
  AdaptiveHeaderRoot: ({ children }: { children: React.ReactNode }) => (
    <header>{children}</header>
  ),
  AdaptiveHeaderTitle: ({ children }: { children: React.ReactNode }) => (
    <h1>{children}</h1>
  ),
}));

// The list has its own suites: here it only shows what the page asked of it.
vi.mock('@/app/features/automations/components/automations-list', () => ({
  AutomationsList: ({ openTemplates }: { openTemplates?: string }) => (
    <p>
      {openTemplates === undefined ? 'list' : `catalog on ${openTemplates}`}
    </p>
  ),
}));

const { Route } = await import('./index');
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- createFileRoute is mocked to return the config
const AutomationsPage = (
  Route as unknown as { component: () => React.ReactElement }
).component;

beforeEach(() => {
  search.current = {};
  navigate.mockClear();
});

describe('the automations page', () => {
  it('opens the template catalog on the tab its address names, once', () => {
    search.current = { templates: 'inbox' };
    render(<AutomationsPage />);
    expect(screen.getByText('catalog on inbox')).toBeInTheDocument();
    // The address drops the request, so a reload or the way back from an
    // automation shows the list.
    expect(navigate).toHaveBeenCalledWith(
      expect.objectContaining({ replace: true }),
    );
    const [{ search: next }] = navigate.mock.calls[0] as [
      {
        search: (previous: Record<string, unknown>) => Record<string, unknown>;
      },
    ];
    expect(next({ templates: 'inbox' })).toEqual({ templates: undefined });
  });

  it('opens every template for a tab it does not know', () => {
    search.current = { templates: 'pigeons' };
    render(<AutomationsPage />);
    expect(screen.getByText('catalog on all')).toBeInTheDocument();
  });

  it('shows the list alone without one', () => {
    render(<AutomationsPage />);
    expect(screen.getByText('list')).toBeInTheDocument();
    expect(navigate).not.toHaveBeenCalled();
  });
});
