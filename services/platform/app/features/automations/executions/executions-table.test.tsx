// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { ExecutionsTable } from './executions-table';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: 'test-org-id' }),
}));

vi.mock('@/app/hooks/use-locale', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/hooks/use-locale')>()),
  useLocale: () => ({ locale: 'en-US' }),
}));

vi.mock('../hooks/queries', () => ({
  useApproxExecutionCount: () => ({ data: 0 }),
  useExecutionJournal: () => ({ data: [], error: null }),
  useListExecutions: () => ({
    results: [],
    status: 'Exhausted',
    loadMore: vi.fn(),
    isLoading: false,
  }),
  useSearchExecution: () => ({ data: undefined }),
}));

vi.mock('@/app/hooks/use-list-page', () => ({
  useListPage: () => ({
    tableProps: {
      data: [],
      search: { value: '', onChange: vi.fn(), placeholder: 'Search...' },
      filters: [],
      onClearFilters: vi.fn(),
    },
  }),
}));

describe('ExecutionsTable', () => {
  afterEach(cleanup);

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <ExecutionsTable amId="am-1" organizationId="test-org-id" />,
      );
      await checkAccessibility(container, {
        rules: {
          // Expand-row column intentionally has no header text
          'empty-table-header': { enabled: false },
        },
      });
    });
  });
});
