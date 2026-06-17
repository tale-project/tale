import { describe, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { SkipLink } from './skip-link';

describe('SkipLink', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<SkipLink />);
      await checkAccessibility(container);
    });
  });
});
