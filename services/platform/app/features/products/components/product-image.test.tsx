import { describe, it } from 'vitest';

import { checkAccessibility } from '@/test/utils/a11y';
import { render } from '@/test/utils/render';

import { ProductImage } from './product-image';

describe('ProductImage', () => {
  describe('accessibility', () => {
    it('passes axe audit with no images', async () => {
      const { container } = render(
        <ProductImage images={[]} productName="Test Product" />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with a single image', async () => {
      const { container } = render(
        <ProductImage
          images={['https://example.com/image.jpg']}
          productName="Test Product"
        />,
      );
      await checkAccessibility(container);
    });

    it('passes axe audit with multiple images', async () => {
      const { container } = render(
        <ProductImage
          images={[
            'https://example.com/image1.jpg',
            'https://example.com/image2.jpg',
            'https://example.com/image3.jpg',
          ]}
          productName="Test Product"
        />,
      );
      await checkAccessibility(container);
    });
  });
});
