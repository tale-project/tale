import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { GlobalErrorDisplay } from './global-error-display';

// Mock Sentry
vi.mock('@sentry/tanstackstart-react', () => ({
  captureException: vi.fn(),
}));

// Mock TanStack Router
vi.mock('@tanstack/react-router', () => ({
  useRouter: () => ({
    invalidate: vi.fn(),
  }),
}));

describe('GlobalErrorDisplay', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <GlobalErrorDisplay error={new Error('Test error')} reset={() => {}} />,
      );
      await checkAccessibility(container);
    });
  });
});
