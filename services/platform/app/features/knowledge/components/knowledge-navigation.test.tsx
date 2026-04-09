// @vitest-environment jsdom
import '@testing-library/jest-dom/vitest';
import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

vi.mock('@/lib/i18n/client', () => ({
  useT: (ns: string) => ({
    t: (key: string, params?: Record<string, string>) => {
      if (params) {
        return Object.entries(params).reduce(
          (acc, [k, v]) => acc.replace(`{${k}}`, v),
          `${ns}.${key}`,
        );
      }
      return `${ns}.${key}`;
    },
  }),
}));

vi.mock('@tanstack/react-router', () => ({
  Link: ({
    children,
    to,
  }: {
    children: React.ReactNode;
    to: string;
    [key: string]: unknown;
  }) => <a href={to}>{children}</a>,
  useLocation: () => ({ pathname: '/dashboard/test-org/documents' }),
}));

vi.mock('@/app/hooks/use-ability', () => ({
  useAbility: () => ({ can: () => true }),
}));

vi.mock('@/app/components/branding/branding-provider', () => ({
  useBrandingContext: () => ({ accentColor: undefined, isLoaded: true }),
}));

vi.mock('@/app/hooks/use-resize-observer', () => ({
  useResizeObserver: vi.fn(),
}));

import { KnowledgeNavigation } from './knowledge-navigation';

describe('KnowledgeNavigation', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <KnowledgeNavigation organizationId="test-org-id" />,
      );
      await checkAccessibility(container);
    });
  });
});
