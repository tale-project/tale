import { beforeAll, describe, expect, it } from 'vitest';

import { fireEvent, render, screen, within } from '@/tests/utils/render';

import { initServiceI18n } from '../../i18n/init-service';
import { uiMessages } from '../../i18n/messages';
import type { ResponsiveImage } from '../../images/responsive';
import { ImageZoom } from './image-zoom';

beforeAll(() => {
  // Same bootstrap the Storybook preview uses: resolve the package's own
  // `markdownImage` namespace instead of rendering raw key names.
  initServiceI18n({
    bundles: { en: {}, de: {}, fr: {} },
    regional: {},
    packages: [uiMessages],
  });
});

const SRC = 'https://example.com/screenshot.png';
const ALT = 'Chat screen with agent picker';
const SIZES = '(min-width: 48rem) 48rem, 100vw';
const IMAGE: ResponsiveImage = {
  width: 2880,
  height: 1800,
  variants: {
    avif: { 480: '/shot-480.avif', 1600: '/shot-1600.avif' },
    webp: { 480: '/shot-480.webp', 1600: '/shot-1600.webp' },
  },
};

describe('ImageZoom', () => {
  it('renders a lazy image inside a button trigger, no dialog mounted', () => {
    render(<ImageZoom src={SRC} alt={ALT} />);
    const trigger = screen.getByRole('button', { name: ALT });
    const img = screen.getByRole('img', { name: ALT });
    expect(trigger).toContainElement(img);
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('decoding', 'async');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('opens the lightbox on click with the alt as dialog title', async () => {
    const { user } = render(<ImageZoom src={SRC} alt={ALT} />);
    await user.click(screen.getByRole('button', { name: ALT }));
    const dialog = screen.getByRole('dialog', { name: ALT });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Close' })).toBeInTheDocument();
  });

  it('closes on Escape and restores focus to the trigger', async () => {
    const { user } = render(<ImageZoom src={SRC} alt={ALT} />);
    const trigger = screen.getByRole('button', { name: ALT });
    await user.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(trigger).toHaveFocus();
  });

  it('closes when the backdrop area around the image is clicked', async () => {
    const { user } = render(<ImageZoom src={SRC} alt={ALT} />);
    await user.click(screen.getByRole('button', { name: ALT }));
    // fireEvent, not userEvent: Radix marks the body pointer-events:none
    // while the modal is open, which userEvent refuses to click through.
    fireEvent.click(screen.getByRole('dialog'));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('falls back to the translated zoom label when alt is empty', () => {
    render(<ImageZoom src={SRC} />);
    expect(
      screen.getByRole('button', { name: 'Zoom image' }),
    ).toBeInTheDocument();
  });

  it('renders a plain image when no variants are given', () => {
    const { container } = render(<ImageZoom src={SRC} alt={ALT} />);
    expect(container.querySelector('picture')).toBeNull();
    const img = screen.getByRole('img', { name: ALT });
    expect(img).toHaveAttribute('src', SRC);
    for (const attribute of ['srcset', 'sizes', 'width', 'height']) {
      expect(img).not.toHaveAttribute(attribute);
    }
  });

  it('serves the variants in the trigger and the full-size file in the lightbox', async () => {
    const { container, user } = render(
      <ImageZoom src={SRC} alt={ALT} image={IMAGE} sizes={SIZES} />,
    );
    const trigger = screen.getByRole('button', { name: ALT });
    const img = screen.getByRole('img', { name: ALT });
    expect(trigger).toContainElement(img);
    expect(container.querySelector('picture > source')).toHaveAttribute(
      'srcset',
      '/shot-480.avif 480w, /shot-1600.avif 1600w',
    );
    expect(img).toHaveAttribute(
      'srcset',
      '/shot-480.webp 480w, /shot-1600.webp 1600w',
    );
    expect(img).toHaveAttribute('sizes', SIZES);
    expect(img).toHaveAttribute('width', '2880');
    expect(img).toHaveAttribute('height', '1800');
    expect(img).toHaveAttribute('src', SRC);
    expect(img).toHaveAttribute('loading', 'lazy');

    await user.click(trigger);
    const full = within(screen.getByRole('dialog')).getByRole('img', {
      name: ALT,
    });
    expect(full).toHaveAttribute('src', SRC);
    expect(full).not.toHaveAttribute('srcset');
  });

  it('opens the widest variant when the full-size file is not given', async () => {
    const { user } = render(<ImageZoom alt={ALT} image={IMAGE} />);
    expect(screen.getByRole('img', { name: ALT })).toHaveAttribute(
      'sizes',
      '100vw',
    );
    await user.click(screen.getByRole('button', { name: ALT }));
    expect(
      within(screen.getByRole('dialog')).getByRole('img', { name: ALT }),
    ).toHaveAttribute('src', '/shot-1600.webp');
  });
});
