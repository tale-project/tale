import { describe, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { DotIcon } from './dot-icon';

describe('DotIcon', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(<DotIcon />);
      await checkAccessibility(container);
    });

    it('passes axe audit with custom className', async () => {
      const { container } = render(<DotIcon className="text-red-500" />);
      await checkAccessibility(container);
    });
  });
});
