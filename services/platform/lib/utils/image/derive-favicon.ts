/**
 * Derive a favicon from an uploaded logo, client-side.
 *
 * When an admin uploads a logo and no favicon is set yet, we generate a
 * square favicon from the same image rather than make them upload a second
 * asset. The work happens in the browser (a canvas draw) so the existing
 * `saveImage` upload path is reused unchanged — the result is just another
 * image to store.
 */

const DEFAULT_FAVICON_SIZE = 64;

/** The favicon image-type slots the branding store can hold. */
interface FaviconState {
  faviconLightFilename?: string;
  faviconDarkFilename?: string;
  faviconLightUrl?: string | null;
  faviconDarkUrl?: string | null;
}

/**
 * Whether a favicon should be auto-derived from a freshly uploaded logo.
 * True only when no favicon exists in any slot — an explicit favicon, light
 * or dark, always wins over the derived one.
 */
export function shouldDeriveFavicon(state: FaviconState): boolean {
  return (
    !state.faviconLightFilename &&
    !state.faviconDarkFilename &&
    !state.faviconLightUrl &&
    !state.faviconDarkUrl
  );
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.addEventListener('load', () => resolve(img), { once: true });
    img.addEventListener(
      'error',
      () =>
        reject(new Error('Failed to load logo image for favicon derivation')),
      { once: true },
    );
    img.src = src;
  });
}

/**
 * Render `file` into a transparent `size`×`size` PNG, scaled to fit (contain)
 * and centered, and return the base64 payload (no `data:` prefix) ready for
 * the `saveImage` action. Rejects if the image can't be decoded or the canvas
 * 2D context is unavailable.
 */
export async function deriveFaviconPngBase64(
  file: File,
  size = DEFAULT_FAVICON_SIZE,
): Promise<string> {
  const objectUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(objectUrl);

    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d');
    if (!ctx) {
      throw new Error('Canvas 2D context unavailable for favicon derivation');
    }

    // Contain the logo within the square, preserving aspect ratio.
    const naturalW = img.naturalWidth || size;
    const naturalH = img.naturalHeight || size;
    const scale = Math.min(size / naturalW, size / naturalH);
    const drawW = naturalW * scale;
    const drawH = naturalH * scale;
    const dx = (size - drawW) / 2;
    const dy = (size - drawH) / 2;
    ctx.drawImage(img, dx, dy, drawW, drawH);

    const dataUrl = canvas.toDataURL('image/png');
    const base64 = dataUrl.split(',')[1];
    if (!base64) {
      throw new Error('Empty PNG produced during favicon derivation');
    }
    return base64;
  } finally {
    URL.revokeObjectURL(objectUrl);
  }
}
