/**
 * Derive the README's gallery tiles and product tour from the committed docs
 * screenshots — the same doctrine as the shots themselves: nothing here is
 * hand-made, so a retake of the docs images is one command away from a retake
 * of the README.
 *
 *   bun run readme:assets
 *
 * Sources are the full frames under `services/docs/public/images/`, which are
 * 1.6:1 by construction (a 1440×900 viewport at DPR 2). Every asset here keeps
 * that ratio, so a tile is a straight downscale — never a crop that slices a
 * column off the right edge. A shot captured at a different viewport must keep
 * 1.6:1 too (see `projects-task-board` in manifest.ts).
 *
 * Encodes with sharp — the encoder the shots themselves go through (webp.ts) —
 * so the pipeline needs no ImageMagick on PATH.
 */

import { existsSync } from 'node:fs';
import path from 'node:path';

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

/** The tour cycles the same five surfaces the README's gallery leads with. */
const TOUR_FRAMES: readonly string[] = [
  'platform/project-agents-models',
  'platform/projects-task-board',
  'platform/automation-editor-canvas',
  'platform/connectors-add-credential',
  'platform/governance-guardrails',
] as const;

/** Bounding boxes — every source is 1.6:1, so fitting inside is a plain
 *  downscale, never a stretch. */
const TILE_BOX = { width: 802, height: 502 } as const;
const TOUR_BOX = { width: 1402, height: 877 } as const;
/** Straight cuts, held long enough to read — a morph between product screens
 *  just smears text. */
const TOUR_FRAME_MS = 2200;

const sourcePath = (source: string): string =>
  path.join(IMAGES, `${source}.webp`);
const assetPath = (name: string): string => path.join(ASSETS, `${name}.webp`);

async function main(): Promise<void> {
  const missing = [...TILES.map((tile) => tile.source), ...TOUR_FRAMES].filter(
    (source) => !existsSync(sourcePath(source)),
  );
  if (missing.length > 0) {
    console.error(
      'Missing docs screenshots — run `bun run docs:screenshots` first:\n' +
        missing.map((source) => `  ${source}.webp`).join('\n'),
    );
    process.exit(1);
  }

  for (const tile of TILES) {
    // sharp drops the capture rig's metadata unless asked to keep it.
    await sharp(sourcePath(tile.source))
      .resize(TILE_BOX.width, TILE_BOX.height, { fit: 'inside' })
      .webp({ quality: 82 })
      .toFile(assetPath(tile.name));
    console.log(`✓ ${tile.name}.webp ← ${tile.source}.webp`);
  }

  // Animation frames must share one size, so scale each first, then join
  // them as pages of one animated WebP.
  const frames = await Promise.all(
    TOUR_FRAMES.map((source) =>
      sharp(sourcePath(source))
        .resize(TOUR_BOX.width, TOUR_BOX.height, { fit: 'inside' })
        .toBuffer(),
    ),
  );
  await sharp(frames, { join: { animated: true } })
    // One delay per frame: a bare number only times the first page.
    .webp({
      quality: 78,
      delay: TOUR_FRAMES.map(() => TOUR_FRAME_MS),
      loop: 0,
    })
    .toFile(assetPath('readme-tour'));
  console.log(`✓ readme-tour.webp ← ${TOUR_FRAMES.length} frames`);
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
