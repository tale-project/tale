/** Explicit native proof; ordinary unit tests never require a system ffmpeg. */
import {
  copyFileSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
} from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';

import sharp from 'sharp';

import {
  ensureFfmpegAvailable,
  ffmpegBin,
  probeAudioStream,
  probeDurationMs,
  probeVideoStream,
  runFfmpeg,
} from '../../platform/tests/docs-videos/lib/ffmpeg';
import {
  PRODUCT_SCREENSHOT_LOCALES,
  PRODUCT_SCREENSHOTS,
} from '../app/content/product-screenshots';
import type { MotionCapture } from '../lib/media/product-motion-provenance';
import {
  MOTION_BUDGETS,
  MOTION_DURATION_MS,
  MOTION_FPS,
  sha256,
} from './product-motion/encode';

const PUBLIC = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../public/marketing/product-motion',
);

export async function verifyProductMotion(reviewDir?: string): Promise<void> {
  const checkout = path.resolve(
    path.dirname(fileURLToPath(import.meta.url)),
    '../../..',
  );
  const relativeReview = reviewDir && path.relative(checkout, reviewDir);
  if (
    reviewDir &&
    (!path.isAbsolute(reviewDir) ||
      !relativeReview?.startsWith(`..${path.sep}`))
  )
    throw new Error(
      'Motion review directory must be an absolute path outside the checkout',
    );
  await ensureFfmpegAvailable();
  const { entries } = JSON.parse(
    readFileSync(path.join(PUBLIC, 'manifest.json'), 'utf8'),
  ) as { entries: MotionCapture[] };
  const expected = Object.keys(PRODUCT_SCREENSHOTS).flatMap((page) =>
    PRODUCT_SCREENSHOT_LOCALES.flatMap((locale) =>
      ['desktop', 'mobile'].map((variant) => `${page}/${locale}/${variant}`),
    ),
  );
  const keys = entries.map(
    (entry) => `${entry.page}/${entry.locale}/${entry.variant}`,
  );
  if (
    keys.length !== expected.length ||
    expected.some((key) => !keys.includes(key)) ||
    new Set(keys).size !== keys.length
  )
    throw new Error('Product motion capture matrix is incomplete');
  const dir = mkdtempSync(path.join(os.tmpdir(), 'tale-motion-verify-'));
  try {
    for (const entry of entries)
      for (const format of ['webm', 'mp4'] as const) {
        const file = path.join(
          PUBLIC,
          entry.locale,
          `${entry.page}-${entry.variant}.${format}`,
        );
        if (
          statSync(file).size !== entry[format].bytes ||
          entry[format].bytes > MOTION_BUDGETS[entry.variant] ||
          sha256(file) !== entry[format].sha256
        )
          throw new Error(`${file}: bytes/hash/budget mismatch`);
        const info = await probeVideoStream(file);
        if (
          info.codec !== (format === 'webm' ? 'vp9' : 'h264') ||
          !info.container.includes(format === 'webm' ? 'webm' : 'mp4') ||
          info.width !== entry.width ||
          info.height !== entry.height ||
          info.fps !== MOTION_FPS ||
          info.frameCount !== (MOTION_FPS * MOTION_DURATION_MS) / 1000 ||
          info.pixelFormat !== 'yuv420p'
        )
          throw new Error(
            `${file}: codec/dimensions/frame rate/container mismatch`,
          );
        if (await probeAudioStream(file))
          throw new Error(`${file}: unexpected audio`);
        if (Math.abs((await probeDurationMs(file)) - MOTION_DURATION_MS) > 100)
          throw new Error(`${file}: unexpected duration`);
        const region = entry.action.inkRegion;
        if (
          region.left < 0 ||
          region.top < 0 ||
          region.width <= 0 ||
          region.height <= 0 ||
          region.left + region.width > entry.width ||
          region.top + region.height > entry.height
        )
          throw new Error(`${file}: result region is clipped`);
        const frames: Buffer[] = [];
        for (const [index, ms] of [
          entry.action.beforeAtMs,
          entry.action.afterAtMs,
        ].entries()) {
          const png = path.join(dir, `${index}.png`);
          await runFfmpeg(
            ffmpegBin(),
            ['-y', '-ss', String(ms / 1000), '-i', file, '-frames:v', '1', png],
            30000,
          );
          frames.push(
            await sharp(png).extract(region).removeAlpha().raw().toBuffer(),
          );
          if (reviewDir && format === 'mp4' && index === 1) {
            const localeDir = path.join(reviewDir, entry.locale);
            mkdirSync(localeDir, { recursive: true });
            copyFileSync(
              png,
              path.join(localeDir, `${entry.page}-${entry.variant}.png`),
            );
          }
        }
        const [before, after] = frames;
        if (!before || !after || before.length !== after.length)
          throw new Error(`${file}: incompatible decoded frames`);
        let changed = 0;
        for (let index = 0; index < before.length; index += 3) {
          const delta =
            Math.abs((before[index] ?? 0) - (after[index] ?? 0)) +
            Math.abs((before[index + 1] ?? 0) - (after[index + 1] ?? 0)) +
            Math.abs((before[index + 2] ?? 0) - (after[index + 2] ?? 0));
          if (delta > 60) changed++;
        }
        if (changed / (before.length / 3) < 0.005)
          throw new Error(`${file}: no meaningful native result changed`);
        console.log(
          `✓ ${entry.page}/${entry.locale}/${entry.variant}/${format}: ${info.codec}, ${entry.width}×${entry.height}, native action ink changed`,
        );
      }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  if (args[0] === '--') args.shift();
  const { values } = parseArgs({
    args,
    options: { 'review-dir': { type: 'string' } },
  });
  verifyProductMotion(values['review-dir']).catch((error: unknown) => {
    console.error('web:animations:verify failed:', error);
    process.exitCode = 1;
  });
}
