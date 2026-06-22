import { describe, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { Slider } from './slider';

describe('Slider', () => {
  describe('accessibility', () => {
    it('passes axe audit with an accessible name', async () => {
      const { container } = render(
        <Slider
          aria-label="Temperature"
          value={40}
          min={0}
          max={100}
          onChange={() => {}}
        />,
      );
      await checkAccessibility(container);
    });
  });
});
