import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it } from 'vitest';

import { deriveAccentPalette } from '@/lib/utils/color';
import { inkContrast, painted } from '@/tests/utils/paint';
import { cleanup, render, screen } from '@/tests/utils/render';

import { UploadFileRow } from './upload-file-row';

import '@/app/globals.css';

/**
 * An upload's progress bar is one of the marks the organization's accent
 * paints: the bar and the figure beside it wear the accent's text shade, as
 * the `ProgressBar` primitive does, and the figure reads 4.5:1 on the row
 * in either theme. They were a fixed blue no accent reached, and the figure
 * read 3.8:1 on the dark row.
 */

afterEach(() => {
  cleanup();
  document.documentElement.classList.remove('dark');
  document.documentElement.removeAttribute('style');
});

const FILE = {
  fileName: 'report.pdf',
  fileSize: 1_000_000,
  bytesTotal: 1_000_000,
};

describe.each(['#F5F5F0', '#0B0B2A', '#FF00FF'])(
  'upload progress with accent %s',
  (accent) => {
    it.each(['light', 'dark'] as const)(
      'wears the accent legibly in the %s theme',
      (theme) => {
        document.documentElement.classList.toggle('dark', theme === 'dark');
        const palette = deriveAccentPalette(accent, theme);
        document.documentElement.style.setProperty(
          '--primary',
          palette.textHsl,
        );
        render(
          <>
            <UploadFileRow {...FILE} status="uploading" bytesLoaded={400_000} />
            <UploadFileRow
              {...FILE}
              status="finalizing"
              bytesLoaded={1_000_000}
            />
          </>,
        );

        // The bar while bytes flow, and the pulsing one while the upload is
        // confirmed.
        const bars = screen.getAllByRole('progressbar');
        expect(bars).toHaveLength(2);
        for (const bar of bars) {
          const fill = getComputedStyle(bar.firstElementChild as Element);
          expect(fill.backgroundImage).toBe('none');
          expect(painted(fill.backgroundColor)).toBe(palette.text);
        }

        // The figure beside each: the percentage, then "Confirming upload…".
        for (const figure of [
          screen.getByText('40%'),
          screen.getByText('Confirming upload…'),
        ]) {
          expect(painted(getComputedStyle(figure).color)).toBe(palette.text);
          expect(inkContrast(figure)).toBeGreaterThanOrEqual(4.5);
        }
      },
    );
  },
);
