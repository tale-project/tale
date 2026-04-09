// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { DeleteAutomationDialog } from './automation-delete-dialog';

describe('DeleteAutomationDialog', () => {
  afterEach(cleanup);

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
