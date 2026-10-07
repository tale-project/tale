// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

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

// The component reads the active org via the route param; there is no router in
// this render, so stub the hook (active-org coherence scoping).
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

const TRAIL = [
  { _id: 'folder-1', name: 'Documents' },
  { _id: 'folder-2', name: 'Reports' },
];

const { breadcrumbRead } = vi.hoisted(() => ({
  breadcrumbRead: {
    current: { data: undefined as unknown, isLoading: false },
  },
}));

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => breadcrumbRead.current,
}));

import { toast } from '@tale/ui/use-toast';

import { BreadcrumbNavigation } from './breadcrumb-navigation';

beforeEach(() => {
  vi.clearAllMocks();
  breadcrumbRead.current = { data: TRAIL, isLoading: false };
});

describe('BreadcrumbNavigation', () => {
  // A deleted folder's address answers no trail. The page leaves it for the
  // root in place of the dead entry, so Back does not walk into it again.
  it('leaves a folder that is gone for the root, replacing its address', () => {
    breadcrumbRead.current = { data: [], isLoading: false };
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
    breadcrumbRead.current = { data: undefined, isLoading: true };
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
});
