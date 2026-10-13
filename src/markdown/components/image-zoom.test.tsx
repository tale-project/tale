import { beforeAll, describe, expect, it } from 'vitest';

import { fireEvent, render, screen } from '@/tests/utils/render';

import { initServiceI18n } from '../../i18n/init-service';
import { uiMessages } from '../../i18n/messages';
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
});
