import { AppShell } from '@tale/ui/app-shell';
import { renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createProjectsSearchSource } from '@/app/features/projects/data/projects-search-source';
import { i18n } from '@/lib/i18n/i18n';

import { createTasksSearchSource } from './tasks-search-source';

const backend = vi.hoisted(() => ({
  data: [] as unknown[],
}));

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => ({
    data: backend.data,
    isLoading: false,
    isFetching: false,
  }),
}));

function wrapper({ children }: { children: ReactNode }) {
  return (
    <AppShell i18n={i18n} locale={{ mode: 'client' }}>
      {children}
    </AppShell>
  );
}

const OPEN = { active: true, open: true };

beforeEach(() => {
  backend.data = [];
});

describe('the palette task source', () => {
  it('reads a task without a description by its status, not its title twice', () => {
    backend.data = [
      {
        taskId: 't1',
        projectId: 'p1',
        title: 'Review the launch checklist',
        status: 'in_review',
        snippet: 'Review the launch checklist',
        updatedAt: 1,
        number: 2,
        projectKey: 'WEB',
      },
    ];
    const source = createTasksSearchSource({ organizationId: 'org-1' });
    const { result } = renderHook(() => source('review', OPEN), { wrapper });

    expect(result.current.results[0]).toMatchObject({
      title: 'WEB-2 · Review the launch checklist',
      subtitle: 'In review',
      data: { kind: 'task', projectId: 'p1', status: 'in_review' },
    });
  });

  it('keeps the matching description or comment as the line underneath', () => {
    backend.data = [
      {
        taskId: 't1',
        projectId: 'p1',
        title: 'Connect a connector',
        status: 'todo',
        snippet: 'Connect GitHub from Settings',
        updatedAt: 1,
      },
    ];
    const source = createTasksSearchSource({ organizationId: 'org-1' });
    const { result } = renderHook(() => source('git', OPEN), { wrapper });

    expect(result.current.results[0]?.subtitle).toBe(
      'Connect GitHub from Settings',
    );
  });

  it('says nothing underneath when an older backend sends no status', () => {
    backend.data = [
      {
        taskId: 't1',
        projectId: 'p1',
        title: 'Pick hero imagery',
        snippet: 'Pick hero imagery',
        updatedAt: 1,
      },
    ];
    const source = createTasksSearchSource({ organizationId: 'org-1' });
    const { result } = renderHook(() => source('hero', OPEN), { wrapper });

    expect(result.current.results[0]?.subtitle).toBe('');
    expect(result.current.results[0]?.data).toEqual({
      kind: 'task',
      projectId: 'p1',
    });
  });
});

describe('the palette project source', () => {
  it('keeps the key in the title and only the description underneath', () => {
    backend.data = [
      {
        projectId: 'p1',
        name: 'Website relaunch',
        key: 'WEB',
        snippet: 'WEB · New marketing site for Q4',
        updatedAt: 1,
      },
      {
        projectId: 'p2',
        name: 'Pricing review',
        key: 'PRC',
        snippet: 'PRC',
        updatedAt: 1,
      },
    ];
    const source = createProjectsSearchSource({ organizationId: 'org-1' });
    const { result } = renderHook(() => source('re', OPEN), { wrapper });

    expect(
      result.current.results.map((hit) => [hit.title, hit.subtitle]),
    ).toEqual([
      ['WEB · Website relaunch', 'New marketing site for Q4'],
      ['PRC · Pricing review', ''],
    ]);
  });
});
