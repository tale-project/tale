import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { IMAGE_DIMENSIONS } from '@/app/content/image-dimensions';
import {
  DOCS_IMAGE_MAX_WIDTH,
  DOCS_IMAGE_SIZES,
} from '@/lib/content/image-variants';
import { pageImageTargets } from '@/tests/lib/image-refs';

import { DocsImage } from './docs-image';

// Served under a sub-path, as on tale.dev/docs: `DocsImage` reads the base
// once, when it loads.
vi.hoisted(() => {
  vi.stubEnv('BASE_URL', '/docs/');
});

const PAGE_IMAGES = [...pageImageTargets()]
  .filter((file) => file.endsWith('.webp'))
  .sort();

/** The URLs of a `srcset` value, without their width descriptors. */
function candidates(srcSet: string | null | undefined): string[] {
  if (!srcSet) return [];
  return srcSet.split(', ').map((candidate) => candidate.split(' ')[0]);
}

/**
 * A docs screenshot is served at the width its column needs — AVIF where the
 * browser decodes it, WebP otherwise — with its intrinsic size on the `<img>`,
 * so a phone fetches a phone-sized file and the layout is reserved before the
 * image arrives. The original stays the full-size file the lightbox opens.
 */
describe('DocsImage', () => {
  afterAll(() => {
    vi.unstubAllEnvs();
  });

  it('serves every image a page shows responsively, under the base', () => {
    expect(PAGE_IMAGES.length).toBeGreaterThan(0);
    const unserved: string[] = [];
    for (const file of PAGE_IMAGES) {
      const { container, unmount } = render(
        <DocsImage src={`/${file}`} alt="Screenshot" />,
      );
      const img = container.querySelector('picture > img');
      const avif = container.querySelector('picture > source');
      const urls = [
        ...candidates(img?.getAttribute('srcset')),
        ...candidates(avif?.getAttribute('srcset')),
      ];
      const size = IMAGE_DIMENSIONS[file];
      const served =
        size !== undefined &&
        img?.getAttribute('src') === `/docs/${file}` &&
        img.getAttribute('width') === String(size[0]) &&
        img.getAttribute('height') === String(size[1]) &&
        img.getAttribute('sizes') === DOCS_IMAGE_SIZES &&
        img.getAttribute('loading') === 'lazy' &&
        avif?.getAttribute('type') === 'image/avif' &&
        avif.getAttribute('sizes') === DOCS_IMAGE_SIZES &&
        urls.length > 0 &&
        urls.every((url) => url.startsWith('/docs/images/'));
      if (!served) unserved.push(file);
      unmount();
    }
    expect(unserved).toEqual([]);
  });

  it('never offers a capture wider than the column, but zooms into it', () => {
    const file = PAGE_IMAGES.find(
      (image) => (IMAGE_DIMENSIONS[image]?.[0] ?? 0) > DOCS_IMAGE_MAX_WIDTH,
    );
    expect(file).toBeDefined();
    render(<DocsImage src={`/${file}`} alt="Screenshot" />);
    const img = screen.getByRole('img', { name: 'Screenshot' });
    expect(candidates(img.getAttribute('srcset'))).not.toContain(
      `/docs/${file}`,
    );
    fireEvent.click(screen.getByRole('button'));
    expect(
      within(screen.getByRole('dialog')).getByRole('img', {
        name: 'Screenshot',
      }),
    ).toHaveAttribute('src', `/docs/${file}`);
  });

  it('renders an image without variants as a plain lazy image', () => {
    const { container } = render(
      <DocsImage src="https://example.com/diagram.png" alt="Diagram" />,
    );
    expect(container.querySelector('picture')).toBeNull();
    const img = screen.getByRole('img', { name: 'Diagram' });
    expect(img).toHaveAttribute('src', 'https://example.com/diagram.png');
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).not.toHaveAttribute('srcset');
  });
});
