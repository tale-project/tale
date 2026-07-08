// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render, waitFor } from '@/tests/utils/render';

import { WorkflowNavigation } from './workflow-navigation';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    [key: string]: unknown;
  }) => <a {...props}>{children}</a>,
  useLocation: () => ({ pathname: '/dashboard/org-1/workflows/wf-1' }),
}));

vi.mock('@/app/hooks/use-convex-action', () => ({
  useConvexAction: () => ({
    mutateAsync: vi.fn(),
    isPending: false,
  }),
}));

vi.mock('@/app/hooks/use-format-date', () => ({
  useFormatDate: () => ({
    formatDate: () => 'April 1, 2026',
  }),
}));

vi.mock('@/app/hooks/use-toast', () => ({
  toast: vi.fn(),
}));

vi.mock('../triggers/hooks/queries', () => ({
  useWorkflowActivity: () => ({
    hasActiveTrigger: false,
    activeTriggers: 0,
    totalTriggers: 0,
    isLoading: false,
  }),
}));

vi.mock('../hooks/use-workflow-config-context', () => ({
  useWorkflowConfig: () => ({
    config: {
      name: 'Test Workflow',
      description: '',
      installed: true,
      enabled: true,
      steps: [],
    },
  }),
}));

describe('WorkflowNavigation', () => {
  describe('accessibility', () => {
    it('passes axe audit when workflowId is provided', async () => {
      const { container } = render(
        <WorkflowNavigation
          organizationId="org-1"
          workflowId="wf-1"
          workflowSlug="my-workflow"
          onRefetch={vi.fn()}
        />,
      );
      await waitFor(() => checkAccessibility(container));
    });

    it('passes axe audit when workflowId is absent', async () => {
      const { container } = render(
        <WorkflowNavigation
          organizationId="org-1"
          workflowSlug="my-workflow"
          onRefetch={vi.fn()}
        />,
      );
      await waitFor(() => checkAccessibility(container));
    });
  });
});
