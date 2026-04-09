// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { AutomationsListNavigation } from './automations-list-navigation';

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    ...props
  }: {
    children: React.ReactNode;
    [key: string]: unknown;
  }) => <a {...props}>{children}</a>,
  useLocation: () => ({ pathname: '/dashboard/org-1/automations' }),
}));

describe('AutomationsListNavigation', () => {
  afterEach(cleanup);

  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <AutomationsListNavigation organizationId="test-org-id" />,
      );
      await checkAccessibility(container);
    });
  });
});
