// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { TaskInputRefs } from './task-input-refs';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string) => `${ns}.${key}`,
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    search,
  }: {
    children?: ReactNode;
    search?: { folderId?: string };
  }) => (
    <a href={`?folderId=${search?.folderId ?? ''}`} data-testid="folder-link">
      {children}
    </a>
  ),
}));

vi.mock('@/app/features/tasks/hooks/queries', () => ({
  useTask: () => ({
    task: {
      _id: 'task_1',
      organizationId: 'org_1',
      projectId: 'proj_1',
      externalId: 'folder_quarter',
      externalUrl: 'folder_setup',
    },
  }),
}));

vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: (
    _api: unknown,
    args: { folderId: string; organizationId: string },
  ) => ({
    data:
      args.folderId === 'folder_quarter'
        ? {
            _id: 'folder_quarter',
            name: 'SoftInstallQ1',
            projectId: 'proj_1',
          }
        : args.folderId === 'folder_setup'
          ? { _id: 'folder_setup', name: 'Setup', projectId: 'proj_1' }
          : null,
  }),
}));

describe('TaskInputRefs', () => {
  it('renders Knowledge folder links for externalId and externalUrl', () => {
    render(<TaskInputRefs taskId="task_1" />);

    expect(
      screen.getByText('automations.detail.subjectFolder'),
    ).toBeInTheDocument();
    expect(
      screen.getByText('automations.detail.relatedFolder'),
    ).toBeInTheDocument();
    expect(screen.getByText('SoftInstallQ1')).toBeInTheDocument();
    expect(screen.getByText('Setup')).toBeInTheDocument();

    const links = screen.getAllByTestId('folder-link');
    expect(links).toHaveLength(2);
    expect(links[0]).toHaveAttribute('href', '?folderId=folder_quarter');
    expect(links[1]).toHaveAttribute('href', '?folderId=folder_setup');
  });
});
