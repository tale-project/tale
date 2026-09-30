// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

// ---------------------------------------------------------------------------
// Home on a phone creates nothing: its header holds the title and search, and
// a new chat starts from the Chats view of the list below. On a desktop the
// route sends you to the chat, where the Home panel already stands.
// ---------------------------------------------------------------------------

const { mobile } = vi.hoisted(() => ({ mobile: { current: true } }));

vi.mock('@tanstack/react-router', () => ({
  createFileRoute: () => (config: Record<string, unknown>) => ({
    useParams: () => ({ id: 'org-1' }),
    ...config,
  }),
  Navigate: ({ to }: { to: string }) => (
    <div data-testid="navigate" data-to={to} />
  ),
  Link: ({ children, to }: { children: React.ReactNode; to: string }) => (
    <a href={to}>{children}</a>
  ),
}));

vi.mock('@tale/ui/use-is-mobile', () => ({
  useIsMobile: () => mobile.current,
}));

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({ t: (key: string) => `${ns}.${key}` }),
}));

vi.mock('@/lib/utils/seo', () => ({ seo: () => [] }));

// PageLayout / AdaptiveHeaderRoot need an AdaptiveHeaderProvider this test has
// no reason to stand up — the subject is what the header holds.
vi.mock('@tale/ui/page-layout', () => ({
  PageLayout: ({
    header,
    children,
  }: {
    header?: React.ReactNode;
    children: React.ReactNode;
  }) => (
    <div>
      <header>{header}</header>
      {children}
    </div>
  ),
}));

vi.mock('@tale/ui/adaptive-header', () => ({
  AdaptiveHeaderRoot: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  AdaptiveHeaderTitle: ({ children }: { children: React.ReactNode }) => (
    <h1>{children}</h1>
  ),
}));

vi.mock('@/app/components/layout/app-sidebar/sidebar-search-trigger', () => ({
  SidebarSearchTrigger: () => <button type="button">Search</button>,
}));

vi.mock('@/app/features/home/components/home-panel', () => ({
  HomeNavigator: ({ variant }: { variant?: string }) => (
    <div data-testid="navigator" data-variant={variant} />
  ),
}));

import { Route } from './home';

// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- createFileRoute is mocked to return the config
const HomeScreen = (Route as unknown as { component: () => React.ReactElement })
  .component;

afterEach(() => {
  mobile.current = true;
});

describe('Home route', () => {
  it('holds only the title and search in the phone header', () => {
    render(<HomeScreen />);
    expect(
      screen.getByRole('heading', { name: 'home.title' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Search' })).toBeInTheDocument();
    expect(
      screen.queryByRole('link', { name: 'home.newChat' }),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'home.newChat' }),
    ).not.toBeInTheDocument();
  });

  it('shows the list as the phone screen, not as the desktop panel', () => {
    render(<HomeScreen />);
    expect(screen.getByTestId('navigator')).toHaveAttribute(
      'data-variant',
      'screen',
    );
  });

  it('sends a desktop visit to the chat', () => {
    mobile.current = false;
    render(<HomeScreen />);
    expect(screen.getByTestId('navigate')).toHaveAttribute(
      'data-to',
      '/dashboard/$id/chat',
    );
    expect(screen.queryByTestId('navigator')).not.toBeInTheDocument();
  });
});
