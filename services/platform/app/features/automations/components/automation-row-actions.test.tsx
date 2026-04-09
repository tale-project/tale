// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { AutomationRowActions } from './automation-row-actions';

vi.mock('@tanstack/react-router', () => ({
  useParams: () => ({ id: 'org-123' }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('../hooks/file-mutations', () => ({
  useDuplicateWorkflowFile: () => ({ mutate: vi.fn() }),
  useDeleteWorkflowFile: () => ({ mutate: vi.fn(), isPending: false }),
  useToggleWorkflowEnabled: () => ({
    mutate: vi.fn(),
    isPending: false,
  }),
  useRenameWorkflow: () => ({ mutateAsync: vi.fn() }),
}));

describe('AutomationRowActions', () => {
  afterEach(cleanup);

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <AutomationRowActions
          automation={{
            _id: 'wf-1',
            name: 'Test Automation',
            status: 'active',
          }}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
