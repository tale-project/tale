import '@testing-library/jest-dom/vitest';
import {
  AdaptiveHeaderProvider,
  AdaptiveHeaderSlot,
} from '@tale/ui/adaptive-header';
import type { ReactNode } from 'react';
import { afterEach, expect, it, vi } from 'vitest';
import { page } from 'vitest/browser';

import { Route } from '@/app/routes/dashboard/$id/projects/$projectId';
import { cleanup, render, screen, within } from '@/tests/utils/render';

import '@/app/globals.css';

vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  createFileRoute: () => (config: Record<string, unknown>) => ({
    ...config,
    useParams: () => ({ id: 'org-1', projectId: 'proj-1' }),
  }),
  useParams: () => ({ id: 'org-1', projectId: 'proj-1' }),
  useMatch: () => undefined,
  useLocation: () => ({
    pathname: '/dashboard/org-1/projects/proj-1/agents',
    search: {},
    state: {},
  }),
  useNavigate: () => vi.fn(),
  Outlet: () => null,
  Link: ({
    children,
    className,
  }: {
    children: ReactNode;
    className?: string;
  }) => (
    <a href="#projects" className={className}>
      {children}
    </a>
  ),
}));
vi.mock('@/app/features/automations/hooks/queries', async (original) => ({
  ...(await original<
    typeof import('@/app/features/automations/hooks/queries')
  >()),
  useAutomations: () => ({ data: [] }),
}));
vi.mock('@/app/features/projects/hooks/queries', async (original) => ({
  ...(await original<typeof import('@/app/features/projects/hooks/queries')>()),
  useProject: () => ({
    project: {
      _id: 'proj-1',
      name: 'ui-eval-r2-project-core-renamed',
      archivedAt: 1,
    },
    isLoading: false,
  }),
  useProjects: () => ({
    projects: [{ _id: 'proj-1', name: 'ui-eval-r2-project-core-renamed' }],
  }),
}));
vi.mock('@/app/components/navigation/tab-navigation', () => ({
  TabNavigation: () => null,
}));
// oxlint-disable-next-line typescript/no-unsafe-type-assertion -- the route factory mock retains the component
const ProjectDetailLayout = (Route as unknown as { component: () => ReactNode })
  .component;
afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
});
it.each(['light', 'dark'])(
  'keeps the archived project badge visible at 400px in %s mode',
  async (theme) => {
    await page.viewport(400, 900);
    document.documentElement.classList.toggle('dark', theme === 'dark');
    render(
      <div style={{ width: 340 }}>
        <AdaptiveHeaderProvider>
          <AdaptiveHeaderSlot />
          <ProjectDetailLayout />
        </AdaptiveHeaderProvider>
      </div>,
    );
    const title = await screen.findByRole('heading', { level: 1 });
    const badge = within(title).getByText('Archived');
    expect(badge).toBeVisible();
    const badgeBox = badge.getBoundingClientRect();
    const titleBox = title.getBoundingClientRect();
    expect(badgeBox.right).toBeLessThanOrEqual(titleBox.right + 1);
    expect(badgeBox.width).toBeGreaterThan(0);
    expect(badge.scrollWidth).toBeLessThanOrEqual(badge.clientWidth + 1);
    expect(within(title).getByRole('button')).toBeVisible();
  },
);
