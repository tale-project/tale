/** Eight-second silent native-product clips, sharing docs capture state and video frames. */
import { createHash } from 'node:crypto';
import {
  copyFileSync,
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { chromium, expect, type Browser } from '@playwright/test';
import sharp from 'sharp';

import {
  screenshotStateDir,
  type CaptureLocale,
} from '../../platform/tests/docs-screenshots/capture-options';
import { captureRuntime } from '../../platform/tests/docs-screenshots/capture-runtime';
import { withCaptureLocale } from '../../platform/tests/docs-screenshots/i18n';
import {
  SHOTS,
  type ShotContext,
} from '../../platform/tests/docs-screenshots/manifest';
import { ensureFfmpegAvailable } from '../../platform/tests/docs-videos/lib/ffmpeg';
import { buildConcatList } from '../../platform/tests/docs-videos/lib/frame-playlist';
import { attachScreencastSink } from '../../platform/tests/docs-videos/lib/screencast';
import { deleteThreadById } from '../../platform/tests/e2e/helpers/chat';
import { BASE_URL, TIMEOUT } from '../../platform/tests/e2e/helpers/env';
import {
  IMAGE_MANIFEST,
  type ImageManifestEntry,
} from '../app/generated/image-manifest';
import type { MotionCapture } from '../lib/media/product-motion-provenance';
import { mergeImageManifest } from './image-manifest';
import { optimizeImage, writeManifest } from './optimize-images';
import {
  encodeMotion,
  MOTION_DURATION_MS,
  MOTION_FPS,
} from './product-motion/encode';
import { visibleInkRegion } from './product-motion/geometry';
import { productMotionArgs } from './product-motion/options';
import { MOTION_SCENES, type MotionScene } from './product-motion/scenes';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PUBLIC = path.join(ROOT, 'public/marketing/product-motion');
const VARIANTS = ['desktop', 'mobile'] as const;
type Variant = (typeof VARIANTS)[number];
const VIEWPORTS = {
  desktop: { width: 1280, height: 800 },
  mobile: { width: 390, height: 820 },
} as const;

/** Remove only thread IDs returned by this take's actual new-thread action. */
async function cleanupThreads(
  browser: Browser,
  authState: string,
  orgId: string,
  owned: Set<string>,
): Promise<void> {
  if (!owned.size) return;
  const context = await browser.newContext({
    baseURL: BASE_URL,
    storageState: authState,
    viewport: { width: 1280, height: 800 },
    locale: 'en-US',
    serviceWorkers: 'block',
  });
  try {
    await context.addInitScript(() => {
      localStorage.setItem('user-locale', 'en');
    });
    const page = await context.newPage();
    await page.goto(`/dashboard/${orgId}/chat`, {
      waitUntil: 'domcontentloaded',
    });
    for (const id of owned) {
      await deleteThreadById(page, id);
      owned.delete(id);
    }
  } finally {
    await context.close();
  }
}

async function record(
  browser: Browser,
  scene: MotionScene,
  locale: CaptureLocale,
  variant: Variant,
  stateDir: string,
  authState: string,
  ctx: ShotContext,
): Promise<{ capture: MotionCapture; poster: ImageManifestEntry }> {
  const shot = SHOTS.find(({ name }) => name === scene.sourceShot);
  if (!shot) throw new Error(`No source shot for ${scene.page}`);
  const viewport = VIEWPORTS[variant];
  const dpr = variant === 'mobile' ? 2 : 1;
  const context = await browser.newContext({
    baseURL: BASE_URL,
    storageState: authState,
    viewport,
    deviceScaleFactor: dpr,
    colorScheme: 'light',
    locale: locale === 'en' ? 'en-US' : locale === 'de' ? 'de-DE' : 'fr-FR',
    timezoneId: 'UTC',
    serviceWorkers: 'block',
  });
  const dir = path.join(
    stateDir,
    'motion',
    `${scene.page}-${locale}-${variant}-${Date.now()}`,
  );
  mkdirSync(dir, { recursive: true });
  await context.addInitScript((nativeLocale) => {
    localStorage.setItem('tale-theme', 'light');
    localStorage.setItem('user-locale', nativeLocale);
  }, locale);
  await context.addInitScript({
    path: path.resolve(ROOT, '../platform/tests/docs-videos/lib/overlay.js'),
  });
  const page = await context.newPage();
  const ownedThreads = new Set<string>();
  let recording = false;
  const cdp = await context.newCDPSession(page);
  try {
    await page.goto(shot.route.replace(':orgId', ctx.orgId), {
      waitUntil: 'domcontentloaded',
    });
    // The native phone Inbox lives in Home; its conversation page omits
    // the desktop rail that the shared shot's preparation selects from.
    if (scene.page === 'hub' && variant === 'mobile') {
      await page.goto(`/dashboard/${ctx.orgId}/home`, {
        waitUntil: 'domcontentloaded',
      });
    }
    await shot.prepare?.(page, ctx);
    await expect(shot.readyWhen(page, ctx)).toBeVisible({
      timeout: TIMEOUT.FIRST_PAINT,
    });
    // The phone conversation deliberately replaces Home's Inbox radio.
    // Its shared readyWhen already resolves the native reply-editor label.
    if (
      shot.localizedReadyWhen &&
      !(scene.page === 'hub' && variant === 'mobile')
    )
      await expect(shot.localizedReadyWhen(page, ctx)).toBeVisible({
        timeout: TIMEOUT.FIRST_PAINT,
      });
    await expect(page.locator('html')).toHaveAttribute('lang', locale);
    // Warm the real interaction without recording lazy chunks or loading masks.
    await scene.prepare?.(page, ctx);
    await scene.run(page, ownedThreads, locale);
    await scene.reset(page);
    await cleanupThreads(browser, authState, ctx.orgId, ownedThreads);
    await scene.prepare?.(page, ctx);
    await page.evaluate(() => document.fonts.ready);
    await page.waitForTimeout(500);
    const before = await page.screenshot();
    const sink = attachScreencastSink(cdp, dir);
    await cdp.send('Page.startScreencast', {
      format: 'jpeg',
      quality: 90,
      maxWidth: viewport.width * dpr,
      maxHeight: viewport.height * dpr,
      everyNthFrame: 1,
    });
    recording = true;
    await sink.firstFrameAt();
    const started = performance.now();
    await page.waitForTimeout(1000);
    await scene.run(page, ownedThreads, locale);
    const completedAtMs = Math.round(performance.now() - started);
    if (completedAtMs > 6200)
      throw new Error(
        `${scene.page} action exceeded its readable eight-second budget`,
      );
    const after = await page.screenshot();
    const resultBox = await scene.result(page).boundingBox();
    if (!resultBox)
      throw new Error(`${scene.page} result has no visible ink region`);
    const hash = (buffer: Buffer) =>
      createHash('sha256').update(buffer).digest('hex');
    if (hash(before) === hash(after))
      throw new Error(`${scene.page} did not change the product`);
    await page.waitForTimeout(
      Math.max(0, 6500 - (performance.now() - started)),
    );
    if (scene.resetOnCamera !== false) await scene.reset(page);
    await page.waitForTimeout(
      Math.max(0, MOTION_DURATION_MS - (performance.now() - started)),
    );
    await cdp.send('Page.stopScreencast');
    recording = false;
    const first = sink.frames[0];
    if (!first || sink.frames.length < 12)
      throw new Error(`${scene.page} did not record enough native frames`);
    const meta = await sharp(path.join(dir, first.file)).metadata();
    if (!meta.width || !meta.height)
      throw new Error('Missing native frame dimensions');
    const width =
      Math.floor(Math.min(meta.width, variant === 'mobile' ? 720 : 1280) / 2) *
      2;
    const height = Math.floor((meta.height * width) / meta.width / 2) * 2;
    if (width !== viewport.width || height !== viewport.height) {
      throw new Error(
        `Native motion frame ${width}×${height} differs from the shared ${viewport.width}×${viewport.height} playback geometry`,
      );
    }
    const playlist = path.join(dir, 'frames.txt');
    writeFileSync(playlist, buildConcatList(sink.frames, MOTION_DURATION_MS));
    writeFileSync(path.join(dir, 'frames.json'), JSON.stringify(sink.frames));
    const outDir = path.join(PUBLIC, locale);
    mkdirSync(outDir, { recursive: true });
    const base = path.join(dir, `${scene.page}-${variant}`);
    const webm = await encodeMotion(
      playlist,
      `${base}.webm`,
      { width, height },
      variant,
    );
    const mp4 = await encodeMotion(
      playlist,
      `${base}.mp4`,
      { width, height },
      variant,
    );
    mkdirSync(path.join(ROOT, 'public/marketing/optimized'), {
      recursive: true,
    });
    const posterId = `motion-${scene.page}-${locale}-${variant}`;
    const posterDir = path.join(dir, 'posters');
    mkdirSync(posterDir, { recursive: true });
    const poster = await optimizeImage(
      sharp(path.join(dir, first.file)).resize(width, height),
      posterId,
      width,
      height,
      true,
      false,
      posterDir,
    );
    const capture: MotionCapture = {
      page: scene.page,
      locale,
      variant,
      sourceShot: scene.sourceShot,
      route: shot.route,
      viewport,
      dpr,
      width,
      height,
      durationMs: MOTION_DURATION_MS,
      fps: MOTION_FPS,
      recordedFrameCount: sink.frames.length,
      action: {
        id: scene.action,
        beforeAssertion: scene.beforeAssertion(locale),
        afterAssertion: scene.afterAssertion(locale),
        beforeFrameHash: hash(before),
        afterFrameHash: hash(after),
        completedAtMs,
        beforeAtMs: 500,
        afterAtMs: completedAtMs + 250,
        inkRegion: visibleInkRegion(resultBox, viewport, { width, height }),
      },
      webm,
      mp4,
    };
    writeFileSync(
      path.join(dir, 'capture.json'),
      JSON.stringify(capture, null, 2),
    );
    // Publication follows both successful decoder proofs and every poster
    // encoding. A failed retry never overwrites previously proven assets.
    for (const format of ['webm', 'mp4'])
      copyFileSync(
        `${base}.${format}`,
        path.join(outDir, `${scene.page}-${variant}.${format}`),
      );
    for (const formats of Object.values(poster.variants))
      for (const url of Object.values(formats)) {
        copyFileSync(
          path.join(posterDir, path.basename(url)),
          path.join(ROOT, 'public', url),
        );
      }
    console.log(
      `✓ ${scene.page}/${locale}/${variant}: ${sink.frames.length} frames, ${width}×${height}, ${webm.bytes}/${mp4.bytes} bytes`,
    );
    return { capture, poster };
  } finally {
    try {
      if (recording) await cdp.send('Page.stopScreencast');
      await shot.restore?.(page, ctx);
    } finally {
      await context.close();
      await cleanupThreads(browser, authState, ctx.orgId, ownedThreads);
    }
  }
}

async function main(): Promise<void> {
  const argv = process.argv.slice(2);
  const args = productMotionArgs(argv);
  const scenes = MOTION_SCENES.filter(
    (scene) =>
      (!args.only.length || args.only.includes(scene.page)) &&
      (!args.grep || args.grep.test(scene.page)),
  );
  if (!scenes.length) throw new Error('No product motion scenes matched');
  if (args.list) {
    for (const scene of scenes)
      console.log(`${scene.page}: ${scene.action} (${scene.sourceShot})`);
    return;
  }
  const stateDir = screenshotStateDir(
    args,
    process.env.TALE_SCREENSHOT_STATE_DIR,
    path.resolve(ROOT, '../platform/tests/docs-screenshots/.state'),
  );
  const runtime = captureRuntime({
    stateDir,
    configDir: args.configDir ?? undefined,
  });
  await runtime.preflight();
  await ensureFfmpegAvailable();
  const browser = await chromium.launch({
    args: ['--force-color-profile=srgb', '--hide-scrollbars'],
  });
  const captures: MotionCapture[] = [];
  const posters: ImageManifestEntry[] = [];
  const failures: string[] = [];
  try {
    let state = await runtime.bootstrap(browser, args.skipSeed);
    if (!args.skipSeed) state = await runtime.seed(browser, state);
    for (const locale of args.locales)
      await withCaptureLocale(locale, async () => {
        for (const scene of scenes)
          for (const variant of VARIANTS) {
            try {
              const result = await record(
                browser,
                scene,
                locale,
                variant,
                stateDir,
                runtime.authState,
                runtime.toContext(state),
              );
              captures.push(result.capture);
              posters.push(result.poster);
            } catch (error) {
              const detail =
                error instanceof Error ? error.message : String(error);
              failures.push(`${scene.page}/${locale}/${variant}: ${detail}`);
              console.error(
                `✗ ${scene.page}/${locale}/${variant}: ${detail.split('\n')[0]}`,
              );
            }
          }
      });
  } finally {
    await browser.close();
  }
  const manifestFile = path.join(PUBLIC, 'manifest.json');
  const existing = existsSync(manifestFile)
    ? (JSON.parse(readFileSync(manifestFile, 'utf8'))
        .entries as MotionCapture[])
    : [];
  const incoming = new Set(
    captures.map((entry) => `${entry.page}/${entry.locale}/${entry.variant}`),
  );
  const entries = [
    ...existing.filter(
      (entry) =>
        !incoming.has(`${entry.page}/${entry.locale}/${entry.variant}`),
    ),
    ...captures,
  ];
  writeFileSync(
    manifestFile,
    `${JSON.stringify({ version: 1, entries }, null, 2)}\n`,
  );
  await writeMotionRegistries(entries, posters);
  if (failures.length)
    throw new Error(
      `${failures.length} product motion takes failed:\n${failures.join('\n')}`,
    );
}

/** Derive compact browser registries from successful native captures. */
export async function writeMotionRegistries(
  entries: MotionCapture[],
  posters: ImageManifestEntry[],
): Promise<void> {
  for (const entry of entries) {
    const expected = VIEWPORTS[entry.variant];
    if (entry.width !== expected.width || entry.height !== expected.height)
      throw new Error(
        `Unexpected native motion geometry: ${entry.page}/${entry.locale}/${entry.variant}`,
      );
  }
  const localeMap = Object.fromEntries(
    [...new Set(entries.map(({ page }) => page))].map((page) => [
      page,
      ['en', 'de', 'fr'].filter((locale) =>
        VARIANTS.every((variant) =>
          entries.some(
            (entry) =>
              entry.page === page &&
              entry.locale === locale &&
              entry.variant === variant,
          ),
        ),
      ),
    ]),
  );
  const generated = path.join(ROOT, 'app/generated/product-motion.ts');
  writeFileSync(
    generated,
    `/* Generated by scripts/capture-product-motion.ts — do not edit by hand. */\nimport { motionRegistry } from '../../lib/media/product-motion-entry';\nexport type { ProductMotionEntry, ProductMotionVariant } from '../../lib/media/product-motion-entry';\nexport const PRODUCT_MOTION = motionRegistry(${JSON.stringify(localeMap)});\n`,
  );
  await writeManifest(mergeImageManifest(IMAGE_MANIFEST, posters));
  const { exitCode } = await Bun.$`bunx oxfmt ${generated}`
    .cwd(path.resolve(ROOT, '../..'))
    .nothrow();
  if (exitCode) throw new Error('Motion registry format failed');
}

if (import.meta.main)
  main().catch((error: unknown) => {
    console.error('web:animations failed:', error);
    process.exitCode = 1;
  });
