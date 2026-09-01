// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

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

// The component reads the active org via the route param; there is no router in
// this render, so stub the hook (active-org coherence scoping).
vi.mock('@/app/hooks/use-organization-id', () => ({
  useOrganizationId: () => 'org-1',
}));

vi.mock('@/app/hooks/use-backend-query', () => ({
  useBackendQuery: () => ({
    data: [
      { _id: 'folder-1', name: 'Documents' },
      { _id: 'folder-2', name: 'Reports' },
    ],
    isLoading: false,
  }),
}));

import { BreadcrumbNavigation } from './breadcrumb-navigation';

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
