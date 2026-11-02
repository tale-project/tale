/**
 * Derive the README's gallery tiles from the committed docs screenshots — the
 * same doctrine as the shots themselves: nothing here is hand-made, so a
 * retake of the docs images is one command away from a retake of the README.
 *
 *   bun run readme:assets
 *
 * Sources are the full frames under `services/docs/public/images/`, which are
 * 1.6:1 by construction (a 1440×900 viewport at DPR 2). Every tile keeps that
 * ratio, so a tile is a straight downscale — never a crop that slices a
 * column off the right edge. A shot captured at a different viewport must keep
 * 1.6:1 too (see `projects-task-board` in manifest.ts).
 *
 * GitHub shows a README image as is, with no `srcset` to pick from, so a tile
 * is the one width the shared image policy names for it
 * (`FIXED_IMAGE_WIDTHS.readmeTile` in `@tale/ui/images/responsive`), at the
 * policy's screen quality, through the shared encoder and its byte budget
 * (`@tale/ui/images/encode`). `services/docs/tests/readme-assets.test.ts` holds
 * the committed tiles to the same width and budget.
 */

import { existsSync } from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';

import { encodeImage } from '@tale/ui/images/encode';
import { FIXED_IMAGE_WIDTHS, IMAGE_QUALITY } from '@tale/ui/images/responsive';
import sharp from 'sharp';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO_ROOT = path.resolve(HERE, '../../../..');
const IMAGES = path.join(REPO_ROOT, 'services/docs/public/images');
const ASSETS = path.join(REPO_ROOT, '.github/assets');

/** Gallery tile → the docs frame it is a downscale of. */
const TILES: ReadonlyArray<{ name: string; source: string }> = [
  { name: 'readme-gallery-chat-arena', source: 'platform/chat-arena-split' },
  { name: 'readme-gallery-tasks', source: 'platform/projects-task-board' },
  {
    name: 'readme-gallery-project-agents',
    source: 'platform/project-agents-models',
  },
  {
    name: 'readme-gallery-workflow-editor',
    source: 'platform/automation-editor-canvas',
  },
  {
    name: 'readme-gallery-connectors',
    source: 'platform/connectors-add-credential',
  },
  {
    name: 'readme-gallery-guardrails',
    source: 'platform/governance-guardrails',
  },
] as const;

const sourcePath = (source: string): string =>
  path.join(IMAGES, `${source}.webp`);
const assetPath = (name: string): string => path.join(ASSETS, `${name}.webp`);

async function main(): Promise<void> {
  const missing = TILES.filter(({ source }) => !existsSync(sourcePath(source)));
  if (missing.length > 0) {
    console.error(
      'Missing docs screenshots — run `bun run docs:screenshots` first:\n' +
        missing.map(({ source }) => `  ${source}.webp`).join('\n'),
    );
    process.exit(1);
  }

  const width = FIXED_IMAGE_WIDTHS.readmeTile;
  for (const tile of TILES) {
    const frame = sharp(sourcePath(tile.source));
    const { width: sourceWidth } = await frame.metadata();
    if (sourceWidth < width) {
      throw new Error(
        `${tile.source}.webp is ${sourceWidth} px wide, narrower than the ${width} px README tile — retake it at DPR 2`,
      );
    }
    // sharp drops the capture rig's metadata unless asked to keep it.
    const { bytes, quality } = await encodeImage(frame.resize({ width }), {
      format: 'webp',
      quality: IMAGE_QUALITY.screen.webp,
      label: `${tile.name}.webp`,
    });
    await writeFile(assetPath(tile.name), bytes);
    console.log(
      `✓ ${tile.name}.webp ← ${tile.source}.webp (${width} px, quality ${quality}, ${bytes.byteLength} bytes)`,
    );
  }
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
