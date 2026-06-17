// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { AutomationsTable } from './automations-table';

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

vi.mock('../hooks/file-queries', () => ({
  useListWorkflows: () => ({
    workflows: [
      {
        slug: 'my-workflow',
        name: 'My Workflow',
        description: 'A test workflow',
        stepCount: 3,
        hash: 'abc123',
        createdAtMs: 1709856000000,
      },
    ],
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
});
