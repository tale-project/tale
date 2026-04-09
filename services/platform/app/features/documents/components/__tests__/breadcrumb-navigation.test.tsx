// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

vi.mock('@/lib/i18n/client', () => ({
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

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/convex/lib/type_cast_helpers', () => ({
  toId: (id: string) => id,
}));

vi.mock('@/app/hooks/use-convex-query', () => ({
  useConvexQuery: () => ({
    data: [
      { _id: 'folder-1', name: 'Documents' },
      { _id: 'folder-2', name: 'Reports' },
    ],
    isLoading: false,
  }),
}));

vi.mock('@/convex/_generated/api', () => ({
  api: {
    folders: {
      queries: {
        getFolderBreadcrumb: 'getFolderBreadcrumb',
      },
    },
  },
}));

import { BreadcrumbNavigation } from '../breadcrumb-navigation';

describe('BreadcrumbNavigation', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <BreadcrumbNavigation folderId="folder-2" onNavigate={vi.fn()} />,
      );
      await checkAccessibility(container);
    });
  });
});
