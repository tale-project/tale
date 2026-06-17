// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { DeleteAutomationDialog } from './automation-delete-dialog';

describe('DeleteAutomationDialog', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <DeleteAutomationDialog
          open={true}
          onOpenChange={vi.fn()}
          onConfirm={vi.fn()}
          workflowName="Test Workflow"
        />,
      );
      await checkAccessibility(container);
    });
  });
});
