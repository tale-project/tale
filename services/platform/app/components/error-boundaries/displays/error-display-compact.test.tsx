import { describe, it, vi } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { ErrorDisplayCompact } from './error-display-compact';

// Mock the error logger hook
vi.mock('../hooks/use-error-logger', () => ({
  useErrorLogger: () => vi.fn(),
}));

describe('ErrorDisplayCompact', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <ErrorDisplayCompact
          error={new Error('Test error')}
          reset={() => {}}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
