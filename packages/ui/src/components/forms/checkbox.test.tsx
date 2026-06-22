import { describe, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { Checkbox } from './checkbox';
import { Label } from './label';

describe('Checkbox', () => {
  describe('accessibility', () => {
    it('passes axe audit with an aria-label', async () => {
      const { container } = render(<Checkbox aria-label="Accept terms" />);
      await checkAccessibility(container);
    });

    it('passes axe audit when paired with a Label', async () => {
      const { container } = render(
        <div className="flex items-center gap-2">
          <Checkbox id="terms" />
          <Label htmlFor="terms">Accept terms</Label>
        </div>,
      );
      await checkAccessibility(container);
    });
  });
});
