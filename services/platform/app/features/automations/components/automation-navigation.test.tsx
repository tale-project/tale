// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render, waitFor } from '@/test/utils/render';

import { AutomationNavigation } from './automation-navigation';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    [key: string]: unknown;
  }) => <a {...props}>{children}</a>,
  useLocation: () => ({ pathname: '/dashboard/org-1/automations/am-1' }),
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

describe('AutomationNavigation', () => {
  afterEach(cleanup);

  describe('accessibility', () => {
    it('passes axe audit when automationId is provided', async () => {
      const { container } = render(
        <AutomationNavigation
          organizationId="org-1"
          automationId="am-1"
          workflowSlug="my-workflow"
          onRefetch={vi.fn()}
        />,
      );
      await waitFor(() => checkAccessibility(container));
    });

    it('passes axe audit when automationId is absent', async () => {
      const { container } = render(
        <AutomationNavigation
          organizationId="org-1"
          workflowSlug="my-workflow"
          onRefetch={vi.fn()}
        />,
      );
      await waitFor(() => checkAccessibility(container));
    });
  });
});
