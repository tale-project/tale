import { describe, it } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { Tooltip } from './tooltip';

describe('Tooltip', () => {
  describe('accessibility', () => {
    it('passes axe audit with trigger visible', async () => {
      const { container } = render(
        <Tooltip content="Helpful tip">
          <button>Hover me</button>
        </Tooltip>,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit when content is empty (renders children only)', async () => {
      const { container } = render(
        <Tooltip content="">
          <button>No tooltip</button>
        </Tooltip>,
      );
      await checkAccessibility(container);
    });
  });
});
