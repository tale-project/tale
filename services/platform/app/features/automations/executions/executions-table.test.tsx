// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import type { ReactNode } from 'react';
import { describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, screen, within } from '@/tests/utils/render';

import { ExecutionsTable } from './executions-table';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: 'test-org-id' }),
  // Render a real anchor so the row action stays a keyboard-reachable link and
  // its `to`/`params`/`search` are assertable (the canvas deep link, #2347).
  Link: ({
    to,
    params,
    search,
    children,
    ...props
  }: {
    to: string;
    params?: unknown;
    search?: unknown;
    children?: ReactNode;
  }) => (
    <a
      href={to}
      data-params={JSON.stringify(params)}
      data-search={JSON.stringify(search)}
      {...props}
    >
      {children}
    </a>
  ),
}));

vi.mock('@tale/ui/i18n/locale-provider', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@tale/ui/i18n/locale-provider')>()),
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

// The page reads its rows through `useListPage`. The default is an empty table;
// individual tests reassign `mockTableData` to a stable array to drive the
// status column. Keep the reference stable across re-renders (a fresh array per
// render would retrigger the table's row-diff effect).
let mockTableData: unknown[] = [];
vi.mock('@/app/hooks/use-list-page', () => ({
  useListPage: () => ({
    tableProps: {
      data: mockTableData,
      search: { value: '', onChange: vi.fn(), placeholder: 'Search...' },
      filters: [],
      onClearFilters: vi.fn(),
    },
  }),
}));

// Minimal `Doc<'wfExecutions'>` shape the columns read.
function executionRow(id: string, status: string) {
  return {
    _id: id,
    _creationTime: 0,
    status,
    startedAt: 1_700_000_000_000,
    completedAt: 1_700_000_001_000,
    triggeredBy: 'manual',
  };
}

describe('ExecutionsTable', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      mockTableData = [];
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

  // Regression for #2052 [93]: the status badge used to render the raw backend
  // enum (e.g. `completed`, `waiting_for_input`) instead of the localized
  // label. The cell now maps snake_case statuses to the camelCase
  // `common.status.*` keys and falls back to the raw value for unknown statuses.
  describe('status badge localization', () => {
    it('renders localized labels and falls back to the raw value', () => {
      mockTableData = [
        executionRow('exec-completed', 'completed'),
        executionRow('exec-waiting', 'waiting_for_input'),
        executionRow('exec-paused', 'paused_debug'),
        executionRow('exec-unknown', 'mystery_state'),
      ];

      render(<ExecutionsTable amId="am-1" organizationId="test-org-id" />);

      const table = screen.getByRole('table');
      // Base status -> translated label.
      expect(within(table).getByText('Completed')).toBeInTheDocument();
      // snake_case -> camelCase key -> translated label.
      expect(within(table).getByText('Waiting for input')).toBeInTheDocument();
      expect(within(table).getByText('Paused (debug)')).toBeInTheDocument();
      // Unknown status has no key -> raw value rendered, no key leak.
      expect(within(table).getByText('mystery_state')).toBeInTheDocument();
      expect(
        within(table).queryByText('status.mysteryState'),
      ).not.toBeInTheDocument();
    });
  });

  // Regression for #2347: the Executions tab only expanded inline JSON, with no
  // path to the canvas run view. Each row now exposes a labelled "View on
  // canvas" link that deep-links to `/automations/$amId?execution={runId}`,
  // reusing the same `execution` param the tester panel writes.
  describe('canvas run link', () => {
    it('links each row to the canvas with its execution id', () => {
      mockTableData = [
        executionRow('exec-a', 'completed'),
        executionRow('exec-b', 'failed'),
      ];

      render(<ExecutionsTable amId="am-1" organizationId="test-org-id" />);

      const links = screen.getAllByRole('link', { name: 'View on canvas' });
      expect(links).toHaveLength(2);
      expect(links[0]).toHaveAttribute(
        'href',
        '/dashboard/$id/automations/$amId',
      );
      expect(links[0]).toHaveAttribute(
        'data-search',
        JSON.stringify({ execution: 'exec-a' }),
      );
      expect(links[0]).toHaveAttribute(
        'data-params',
        JSON.stringify({ id: 'test-org-id', amId: 'am-1' }),
      );
    });
  });
});
