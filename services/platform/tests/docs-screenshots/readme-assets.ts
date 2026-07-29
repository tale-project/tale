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
 * Requires ImageMagick (`magick`) on PATH.
 */

import { execFileSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';

const HERE = path.dirname(new URL(import.meta.url).pathname);
const REPO_ROOT = path.resolve(HERE, '../../../..');
const IMAGES = path.join(REPO_ROOT, 'services/docs/public/images');
const ASSETS = path.join(REPO_ROOT, '.github/assets');

/** Gallery tile → the docs frame it is a downscale of. */
const TILES: ReadonlyArray<{ name: string; source: string }> = [
  { name: 'readme-gallery-chat-arena', source: 'platform/chat-arena-split' },
  { name: 'readme-gallery-tasks', source: 'platform/projects-task-board' },
  {
    name: 'readme-gallery-agent-editor',
    source: 'get-started/agent-editor-general',
  },
  {
    name: 'readme-gallery-workflow-editor',
    source: 'platform/automation-editor-canvas',
  },
  {
    name: 'readme-gallery-connectors',
    source: 'platform/connectors-catalog',
  },
  {
    name: 'readme-gallery-guardrails',
    source: 'platform/governance-guardrails',
  },
] as const;

/** The tour cycles the same five surfaces the README's gallery leads with. */
const TOUR_FRAMES: readonly string[] = [
  'get-started/agent-editor-general',
  'platform/projects-task-board',
  'platform/automation-editor-canvas',
  'platform/connectors-catalog',
  'platform/governance-guardrails',
] as const;

const TILE_SIZE = '802x502';
const TOUR_SIZE = '1402x877';
/** Straight cuts, held long enough to read — a morph between product screens
 *  just smears text. */
const TOUR_DELAY_CENTISECONDS = 220;

const sourcePath = (source: string): string =>
  path.join(IMAGES, `${source}.webp`);
const assetPath = (name: string): string => path.join(ASSETS, `${name}.webp`);

function magick(args: readonly string[]): void {
  execFileSync('magick', [...args], { stdio: 'pipe' });
}

function main(): void {
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
    // Every source is already 1.6:1, so a plain resize is exact — no `!` flag,
    // which would distort. `-strip` drops the capture rig's metadata.
    magick([
      sourcePath(tile.source),
      '-resize',
      TILE_SIZE,
      '-strip',
      '-quality',
      '82',
      assetPath(tile.name),
    ]);
    console.log(`✓ ${tile.name}.webp ← ${tile.source}.webp`);
  }

  magick([
    '-delay',
    String(TOUR_DELAY_CENTISECONDS),
    '-loop',
    '0',
    ...TOUR_FRAMES.map(sourcePath),
    '-resize',
    TOUR_SIZE,
    '-strip',
    '-quality',
    '78',
    assetPath('readme-tour'),
  ]);
  console.log(`✓ readme-tour.webp ← ${TOUR_FRAMES.length} frames`);
}

main();
