import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

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
