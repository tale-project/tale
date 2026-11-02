/**
 * The social card every Tale site names in `og:image` and `twitter:image`
 * (`TALE_OG_IMAGE` in `@tale/ui/seo/globals`): the Tale wordmark over the
 * brand accent bar, rendered from the `TaleLogo` component at the size the
 * tags document and written through the shared encoder (`@tale/ui/images/encode`)
 * as a palette PNG within the policy's byte budget. Crawlers fetch the card
 * as is, so it is one PNG, not a `<picture>`. The marketing origin serves it;
 * docs and ui-docs point at the same absolute URL.
 *
 * Outputs are committed — no build-step dependency.
 *
 * Usage:
 *   bun run --filter @tale/web og-card
 */
import { writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodeImage } from '@tale/ui/images/encode';
import { PNG_QUALITY } from '@tale/ui/images/responsive';
import { TaleLogo } from '@tale/ui/logo';
import { TALE_OG_IMAGE } from '@tale/ui/seo/globals';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const OUT = join(ROOT, 'public', TALE_OG_IMAGE.path);

/** Ink and accent of the brand (`design/docs/branding.md`). */
const INK = '#030712';
const ACCENT = '#056cff';
/** The wordmark's design box (`TaleLogo`), drawn `LOGO_WIDTH` px wide. */
const WORDMARK = { width: 73.65, height: 20 };
const LOGO_WIDTH = 400;
const GAP = 48;
const BAR = { width: 64, height: 6 };

/** The card as SVG: the wordmark and the bar, centred as one group. */
export function ogCardSvg(): string {
  const { width, height } = TALE_OG_IMAGE;
  const logoHeight = (LOGO_WIDTH * WORDMARK.height) / WORDMARK.width;
  const top = Math.round((height - (logoHeight + GAP + BAR.height)) / 2);
  const logo = renderToStaticMarkup(
    createElement(TaleLogo, {
      x: (width - LOGO_WIDTH) / 2,
      y: top,
      width: LOGO_WIDTH,
      height: logoHeight,
      color: INK,
    }),
  );
  const bar = `<rect x="${(width - BAR.width) / 2}" y="${Math.round(top + logoHeight + GAP)}" width="${BAR.width}" height="${BAR.height}" rx="${BAR.height / 2}" fill="${ACCENT}"/>`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}"><rect width="${width}" height="${height}" fill="#ffffff"/>${logo}${bar}</svg>`;
}

export async function writeOgCard(): Promise<void> {
  const { bytes, quality } = await encodeImage(
    sharp(Buffer.from(ogCardSvg())),
    { format: 'png', quality: PNG_QUALITY, label: 'og.png' },
  );
  await writeFile(OUT, bytes);
  console.log(
    `wrote ${OUT} (${TALE_OG_IMAGE.width}×${TALE_OG_IMAGE.height}, quality ${quality}, ${bytes.byteLength} bytes)`,
  );
}

if (import.meta.main) await writeOgCard();
