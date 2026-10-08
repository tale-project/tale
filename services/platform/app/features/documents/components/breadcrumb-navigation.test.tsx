// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, waitFor } from '@/tests/utils/render';

const { queryResult } = vi.hoisted(() => ({
  queryResult: {
    data: [
      { _id: 'folder-1', name: 'Documents' },
      { _id: 'folder-2', name: 'Reports' },
    ] as { _id: string; name: string }[] | undefined,
    error: null as Error | null,
    failureCount: 0,
    isError: false,
    isFetching: false,
    isLoading: false,
    refetch: vi.fn(),
  },
}));

vi.mock('@tale/ui/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, string>) => {
      if (params) {
        return Object.entries(params).reduce(
          (acc, [k, v]) => acc.replace(`{${k}}`, v),
          `${ns}.${key}`,
        );
      }
      return `${ns}.${key}`;
    },
  }),
}));

vi.mock('@tale/ui/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => queryResult,
}));

import { toast } from '@tale/ui/use-toast';

import { BreadcrumbNavigation } from './breadcrumb-navigation';

beforeEach(() => {
  vi.clearAllMocks();
  queryResult.data = [
    { _id: 'folder-1', name: 'Documents' },
    { _id: 'folder-2', name: 'Reports' },
  ];
  queryResult.error = null;
  queryResult.failureCount = 0;
  queryResult.isError = false;
  queryResult.isFetching = false;
  queryResult.isLoading = false;
});

describe('BreadcrumbNavigation', () => {
  // A deleted folder's address answers no trail. The page leaves it for the
  // root in place of the dead entry, so Back does not walk into it again.
  it('leaves a folder that is gone for the root, replacing its address', () => {
    queryResult.data = [];
    const onNavigate = vi.fn();
    render(
      <BreadcrumbNavigation folderId="folder-gone" onNavigate={onNavigate} />,
    );

    expect(onNavigate).toHaveBeenCalledExactlyOnceWith(undefined, {
      replace: true,
    });
    expect(toast).toHaveBeenCalledWith({ title: 'documents.folderNotFound' });
  });

  it('stays on a folder whose trail is still loading', () => {
    queryResult.data = undefined;
    queryResult.isLoading = true;
    const onNavigate = vi.fn();
    render(
      <BreadcrumbNavigation folderId="folder-2" onNavigate={onNavigate} />,
    );

    expect(onNavigate).not.toHaveBeenCalled();
    expect(toast).not.toHaveBeenCalled();
  });

  it('stays on a folder with a trail', () => {
    const onNavigate = vi.fn();
    render(
      <BreadcrumbNavigation folderId="folder-2" onNavigate={onNavigate} />,
    );

    expect(onNavigate).not.toHaveBeenCalled();
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <BreadcrumbNavigation folderId="folder-2" onNavigate={vi.fn()} />,
      );
      await checkAccessibility(container);
    });
  });

  it('shows a retryable error without navigating away when the breadcrumb read fails', async () => {
    queryResult.data = undefined;
    queryResult.error = new Error('service unavailable');
    queryResult.failureCount = 1;
    queryResult.isError = true;

    const onNavigate = vi.fn();
    const view = render(
      <BreadcrumbNavigation folderId="folder-2" onNavigate={onNavigate} />,
    );

    expect(screen.getByRole('alert')).toHaveTextContent(
      'documents.breadcrumb.loadFailed',
    );
    expect(
      screen.getByRole('button', { name: 'common.actions.tryAgain' }),
    ).toBeInTheDocument();
    expect(
      screen.getByText('documents.breadcrumb.documents'),
    ).toBeInTheDocument();
    expect(screen.queryByText('Reports')).not.toBeInTheDocument();
    expect(onNavigate).not.toHaveBeenCalled();

    screen.getByRole('button', { name: 'common.actions.tryAgain' }).click();
    expect(queryResult.refetch).toHaveBeenCalledOnce();

    screen.getByRole('button', { name: 'common.actions.tryAgain' }).focus();
    queryResult.data = [{ _id: 'folder-2', name: 'Reports' }];
    queryResult.isError = false;
    view.rerender(
      <BreadcrumbNavigation folderId="folder-2" onNavigate={onNavigate} />,
    );
    await waitFor(() => expect(screen.getByRole('navigation')).toHaveFocus());
  });
});
