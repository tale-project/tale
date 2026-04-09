import { describe, it } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { SkipLink } from './skip-link';

describe('SkipLink', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<SkipLink />);
      await checkAccessibility(container);
    });
  });
});
