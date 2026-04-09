import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { PageLayout } from './page-layout';

// Mock LayoutErrorBoundary since it depends on TanStack Router
vi.mock('../error-boundaries/boundaries/layout-error-boundary', () => ({
  LayoutErrorBoundary: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
}));

describe('PageLayout', () => {
  describe('accessibility', () => {
    it('passes axe audit without header', async () => {
      const { container } = render(
        <PageLayout>
          <p>Page content</p>
        </PageLayout>,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with header', async () => {
      const { container } = render(
        <PageLayout header={<h1>Page Title</h1>}>
          <p>Page content</p>
        </PageLayout>,
      );
      await checkAccessibility(container);
    });
  });
});
