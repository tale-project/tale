import { describe, it } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { WelcomeContentSkeleton } from '../welcome-content-skeleton';

describe('WelcomeContentSkeleton', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<WelcomeContentSkeleton />);
      await checkAccessibility(container);
    });
  });
});
