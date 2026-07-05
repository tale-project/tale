// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { AutomationsTable } from './automations-table';

interface MockWorkflow {
  slug: string;
  name: string;
  description?: string;
  stepCount: number;
  hash: string;
  createdAtMs?: number;
}

const mockWorkflows: { current: MockWorkflow[] } = {
  current: [
    {
      slug: 'my-workflow',
      name: 'My Workflow',
      description: 'A test workflow',
      stepCount: 3,
      hash: 'abc123',
      createdAtMs: 1709856000000,
    },
  ],
};

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: 'test-org-id' }),
  Link: ({
    children,
    className,
    to,
  }: {
    children?: React.ReactNode;
    className?: string;
    to?: string;
    params?: Record<string, string>;
  }) => (
    <a className={className} href={to ?? '#'}>
      {children}
    </a>
  ),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('@/app/components/catalog/use-catalog-sync', () => ({
  useCatalogSync: () => ({ menuItem: null, dialog: null }),
}));

vi.mock('../hooks/file-queries', () => ({
  useListWorkflows: () => ({
    workflows: mockWorkflows.current,
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

vi.mock('../hooks/file-mutations', () => ({
  useDuplicateWorkflowFile: () => ({ mutate: vi.fn() }),
  useDeleteWorkflowFile: () => ({ mutate: vi.fn(), isPending: false }),
  useRenameWorkflow: () => ({ mutateAsync: vi.fn() }),
  useSaveWorkflow: () => ({ mutateAsync: vi.fn() }),
  useInvalidateWorkflows: () => vi.fn(),
  useInstallWorkflow: () => ({ mutateAsync: vi.fn() }),
}));

describe('AutomationsTable', () => {
  beforeEach(() => {
    mockWorkflows.current = [
      {
        slug: 'my-workflow',
        name: 'My Workflow',
        description: 'A test workflow',
        stepCount: 3,
        hash: 'abc123',
        createdAtMs: 1709856000000,
      },
    ];
  });

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <AutomationsTable organizationId="test-org-id" />,
      );
      await checkAccessibility(container, {
        rules: {
          // Actions column intentionally has no header text
          'empty-table-header': { enabled: false },
        },
      });
    });
  });

  describe('count footer', () => {
    // Regression for #2094: a folder collapses its child workflows into one
    // row, so the footer must not count those hidden children against the
    // visible folder rows ("Showing 1 of 15 automations").
    it('counts visible rows, not grouped child workflows, in the folder view', () => {
      mockWorkflows.current = Array.from({ length: 15 }, (_, i) => ({
        slug: `projects/workflow-${i}`,
        name: `Workflow ${i}`,
        stepCount: 1,
        hash: `hash-${i}`,
      }));

      render(<AutomationsTable organizationId="test-org-id" />);

      // One folder row ("projects") stands in for all 15 child workflows.
      expect(screen.getByText('Showing all 1 automations')).toBeInTheDocument();
      expect(
        screen.queryByText('Showing 1 of 15 automations'),
      ).not.toBeInTheDocument();
    });

    it('reports all rows when nothing is grouped', () => {
      mockWorkflows.current = [
        { slug: 'alpha', name: 'Alpha', stepCount: 1, hash: 'a' },
        { slug: 'beta', name: 'Beta', stepCount: 1, hash: 'b' },
      ];

      render(<AutomationsTable organizationId="test-org-id" />);

      expect(screen.getByText('Showing all 2 automations')).toBeInTheDocument();
    });
  });
});
