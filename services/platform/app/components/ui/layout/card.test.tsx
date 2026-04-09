import { describe, it } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { Card } from './card';

describe('Card', () => {
  describe('accessibility', () => {
    it('passes axe audit', async () => {
      const { container } = render(
        <Card title="Card Title" description="Card description">
          <p>Card content</p>
        </Card>,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with footer', async () => {
      const { container } = render(
        <Card title="Card Title" footer={<button type="button">Save</button>}>
          <p>Card content</p>
        </Card>,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit without header', async () => {
      const { container } = render(
        <Card>
          <p>Card content only</p>
        </Card>,
      );
      await checkAccessibility(container);
    });
  });
});
