import '@testing-library/jest-dom/vitest';
import { cleanup } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { userEvent } from 'vitest/browser';

import { deriveAccentPalette } from '@/lib/utils/color';
import { render, screen } from '@/tests/utils/render';

import { DictationButton } from './dictation-button';

import '@/app/globals.css';

// While it listens, the dictation button is a destructive (red) fill with an
// inset keyboard focus ring. Painting that ring in `--ring`, the accent's text
// shade, hid it for a red-family brand: `#DC2626` gives a ring of about
// 1.3:1 on the light fill and 1.5:1 on the dark. The ring takes the fill's
// ink instead. Only a real engine computes the painted ring.

vi.mock('../hooks/use-speech-to-text', () => ({
  useSpeechToText: () => ({
    isListening: true,
    isSupported: true,
    error: null,
    errorNonce: 0,
    startListening: vi.fn(),
    stopListening: vi.fn(),
  }),
}));
vi.mock('../hooks/use-media-recorder-dictation', () => ({
  useMediaRecorderDictation: () => ({
    isListening: false,
    isTranscribing: false,
    isSupported: false,
    error: null,
    startListening: vi.fn(),
    stopListening: vi.fn(),
    hasFailedRecording: false,
    retryTranscription: vi.fn(),
    discardFailedRecording: vi.fn(),
  }),
}));
vi.mock('../hooks/use-microphone-level', () => ({
  useMicrophoneLevel: () => 0,
}));
vi.mock('../utils/dictation-sounds', () => ({
  playDictationStartSound: vi.fn(),
  playDictationStopSound: vi.fn(),
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
  ['light', '#DC2626'],
  ['dark', '#DC2626'],
] as const)(
  'the listening dictation button in the %s theme, accent %s',
  (theme, accent) => {
    it('draws its focus ring in its ink, on the fill', async () => {
      document.documentElement.classList.toggle('dark', theme === 'dark');
      if (accent) {
        // As the branding provider paints it: `--ring` is the text shade.
        document.documentElement.style.setProperty(
          '--ring',
          deriveAccentPalette(accent, theme).textHsl,
        );
      }
      render(<DictationButton onTranscript={vi.fn()} />);
      const button = screen.getByRole('button', { name: 'Stop dictation' });

      // Reach it the way a keyboard user does, so `:focus-visible` holds.
      for (let tab = 0; tab < 5 && document.activeElement !== button; tab++) {
        await userEvent.keyboard('{Tab}');
      }
      expect(button).toHaveFocus();

      // The button eases its shadow in (`transition-all`): read the ring once
      // it has landed.
      const style = getComputedStyle(button);
      await expect.poll(() => focusRingColor(button)).toBe(style.color);
      expect(style.color).not.toBe(style.backgroundColor);
    });
  },
);
