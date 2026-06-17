// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, vi } from 'vitest';

import type { WorkflowJsonConfig } from '@/lib/shared/schemas/workflows';
import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { AutomationHistoryDiffDialog } from './automation-history-diff-dialog';

vi.mock('@/app/hooks/use-format-date', () => ({
  useFormatDate: () => ({
    formatDate: () => 'April 1, 2026',
  }),
}));

const baseConfig: WorkflowJsonConfig = {
  name: 'Test Workflow',
  description: 'A test workflow',
  steps: [],
};

const snapshotConfig: WorkflowJsonConfig = {
  name: 'Test Workflow',
  description: 'An older version',
  steps: [],
};

describe('AutomationHistoryDiffDialog', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <AutomationHistoryDiffDialog
          open={true}
          onOpenChange={vi.fn()}
          currentConfig={baseConfig}
          snapshotConfig={snapshotConfig}
          snapshotDate="2026-04-01T00:00:00Z"
          isRestoring={false}
          onRestore={vi.fn()}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
