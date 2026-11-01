/**
 * Responsive variants of the docs screenshots.
 *
 * Encodes every `/images/….webp` a docs page references along the shared
 * ladder, formats, qualities and byte budget (`@tale/ui/images/responsive`,
 * `@tale/ui/images/encode` — the marketing site's pipeline uses the same)
 * into `public/images/optimized/`, mirroring the original's path. Writes each
 * original's intrinsic size to `app/content/image-dimensions.ts`, which
 * `DocsImage` reads, and its SHA-256 to `public/images/manifest.json`, so
 * `tests/image-manifest.test.ts` can tell fresh variants from stale ones.
 *
 * An image whose original still matches its recorded hash and whose variants
 * all exist is skipped; `--force` encodes every image again. Variants no page
 * needs any more are removed. The original stays the full-size file at its
 * published `/images/…` URL.
 *
 * Outputs are committed — no build-step dependency. `bun run docs:screenshots`
 * runs this after every capture.
 *
 * Usage:
 *   bun run docs:images
 *   bun run docs:images --force
 */
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readdir, readFile, rm, rmdir } from 'node:fs/promises';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { encodeImage } from '@tale/ui/images/encode';
import { IMAGE_FORMATS, IMAGE_QUALITY } from '@tale/ui/images/responsive';
import sharp from 'sharp';

import {
  docsImageVariant,
  docsImageWidths,
} from '../lib/content/image-variants';
import { pageImageTargets } from '../tests/lib/image-refs';

const DOCS_ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const REPO_ROOT = resolve(DOCS_ROOT, '..', '..');
const PUBLIC_ROOT = join(DOCS_ROOT, 'public');
const OPTIMIZED_ROOT = join(PUBLIC_ROOT, 'images', 'optimized');
const MANIFEST = join(PUBLIC_ROOT, 'images', 'manifest.json');
const REGISTRY = join(DOCS_ROOT, 'app', 'content', 'image-dimensions.ts');

interface ManifestEntry {
  file: string;
  sha256?: string;
  [field: string]: unknown;
}

/** Every file under `dir`, `public/`-relative and `/`-separated. */
async function publicFilesUnder(dir: string): Promise<string[]> {
  if (!existsSync(dir)) return [];
  const entries = await readdir(dir, { recursive: true, withFileTypes: true });
  return entries
    .filter((entry) => entry.isFile())
    .map((entry) =>
      relative(PUBLIC_ROOT, join(entry.parentPath, entry.name))
        .split(sep)
        .join('/'),
    );
}

/** Remove the directories under `dir` that pruning left empty. */
async function removeEmptyDirectories(dir: string): Promise<boolean> {
  let empty = true;
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) {
      empty = false;
      continue;
    }
    if (!(await removeEmptyDirectories(join(dir, entry.name)))) empty = false;
  }
  if (empty && dir !== OPTIMIZED_ROOT) await rmdir(dir);
  return empty;
}

export async function optimizeImages(force = false): Promise<void> {
  const manifestText = await readFile(MANIFEST, 'utf8');
  const manifest = JSON.parse(manifestText) as { entries: ManifestEntry[] };
  const byFile = new Map(manifest.entries.map((entry) => [entry.file, entry]));
  const referenced = [...pageImageTargets()]
    .filter((file) => file.endsWith('.webp'))
    .sort();

  const expected = new Set<string>();
  const dimensions: [file: string, width: number, height: number][] = [];
  let encodedImages = 0;
  for (const file of referenced) {
    const entry = byFile.get(file);
    if (!entry) {
      throw new Error(
        `${file} is referenced by a page but has no manifest entry. Capture it with bun run docs:screenshots.`,
      );
    }
    const original = await readFile(join(PUBLIC_ROOT, file));
    const sha256 = createHash('sha256').update(original).digest('hex');
    const image = sharp(original);
    const { width, height } = await image.metadata();
    if (!width || !height) throw new Error(`${file} has no dimensions`);
    dimensions.push([file, width, height]);

    const variants = docsImageWidths(width).flatMap((size) =>
      IMAGE_FORMATS.map((format) => ({
        size,
        format,
        variant: docsImageVariant(file, width, size, format),
      })),
    );
    const encoded = variants.filter(({ variant }) => variant !== file);
    for (const { variant } of encoded) expected.add(variant);
    const fresh =
      entry.sha256 === sha256 &&
      encoded.every(({ variant }) => existsSync(join(PUBLIC_ROOT, variant)));
    if (fresh && !force) continue;

    for (const { size, format, variant } of encoded) {
      // The original keeps its own pixels at its own width (the AVIF of an
      // image narrower than the column); every other variant is a downscale.
      const resized =
        size === width ? image.clone() : image.clone().resize({ width: size });
      const quality = IMAGE_QUALITY.screen[format];
      const result = await encodeImage(resized, {
        format,
        quality,
        label: variant,
      });
      const target = join(PUBLIC_ROOT, variant);
      await mkdir(dirname(target), { recursive: true });
      await Bun.write(target, result.bytes);
      if (result.quality !== quality) {
        console.log(
          `fit ${variant} at quality ${result.quality} (${result.bytes.byteLength} bytes)`,
        );
      }
    }
    entry.sha256 = sha256;
    encodedImages += 1;
    console.log(`optimized ${file} (${width}×${height})`);
  }

  let pruned = 0;
  for (const file of await publicFilesUnder(OPTIMIZED_ROOT)) {
    if (expected.has(file)) continue;
    await rm(join(PUBLIC_ROOT, file));
    pruned += 1;
    console.log(`removed ${file}: no page shows its image`);
  }
  if (existsSync(OPTIMIZED_ROOT)) await removeEmptyDirectories(OPTIMIZED_ROOT);

  const nextManifest = `${JSON.stringify(manifest, null, 2)}\n`;
  if (nextManifest !== manifestText) await Bun.write(MANIFEST, nextManifest);
  await writeRegistry(dimensions);
  console.log(
    `${encodedImages} of ${referenced.length} images encoded, ${pruned} stale variants removed`,
  );
}

async function writeRegistry(
  dimensions: readonly [file: string, width: number, height: number][],
): Promise<void> {
  const rows = dimensions
    .map(([file, width, height]) => `  '${file}': [${width}, ${height}],`)
    .join('\n');
  await Bun.write(
    REGISTRY,
    `/* Generated by scripts/optimize-images.ts — do not edit by hand. */

/** The intrinsic size of every screenshot a docs page references, keyed by its
 *  \`public/\`-relative file; \`DocsImage\` serves its variants from it. */
export const IMAGE_DIMENSIONS: Readonly<
  Partial<Record<string, readonly [width: number, height: number]>>
> = {
${rows}
};
`,
  );
  // Match house style so `oxfmt --check` stays green.
  const { exitCode } = await Bun.$`bunx oxfmt ${REGISTRY}`
    .cwd(REPO_ROOT)
    .nothrow();
  if (exitCode !== 0) {
    throw new Error(`oxfmt failed on ${REGISTRY} (exit ${exitCode})`);
  }
}

if (import.meta.main) await optimizeImages(process.argv.includes('--force'));
