import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import { deriveAccentPalette } from '@/lib/utils/color';
import { render, screen } from '@/tests/utils/render';

import { Composer } from './composer';

import '@/app/globals.css';

// The Stop button takes the send button's slot while a reply generates. It is
// a primary button, so its keyboard focus ring is drawn inside the fill in
// the fill's ink. Overriding it with `focus-visible:ring-ring` painted
// `--ring` there instead: near-black on the near-black default fill, and the
// accent's text shade on a branded fill. Only a real engine computes the
// painted ring.

vi.mock('../hooks/use-speech-to-text', () => ({
  useSpeechToText: () => ({
    isListening: false,
    isSupported: false,
    error: null,
    startListening: vi.fn(),
    stopListening: vi.fn(),
  }),
}));
vi.mock('../hooks/use-microphone-level', () => ({
  useMicrophoneLevel: () => 0,
}));
vi.mock('@/app/features/shared/files/use-file-url', () => ({
  useFileUrl: () => ({ data: null }),
  useFileUrls: () => ({ data: [] }),
}));

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute('style');
  document.documentElement.classList.remove('dark');
});

/** The colour of the keyboard focus ring: the layer drawn 2px deep inside. */
function focusRingColor(el: HTMLElement): string | undefined {
  const ring = getComputedStyle(el)
    .boxShadow.split(/,(?![^(]*\))/)
    .map((layer) => layer.trim())
    .find((layer) => layer.endsWith('0px 0px 0px 2px inset'));
  return ring?.replace(' 0px 0px 0px 2px inset', '');
}

describe.each([
  ['light', undefined],
  ['dark', undefined],
  // `#FF00FF` fills the button in both themes. Its text shade, `--ring`, is
  // `#a300a3` on the light theme and the pick itself on the dark, where a
  // ring in `--ring` is exactly the fill.
  ['light', '#FF00FF'],
  ['dark', '#FF00FF'],
] as const)('the Stop button in the %s theme, accent %s', (theme, accent) => {
  it('draws its focus ring in its ink, on the fill', async () => {
    document.documentElement.classList.toggle('dark', theme === 'dark');
    if (accent) {
      // As the branding provider paints it.
      const palette = deriveAccentPalette(accent, theme);
      const root = document.documentElement.style;
      root.setProperty('--color-accent-base', palette.base);
      root.setProperty('--color-accent-fg', palette.fg);
      root.setProperty('--ring', palette.textHsl);
    }
    render(
      <Composer
        draftKey="composer-stop-browser-test"
        models={[]}
        selection={{}}
        onSelectionChange={vi.fn()}
        onSend={vi.fn()}
        onStop={vi.fn()}
        generating
        transcriptionAvailable={false}
        transcriptionUnavailableReason="NO_TRANSCRIPTION_MODEL"
      />,
    );
    const stop = screen.getByRole('button', { name: 'Stop generating' });

    // Reach it the way a keyboard user does, so `:focus-visible` holds.
    for (let tab = 0; tab < 20 && document.activeElement !== stop; tab++) {
      await userEvent.keyboard('{Tab}');
    }
    expect(stop).toHaveFocus();

    // The button eases its shadow in (`transition-all`): read the ring once
    // it has landed.
    const style = getComputedStyle(stop);
    await expect.poll(() => focusRingColor(stop)).toBe(style.color);
    expect(style.color).not.toBe(style.backgroundColor);
  });
});
