import { MOBILE_QUERY } from '@tale/ui/use-is-mobile';
import { fireEvent, render, screen, within } from '@testing-library/react';
import { afterAll, describe, expect, it, vi } from 'vitest';

import { IMAGE_DIMENSIONS } from '@/app/content/image-dimensions';
import {
  DOCS_IMAGE_MAX_WIDTH,
  DOCS_IMAGE_SIZES,
  phoneCaptureFile,
} from '@/lib/content/image-variants';
import { pageImageTargets } from '@/tests/lib/image-refs';

import { DocsImage } from './docs-image';

// Served under a sub-path, as on tale.dev/docs: `DocsImage` reads the base
// once, when it loads.
vi.hoisted(() => {
  vi.stubEnv('BASE_URL', '/docs/');
});

// A shot with a phone capture, added to the generated registry so the test
// holds whichever captures are committed.
const SHOT = vi.hoisted(() => ({
  desktop: 'images/platform/example-shot.webp',
  phone: 'images/platform/example-shot.phone.webp',
}));
vi.mock('@/app/content/image-dimensions', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/app/content/image-dimensions')>();
  return {
    IMAGE_DIMENSIONS: {
      ...actual.IMAGE_DIMENSIONS,
      [SHOT.desktop]: [2880, 1800],
      [SHOT.phone]: [780, 1688],
    },
  };
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
      const avif = container.querySelector('picture > source:not([media])');
      const phoneSources = [
        ...container.querySelectorAll('picture > source[media]'),
      ];
      const urls = [
        ...candidates(img?.getAttribute('srcset')),
        ...candidates(avif?.getAttribute('srcset')),
        ...phoneSources.flatMap((source) =>
          candidates(source.getAttribute('srcset')),
        ),
      ];
      const size = IMAGE_DIMENSIONS[file];
      const phoneSize = IMAGE_DIMENSIONS[phoneCaptureFile(file)];
      const served =
        size !== undefined &&
        img?.getAttribute('src') === `/docs/${file}` &&
        img.getAttribute('width') === String(size[0]) &&
        img.getAttribute('height') === String(size[1]) &&
        img.getAttribute('sizes') === DOCS_IMAGE_SIZES &&
        img.getAttribute('loading') === 'lazy' &&
        avif?.getAttribute('type') === 'image/avif' &&
        avif.getAttribute('sizes') === DOCS_IMAGE_SIZES &&
        phoneSources.length === (phoneSize ? 2 : 0) &&
        phoneSources.every(
          (source) =>
            source.getAttribute('media') === MOBILE_QUERY &&
            source.getAttribute('sizes') === DOCS_IMAGE_SIZES &&
            source.getAttribute('width') === String(phoneSize?.[0]) &&
            source.getAttribute('height') === String(phoneSize?.[1]),
        ) &&
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

  it('serves the phone capture of a shot below the md breakpoint, in the page and the lightbox', () => {
    const { container } = render(
      <DocsImage src={`/${SHOT.desktop}`} alt="Screenshot" />,
    );
    const sources = [...container.querySelectorAll('picture > source')].map(
      (source) => ({
        media: source.getAttribute('media'),
        type: source.getAttribute('type'),
        srcSet: source.getAttribute('srcset'),
        width: source.getAttribute('width'),
        height: source.getAttribute('height'),
      }),
    );
    // The phone layout first, so it wins wherever Tale shows it; the
    // desktop capture stays the default, as for a shot without one.
    expect(sources).toEqual([
      {
        media: MOBILE_QUERY,
        type: 'image/avif',
        srcSet:
          '/docs/images/optimized/platform/example-shot.phone-480.avif 480w, /docs/images/optimized/platform/example-shot.phone-780.avif 780w',
        width: '780',
        height: '1688',
      },
      {
        media: MOBILE_QUERY,
        type: 'image/webp',
        srcSet:
          '/docs/images/optimized/platform/example-shot.phone-480.webp 480w, /docs/images/platform/example-shot.phone.webp 780w',
        width: '780',
        height: '1688',
      },
      {
        media: null,
        type: 'image/avif',
        srcSet: expect.stringContaining(
          '/docs/images/optimized/platform/example-shot-1600.avif 1600w',
        ),
        width: null,
        height: null,
      },
    ]);
    expect(screen.getByRole('img', { name: 'Screenshot' })).toHaveAttribute(
      'src',
      `/docs/${SHOT.desktop}`,
    );

    // The lightbox opens the full-size file of the capture the page shows.
    fireEvent.click(screen.getByRole('button'));
    const dialog = screen.getByRole('dialog');
    const phoneFull = dialog.querySelector('picture > source');
    expect(phoneFull).toHaveAttribute('media', MOBILE_QUERY);
    expect(phoneFull).toHaveAttribute('srcset', `/docs/${SHOT.phone}`);
    expect(
      within(dialog).getByRole('img', { name: 'Screenshot' }),
    ).toHaveAttribute('src', `/docs/${SHOT.desktop}`);
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
