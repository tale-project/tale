import { describe, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import { Separator } from './separator';

describe('Separator', () => {
  describe('accessibility', () => {
    it('passes axe audit with horizontal orientation', async () => {
      const { container } = render(<Separator orientation="horizontal" />);
      await checkAccessibility(container);
    });

    it('passes axe audit with vertical orientation', async () => {
      const { container } = render(
        <div style={{ height: 50 }}>
          <Separator orientation="vertical" />
        </div>,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit as non-decorative', async () => {
      const { container } = render(<Separator decorative={false} />);
      await checkAccessibility(container);
    });
  });
});
