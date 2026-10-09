import type { ComponentType } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { render, screen } from '@/tests/utils/render';

// Register the actual lazy loading callback; the hook and persistence stay real.
import './board';

const state = vi.hoisted(() => ({
  allProjects: false,
  Loading: undefined as ComponentType | undefined,
}));

vi.mock('@tale/ui/lazy-component', () => ({
  lazyComponent: (_load: unknown, options: { loading: ComponentType }) => {
    state.Loading = options.loading;
    return () => null;
  },
}));
vi.mock('@tanstack/react-router', async (original) => ({
  ...(await original<typeof import('@tanstack/react-router')>()),
  createFileRoute: () => () => ({
    useParams: () => ({ id: 'org-1', projectId: 'project-1' }),
    useSearch: () => (state.allProjects ? { projects: 'all' } : {}),
  }),
  useRouter: vi.fn(),
}));
vi.mock('@/app/features/projects/hooks/queries', () => ({
  useProject: () => ({ project: { canEdit: false } }),
}));
vi.mock('@/app/features/tasks/components/tasks-skeleton', () => ({
  TasksPageSkeleton: ({
    collapsedLanes,
  }: {
    collapsedLanes: ReadonlySet<string>;
  }) => (
    <div data-testid="fallback" data-folded={[...collapsedLanes].join(',')} />
  ),
}));

afterEach(() => {
  state.allProjects = false;
  for (const scope of ['project-1', 'all']) {
    window.localStorage.removeItem(
      `tale.platform.tasks.board.collapsedLanes.${scope}`,
    );
  }
});

describe('board chunk fallback persisted lanes', () => {
  it.each([false, true])(
    'validates saved values with allProjects=%s',
    (allProjects) => {
      state.allProjects = allProjects;
      const key = `tale.platform.tasks.board.collapsedLanes.${allProjects ? 'all' : 'project-1'}`;
      const Loading = state.Loading;
      if (Loading === undefined)
        throw new Error('Missing board chunk fallback');
      for (const stored of [{}, null, 'done', ['done', null, {}, 'todo']]) {
        window.localStorage.setItem(key, JSON.stringify(stored));
        const view = render(<Loading />);
        expect(screen.getByTestId('fallback')).toHaveAttribute(
          'data-folded',
          Array.isArray(stored) ? 'done' : '',
        );
        view.unmount();
      }
    },
  );
});
