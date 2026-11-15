import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

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

  describe('variants', () => {
    const managed =
      '/api/app/products/images/05b12345-1020-4000-8000-123456789abc?orgId=org-1';

    it('serves the list cell and each hover-card image their variant', () => {
      const { container } = render(
        <ProductImage images={[managed, managed]} productName="Test Product" />,
      );
      const sources = Array.from(container.querySelectorAll('img')).map((img) =>
        img.getAttribute('src'),
      );
      expect(sources[0]).toBe(`${managed}&variant=list`);
      expect(sources.slice(1)).toEqual([
        `${managed}&variant=card`,
        `${managed}&variant=card`,
      ]);
    });

    it('serves the original when variants are off', () => {
      const { container } = render(
        <ProductImage
          images={[managed]}
          productName="Test Product"
          variants={false}
        />,
      );
      expect(container.querySelector('img')?.getAttribute('src')).toBe(managed);
    });
  });
});
