import { renderHook } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: (name: string) => ({
    data:
      name === 'projects/search:searchProjects'
        ? [
            {
              projectId: 'p1',
              name: 'Old project',
              snippet: '',
              archived: true,
            },
          ]
        : name === 'tasks/search:searchTasks'
          ? [
              {
                taskId: 't1',
                projectId: 'p1',
                title: 'Old task',
                snippet: '',
                archived: true,
              },
              {
                taskId: 't2',
                projectId: 'p1',
                title: 'Active task',
                snippet: '',
                projectArchived: true,
              },
            ]
          : [],
    isLoading: false,
    isFetching: false,
  }),
}));

vi.mock('@/app/features/chat/data/chat-backend', () => ({
  useChatQuery: () => ({ status: 'ready', data: [] }),
}));
vi.mock('@/app/features/documents/data/documents-search-source', () => ({
  createDocumentsSearchSource: () => () => ({ results: [], status: 'ready' }),
}));
vi.mock('@/app/features/contacts/data/contacts-search-source', () => ({
  createContactsSearchSource: () => () => ({ results: [], status: 'ready' }),
}));
vi.mock('@/lib/i18n/client', () => ({
  useT: () => ({ t: (key: string) => key }),
}));

import { createPlatformSearchSource } from './platform-search-source';

describe('combined search status badges', () => {
  it('preserves the archived project and task badges from the source results', () => {
    const source = createPlatformSearchSource({ organizationId: 'o1' });
    const { result } = renderHook(() =>
      source('task', { active: true, open: true }),
    );
    expect(
      result.current.results.map(({ id, badge }) => ({ id, badge })),
    ).toEqual([
      { id: 'p1', badge: 'search.badgeArchived' },
      { id: 't1', badge: 'search.badgeArchived' },
      { id: 't2', badge: 'search.badgeProjectArchived' },
    ]);
  });
});
