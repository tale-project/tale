/**
 * Responsive image pipeline for marketing rasters.
 *
 * Reads source files under `public/marketing/sources/` (or CLI args), emits
 * AVIF + WebP at width subsets [480, 828, 1200, 1600] plus a ~24px blur
 * preview, and writes `app/generated/image-manifest.ts`.
 *
 * Outputs are committed — no build-step dependency.
 *
 * Usage:
 *   bun run --filter @tale/web optimize-images
 *   bun scripts/optimize-images.ts path/to/source.png
 *   bun scripts/optimize-images.ts --blog path/to/editorial/image-prompts.json
 *
 * Blog mode reads { id, assetPath } entries relative to the source manifest,
 * emits the same variants under public/blog/covers, and writes a separate
 * app/generated/blog-image-manifest.ts. Keep source masters outside public/.
 */
import { mkdir, readFile, readdir } from 'node:fs/promises';
import { basename, dirname, extname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import sharp from 'sharp';

const ROOT = resolve(fileURLToPath(new URL('..', import.meta.url)));
const SOURCES = join(ROOT, 'public', 'marketing', 'sources');
const WIDTHS = [480, 828, 1200, 1600] as const;

interface ManifestEntry {
  id: string;
  width: number;
  height: number;
  blurDataURL: string;
  variants: {
    avif: Record<number, string>;
    webp: Record<number, string>;
  };
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const blog = args[0] === '--blog';
  const outPath = blog ? 'blog/covers' : 'marketing/optimized';
  const outDir = join(ROOT, 'public', outPath);
  const manifest = join(
    ROOT,
    'app',
    'generated',
    blog ? 'blog-image-manifest.ts' : 'image-manifest.ts',
  );
  const exportName = blog ? 'BLOG_IMAGE_MANIFEST' : 'IMAGE_MANIFEST';
  let sources: { id: string; path: string }[] = args.map((src) => ({
    id: basename(src, extname(src)),
    path: src,
  }));
  if (blog) {
    if (args.length !== 2 || !args[1]) {
      throw new Error(
        'Usage: optimize-images.ts --blog path/to/image-prompts.json',
      );
    }
    const sourceManifest = resolve(args[1]);
    const input: unknown = JSON.parse(await readFile(sourceManifest, 'utf8'));
    if (!Array.isArray(input)) throw new Error('Expected a blog image array');
    const ids = new Set<string>();
    sources = input.map((entry: unknown) => {
      if (
        !entry ||
        typeof entry !== 'object' ||
        !('id' in entry) ||
        typeof entry.id !== 'string' ||
        !/^T\d{2}$/.test(entry.id) ||
        !('assetPath' in entry) ||
        typeof entry.assetPath !== 'string' ||
        ids.has(entry.id)
      ) {
        throw new Error(
          'Expected unique TNN ids and assetPath for every blog cover',
        );
      }
      ids.add(entry.id);
      return {
        id: entry.id,
        path: resolve(dirname(sourceManifest), entry.assetPath),
      };
    });
    if (sources.length === 0) throw new Error('Blog image manifest is empty');
  }
  if (sources.length === 0) {
    try {
      sources = (await readdir(SOURCES))
        .filter((f) => /\.(png|jpe?g|webp|tiff)$/i.test(f))
        .map((f) => ({ id: basename(f, extname(f)), path: join(SOURCES, f) }));
    } catch {
      console.log(
        `No sources in ${SOURCES}. Pass image paths as CLI args, or add files there.`,
      );
      await mkdir(dirname(manifest), { recursive: true });
      await writeManifest([], manifest, exportName);
      return;
    }
  }

  await mkdir(outDir, { recursive: true });
  await mkdir(join(ROOT, 'app', 'generated'), { recursive: true });

  const entries: ManifestEntry[] = [];
  for (const src of sources) {
    const { id } = src;
    const image = sharp(src.path);
    const meta = await image.metadata();
    const width = meta.width ?? 0;
    const height = meta.height ?? 0;

    const avif: Record<number, string> = {};
    const webp: Record<number, string> = {};
    for (const w of WIDTHS) {
      if (width && w > width) continue;
      const avifName = `${id}-${w}.avif`;
      const webpName = `${id}-${w}.webp`;
      await image
        .clone()
        .resize({ width: w, withoutEnlargement: true })
        .avif({ quality: 64 })
        .toFile(join(outDir, avifName));
      await image
        .clone()
        .resize({ width: w, withoutEnlargement: true })
        .webp({ quality: 78 })
        .toFile(join(outDir, webpName));
      avif[w] = `/${outPath}/${avifName}`;
      webp[w] = `/${outPath}/${webpName}`;
    }

    const blurBuf = await image
      .clone()
      .resize({ width: 24 })
      .webp({ quality: 40 })
      .toBuffer();
    const blurDataURL = `data:image/webp;base64,${blurBuf.toString('base64')}`;

    entries.push({ id, width, height, blurDataURL, variants: { avif, webp } });
    console.log(`optimized ${id} (${width}×${height})`);
  }

  await writeManifest(entries, manifest, exportName);
}

async function writeManifest(
  entries: ManifestEntry[],
  manifest: string,
  exportName: 'IMAGE_MANIFEST' | 'BLOG_IMAGE_MANIFEST',
): Promise<void> {
  const body = `/* Generated by scripts/optimize-images.ts — do not edit by hand. */
export interface ImageManifestEntry {
  id: string;
  width: number;
  height: number;
  blurDataURL: string;
  variants: {
    avif: Record<number, string>;
    webp: Record<number, string>;
  };
}

export const ${exportName} = ${JSON.stringify(entries, null, 2)} as const satisfies readonly ImageManifestEntry[];

${exportName === 'IMAGE_MANIFEST' ? "export type ImageManifestId = (typeof IMAGE_MANIFEST)[number]['id'];\n" : ''}
`;
  await Bun.write(manifest, body);
  // Match house style so `oxfmt --check` stays green when entries are non-empty.
  const { exitCode } = await Bun.$`bunx oxfmt ${manifest}`
    .cwd(resolve(ROOT, '../..'))
    .nothrow();
  if (exitCode !== 0) {
    throw new Error(`oxfmt failed on ${manifest} (exit ${exitCode})`);
  }
  console.log(`wrote ${manifest} (${entries.length} entries)`);
}

await main();
