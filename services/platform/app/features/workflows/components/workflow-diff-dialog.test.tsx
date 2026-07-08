// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, vi } from 'vitest';

import type { WorkflowJsonConfig } from '@/lib/shared/schemas/workflows';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { WorkflowDiffDialog } from './workflow-diff-dialog';

const baseConfig: WorkflowJsonConfig = {
  name: 'Test Workflow',
  description: 'A test workflow',
  steps: [],
};

const candidateConfig: WorkflowJsonConfig = {
  name: 'Test Workflow',
  description: 'An updated version',
  steps: [],
};

describe('WorkflowDiffDialog', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <WorkflowDiffDialog
          open={true}
          onOpenChange={vi.fn()}
          currentConfig={baseConfig}
          candidateConfig={candidateConfig}
          title="Compare changes"
          description="Review differences before applying"
          confirmLabel="Apply"
          isConfirming={false}
          onConfirm={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
