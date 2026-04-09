// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { AutomationsTable } from './automations-table';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
  useParams: () => ({ id: 'test-org-id' }),
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
        enabled: true,
        version: '1.0',
        stepCount: 3,
        hash: 'abc123',
      },
    ],
    isLoading: false,
    refetch: vi.fn(),
  }),
}));

vi.mock('../hooks/file-mutations', () => ({
  useDuplicateWorkflowFile: () => ({ mutate: vi.fn() }),
  useDeleteWorkflowFile: () => ({ mutate: vi.fn(), isPending: false }),
  useToggleWorkflowEnabled: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useRenameWorkflow: () => ({ mutateAsync: vi.fn() }),
  useSaveWorkflow: () => ({ mutateAsync: vi.fn() }),
  useInvalidateWorkflows: () => vi.fn(),
  useInstallWorkflow: () => ({ mutateAsync: vi.fn() }),
}));

describe('AutomationsTable', () => {
  afterEach(cleanup);

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
