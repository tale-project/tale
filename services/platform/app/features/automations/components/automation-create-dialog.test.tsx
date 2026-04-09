// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { CreateAutomationDialog } from './automation-create-dialog';

vi.mock('@tanstack/react-router', () => ({
  useNavigate: () => vi.fn(),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('../hooks/file-mutations', () => ({
  useSaveWorkflow: () => ({ mutateAsync: vi.fn() }),
  useInvalidateWorkflows: () => vi.fn(),
  useInstallWorkflow: () => ({ mutateAsync: vi.fn() }),
}));

vi.mock('../hooks/file-queries', () => ({
  useListWorkflows: () => ({ workflows: [], isLoading: false }),
}));

describe('CreateAutomationDialog', () => {
  afterEach(cleanup);

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <CreateAutomationDialog
          open={true}
          onOpenChange={vi.fn()}
          organizationId="test-org-id"
        />,
      );
      await checkAccessibility(container);
    });
  });
});
