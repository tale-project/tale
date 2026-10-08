/**
 * Responsive image pipeline for marketing rasters.
 *
 * Reads source files under `public/marketing/sources/` (or CLI args), emits
 * AVIF + WebP responsive widths plus a ~24px blur preview, and writes
 * `app/generated/image-manifest.ts`. Product captures retain a native-size
 * derivative and separately registered phone/desktop display crops.
 * Encoding preserves those dimensions and lowers quality only as needed to
 * meet the existing 200KiB public-image budget, failing at the quality floor.
 *
 * Outputs are committed — no build-step dependency.
 *
 * Usage:
 *   bun run --filter @tale/web optimize-images
 *   bun scripts/optimize-images.ts path/to/source.png
 */
import { access, mkdir, readdir } from 'node:fs/promises';
import { basename, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp, { type Sharp } from 'sharp';

import {
  PRODUCT_SCREENSHOT_LOCALES,
  PRODUCT_SCREENSHOTS,
  productScreenshotId,
} from '../app/content/product-screenshots';
import {
  IMAGE_MANIFEST,
  type ImageManifestEntry,
} from '../app/generated/image-manifest';
import { encodeMarketingImage } from './image-encoder';
import { imageManifestExpression, mergeImageManifest } from './image-manifest';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SOURCES = join(ROOT, 'public', 'marketing', 'sources');
const OUT_DIR = join(ROOT, 'public', 'marketing', 'optimized');
const MANIFEST = join(ROOT, 'app', 'generated', 'image-manifest.ts');
const WIDTHS = [480, 828, 1200, 1600, 2400, 2880] as const;

export async function optimizeImage(
  image: Sharp,
  id: string,
  width: number,
  height: number,
  productScreen: boolean,
  blurPreview = true,
  outputDir = OUT_DIR,
): Promise<ImageManifestEntry> {
  const widths = WIDTHS.filter((size) => size <= width);
  // The inspection link keeps the actual capture resolution, including a
  // source larger than the ordinary responsive-width budget.
  const outputWidths = productScreen
    ? [...new Set([...widths, width])]
    : widths;
  const avif: Record<number, string> = {};
  const webp: Record<number, string> = {};
  for (const size of outputWidths) {
    for (const format of ['avif', 'webp'] as const) {
      const filename = `${id}-${size}.${format}`;
      const resized = image
        .clone()
        .resize({ width: size, withoutEnlargement: true });
      const quality =
        format === 'avif' ? (productScreen ? 80 : 64) : productScreen ? 90 : 78;
      const encoded = await encodeMarketingImage(resized, {
        format,
        quality,
        label: filename,
      });
      await Bun.write(join(outputDir, filename), encoded.bytes);
      if (encoded.quality !== quality) {
        console.log(
          `fit ${filename} at quality ${encoded.quality} (${encoded.bytes.byteLength} bytes)`,
        );
      }
      (format === 'avif' ? avif : webp)[size] =
        `/marketing/optimized/${filename}`;
    }
  }
  const preview = blurPreview
    ? await image.clone().resize({ width: 24 }).webp({ quality: 40 }).toBuffer()
    : null;
  return {
    id,
    width,
    height,
    blurDataURL: preview
      ? `data:image/webp;base64,${preview.toString('base64')}`
      : '',
    variants: { avif, webp },
  };
}

export async function optimizeImages(): Promise<void> {
  const args = process.argv.slice(2);
  const productScreens = args.includes('--product-screens');
  const productSources = Object.values(PRODUCT_SCREENSHOTS).flatMap((shot) =>
    PRODUCT_SCREENSHOT_LOCALES.map((locale) => ({
      src: resolve(
        ROOT,
        '../docs/public/images/platform',
        locale === 'en' ? '' : locale,
        `${shot.source}.webp`,
      ),
      id: productScreenshotId(shot.source, locale),
      crop: shot.crop,
      desktopCrop: 'desktopCrop' in shot ? shot.desktopCrop : undefined,
    })),
  );
  let sources: string[] = productScreens
    ? productSources.map(({ src }) => src)
    : args;
  if (sources.length === 0) {
    try {
      sources = (await readdir(SOURCES))
        .filter((f) => /\.(png|jpe?g|webp|tiff)$/i.test(f))
        .map((f) => join(SOURCES, f));
    } catch {
      sources = [];
    }
    if (sources.length === 0) {
      console.log(
        `No sources in ${SOURCES}. Existing image manifest kept. Pass image paths as CLI args, or add files there.`,
      );
      return;
    }
  }

  if (productScreens) {
    const available = await Promise.allSettled(
      sources.map((source) => access(source)),
    );
    const missing = sources.filter(
      (_source, index) => available[index]?.status === 'rejected',
    );
    if (missing.length > 0) {
      throw new Error(
        `Missing localized product captures. Run bun run web:screenshots before optimizing:\n${missing.join('\n')}`,
      );
    }
  }

  await mkdir(OUT_DIR, { recursive: true });
  await mkdir(join(ROOT, 'app', 'generated'), { recursive: true });

  const entries: ImageManifestEntry[] = [];
  for (const src of sources) {
    const product = productScreens
      ? productSources.find((entry) => entry.src === src)
      : undefined;
    const id = product?.id ?? basename(src, extname(src));
    const image = sharp(src);
    const meta = await image.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;

    if (!width || !height)
      throw new Error(`Image dimensions are missing: ${src}`);
    entries.push(await optimizeImage(image, id, width, height, productScreens));
    console.log(`optimized ${id} (${width}×${height})`);

    if (productScreens) {
      const shot = product;
      if (!shot) throw new Error(`No product capture registered for ${id}`);
      entries.push(
        await optimizeImage(
          image.clone().extract(shot.crop),
          `${id}-mobile`,
          shot.crop.width,
          shot.crop.height,
          true,
        ),
      );
      if (shot.desktopCrop) {
        const crop = shot.desktopCrop;
        entries.push(
          await optimizeImage(
            image.clone().extract(crop),
            `${id}-desktop`,
            crop.width,
            crop.height,
            true,
          ),
        );
      }
    }
  }

  await writeManifest(
    mergeImageManifest(
      IMAGE_MANIFEST,
      entries,
      productScreens
        ? Object.values(PRODUCT_SCREENSHOTS).map(({ source }) => source)
        : [],
    ),
  );
}

export async function writeManifest(
  entries: ImageManifestEntry[],
): Promise<void> {
  const motion = entries.some(({ id }) => id.startsWith('motion-'));
  const staticEntries = entries.filter(({ id }) => !id.startsWith('motion-'));
  const expression = imageManifestExpression(staticEntries);
  const bodyExpression = motion
    ? `${expression.slice(0, -1)}${staticEntries.length ? ',' : ''} ...motionPosterEntries(PRODUCT_MOTION)]`
    : expression;
  const body = `/* Generated by scripts/optimize-images.ts — do not edit by hand. */
import { imageEntry, type ImageManifestEntry } from '../../lib/images/manifest-entry';
${motion ? "import { motionPosterEntries } from '../../lib/media/product-motion-entry';\nimport { PRODUCT_MOTION } from './product-motion';" : ''}
export type { ImageManifestEntry } from '../../lib/images/manifest-entry';

export const IMAGE_MANIFEST = ${bodyExpression} as const satisfies readonly ImageManifestEntry[];

export type ImageManifestId = (typeof IMAGE_MANIFEST)[number]['id'];
`;
  await Bun.write(MANIFEST, body);
  // Match house style so `oxfmt --check` stays green when entries are non-empty.
  const { exitCode } = await Bun.$`bunx oxfmt ${MANIFEST}`
    .cwd(resolve(ROOT, '../..'))
    .nothrow();
  if (exitCode !== 0) {
    throw new Error(`oxfmt failed on ${MANIFEST} (exit ${exitCode})`);
  }
  console.log(`wrote ${MANIFEST} (${entries.length} entries)`);
}

if (import.meta.main) await optimizeImages();
