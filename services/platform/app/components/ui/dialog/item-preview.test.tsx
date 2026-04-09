import { describe, it } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { ItemPreview } from './item-preview';

describe('ItemPreview', () => {
  describe('accessibility', () => {
    it('passes axe audit with primary text only', async () => {
      const { container } = render(<ItemPreview primary="Customer Name" />);
      await checkAccessibility(container);
    });

    it('passes axe audit with primary and secondary text', async () => {
      const { container } = render(
        <ItemPreview
          primary="Customer Name"
          secondary="customer@example.com"
        />,
      );
      await checkAccessibility(container);
    });
  });
});
