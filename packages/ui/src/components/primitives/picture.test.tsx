import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { checkAccessibility } from '@/tests/utils/a11y';
import { render } from '@/tests/utils/render';

import type { ResponsiveImage } from '../../images/responsive';
import { Picture } from './picture';

function ladder(name: string, width: number, height: number): ResponsiveImage {
  const variants = (format: string) => ({
    480: `/${name}-480.${format}`,
    [width]: `/${name}-${width}.${format}`,
  });
  return {
    width,
    height,
    variants: { avif: variants('avif'), webp: variants('webp') },
  };
}

const DESKTOP = ladder('desktop', 1600, 1000);
const PHONE = ladder('phone', 750, 1310);
const SIZES = '(min-width: 48rem) 48rem, 100vw';

describe('Picture', () => {
  it('offers AVIF first and falls back to the WebP image with its size', () => {
    const { container } = render(
      <Picture image={DESKTOP} sizes={SIZES} alt="Inbox" className="w-full" />,
    );
    const source = container.querySelector('picture > source');
    expect(source).toHaveAttribute('type', 'image/avif');
    expect(source).toHaveAttribute(
      'srcset',
      '/desktop-480.avif 480w, /desktop-1600.avif 1600w',
    );
    expect(source).toHaveAttribute('sizes', SIZES);
    const img = container.querySelector('picture > img');
    expect(img).toHaveAttribute(
      'srcset',
      '/desktop-480.webp 480w, /desktop-1600.webp 1600w',
    );
    expect(img).toHaveAttribute('sizes', SIZES);
    expect(img).toHaveAttribute('width', '1600');
    expect(img).toHaveAttribute('height', '1000');
    expect(img).toHaveAttribute('src', '/desktop-1600.webp');
    expect(img).toHaveAttribute('alt', 'Inbox');
    expect(img).toHaveClass('w-full');
  });

  it('keeps an explicit src, such as a full-size original', () => {
    const { container } = render(
      <Picture image={DESKTOP} sizes={SIZES} src="/original.webp" alt="" />,
    );
    expect(container.querySelector('img')).toHaveAttribute(
      'src',
      '/original.webp',
    );
  });

  it('puts art-directed sources first, each with its own size', () => {
    const html = renderToStaticMarkup(
      <Picture
        image={DESKTOP}
        sources={[{ media: '(max-width: 639px)', image: PHONE }]}
        sizes={SIZES}
        alt="Inbox"
        loading="eager"
      />,
    );
    expect(html).toBe(
      '<picture>' +
        `<source media="(max-width: 639px)" type="image/avif" srcSet="/phone-480.avif 480w, /phone-750.avif 750w" sizes="${SIZES}" width="750" height="1310"/>` +
        `<source media="(max-width: 639px)" type="image/webp" srcSet="/phone-480.webp 480w, /phone-750.webp 750w" sizes="${SIZES}" width="750" height="1310"/>` +
        `<source type="image/avif" srcSet="/desktop-480.avif 480w, /desktop-1600.avif 1600w" sizes="${SIZES}"/>` +
        `<img src="/desktop-1600.webp" srcSet="/desktop-480.webp 480w, /desktop-1600.webp 1600w" sizes="${SIZES}" width="1600" height="1000" alt="Inbox" loading="eager"/>` +
        '</picture>',
    );
  });

  it('passes axe audit', async () => {
    const { container } = render(
      <Picture image={DESKTOP} sizes={SIZES} alt="Inbox with two threads" />,
    );
    await checkAccessibility(container);
  });
});
