// Driver — orchestrates a real browser around the in-page instrument.
// Structural typing (`PageLike`) keeps Playwright/Puppeteer/CDP out of the
// dependency graph: pass any page object that satisfies the surface. The driver
// injects the instrument on every load, drives keyframes, optionally captures
// screenshots to feed the pixel pipeline, then turns the dump into a Report.

import {
  annotatePaint,
  annotatePixelNoise,
  type NoiseSample,
} from './annotate';
import type { ProbeRect, TimedRect } from './instrument';
import { cropRGBA, decodePng, type DecodedImage, noiseEnergy } from './pixels';
import { loadRecording } from './recording';
import { buildReport } from './report';
import type { Report } from './types';

export type Clip = { x: number; y: number; width: number; height: number };

// Sub-rect noise above this (0..1) when an element is hidden confirms it really
// paints — i.e. the element was not actually occluded, just flagged as such.
const PAINT_CONFIRM_NOISE = 0.02;

/** Minimal page surface the driver needs; Playwright's `Page` satisfies it. */
export type PageLike = {
  addInitScript: (script: string) => Promise<void>;
  goto: (url: string) => Promise<void>;
  evaluate: (expression: string) => Promise<string>;
  waitForTimeout: (ms: number) => Promise<void>;
  /** Required only when `capturePixels` is set. */
  screenshot?: (opts: { clip: Clip }) => Promise<Uint8Array>;
};

export type SessionOptions = {
  url: string;
  /** The instrument IIFE string from `buildInstrumentBundle()` (Bun-built). */
  instrumentBundle: string;
  pixelThreshold?: number;
  frameBudgetMs?: number;
  /** How many keyframe sweeps to run, spaced by `settleMs`. */
  keyframes?: number;
  settleMs?: number;
  /** Capture screenshots → pixelNoise (dithering) + paint counterfactual. */
  capturePixels?: boolean;
  /** Caller interactions (scroll/click) run before the keyframe loop. */
  interact?: (page: PageLike) => Promise<void>;
};

function bootstrap(
  bundle: string,
  options: { pixelThreshold: number; frameBudgetMs: number },
): string {
  const args = JSON.stringify(options);
  return `${bundle}\n;globalThis.installVisualAspectInstrument(${args});`;
}

function clipOf(rect: {
  top: number;
  right: number;
  bottom: number;
  left: number;
}): Clip {
  return {
    x: rect.left,
    y: rect.top,
    width: rect.right - rect.left,
    height: rect.bottom - rect.top,
  };
}

// JSON from the page is untyped; coerce each field at the boundary (no casts).
function rectFrom(r: {
  top: number;
  right: number;
  bottom: number;
  left: number;
}) {
  return {
    top: Number(r.top),
    right: Number(r.right),
    bottom: Number(r.bottom),
    left: Number(r.left),
  };
}

// Parse a JSON array the page returned; a non-array yields an empty list.
function parseJsonArray(json: string) {
  const parsed = JSON.parse(json);
  return Array.isArray(parsed) ? parsed : [];
}

function parseTimedRects(json: string): TimedRect[] {
  return parseJsonArray(json).map((r) => ({
    key: String(r.key),
    t: Number(r.t),
    rect: rectFrom(r.rect),
  }));
}

function parseProbeRects(json: string): ProbeRect[] {
  return parseJsonArray(json).map((r) => ({
    key: String(r.key),
    rect: rectFrom(r.rect),
  }));
}

// Drive the instrument's paint probe: hide/restore a tracked element via
// `__VA.setProbe`, which marks it so the sampler ignores the async hidden state
// (a raw style write would be recorded as a real visibility toggle → flicker).
const probe = (key: string, on: boolean): string =>
  `globalThis.__VA.setProbe(${JSON.stringify(key)}, ${on})`;

// One keyframe of pixel work, BATCHED: take ONE viewport screenshot and crop
// every element's sub-rect from it in-process (→ noise), then confirm paint for
// occluded-looking elements with a single hidden-state screenshot. One round
// trip per keyframe instead of one per element — decisive on a busy page.
async function capturePixelFrame(
  page: PageLike,
  shot: NonNullable<PageLike['screenshot']>,
  prev: Map<string, Uint8Array>,
  noise: NoiseSample[],
  confirmed: Set<string>,
): Promise<void> {
  const [vw, vh] = parseJsonArray(
    await page.evaluate('JSON.stringify([innerWidth, innerHeight])'),
  ).map(Number);
  const viewport: Clip = {
    x: 0,
    y: 0,
    width: Math.max(1, Math.floor(vw ?? 0)),
    height: Math.max(1, Math.floor(vh ?? 0)),
  };

  // A decoded viewport screenshot; any failure skips this frame's pixel work
  // rather than aborting the session.
  const frame = async (): Promise<DecodedImage | null> => {
    try {
      return decodePng(await shot({ clip: viewport }));
    } catch (err) {
      console.warn(
        '[va] screenshot skipped:',
        err instanceof Error ? err.message : err,
      );
      return null;
    }
  };

  const visible = await frame();
  if (!visible) return;

  const rects = parseTimedRects(
    await page.evaluate('JSON.stringify(globalThis.__VA.rects())'),
  );
  for (const { key, t, rect } of rects) {
    const sub = cropRGBA(visible, clipOf(rect)); // null when off-screen
    if (!sub) continue;
    const before = prev.get(key);
    // Only diff equal-size buffers; a resized element changes the sub-rect's
    // dimensions, which would misalign pixels (and resized frames are excluded
    // from dithering downstream anyway).
    if (before && before.length === sub.length) {
      noise.push({ key, t, noise: noiseEnergy(before, sub) });
    }
    prev.set(key, sub);
  }

  const targets = parseProbeRects(
    await page.evaluate('JSON.stringify(globalThis.__VA.paintProbeTargets())'),
  );
  if (targets.length === 0) return;
  // `visibility:hidden` keeps layout (no reflow), so all probe targets can be
  // hidden at once for a single screenshot, then restored together.
  for (const { key } of targets) await page.evaluate(probe(key, true));
  const hidden = await frame();
  for (const { key } of targets) await page.evaluate(probe(key, false));
  if (!hidden) return;
  for (const { key, rect } of targets) {
    const before = cropRGBA(visible, clipOf(rect));
    const after = cropRGBA(hidden, clipOf(rect));
    // If hiding it changed the sub-rect, it really paints (was not occluded).
    if (
      before &&
      after &&
      before.length === after.length &&
      noiseEnergy(before, after) > PAINT_CONFIRM_NOISE
    ) {
      confirmed.add(key);
    }
  }
}

/** Run a session end-to-end and return the analyzed report. */
export async function analyzeSession(
  page: PageLike,
  options: SessionOptions,
): Promise<Report> {
  const pixelThreshold = options.pixelThreshold ?? 1;
  const frameBudgetMs = options.frameBudgetMs ?? 1000 / 60;
  const keyframes = options.keyframes ?? 4;
  const settleMs = options.settleMs ?? 500;

  // addInitScript re-runs on every navigation, so the instrument survives a
  // full reload (MPA), not just SPA route changes.
  await page.addInitScript(
    bootstrap(options.instrumentBundle, {
      pixelThreshold,
      frameBudgetMs,
    }),
  );
  await page.goto(options.url);

  if (options.interact) await options.interact(page);

  const noise: NoiseSample[] = [];
  const confirmed = new Set<string>();
  const prevImages = new Map<string, Uint8Array>();
  // Bind so the page's `screenshot` keeps its receiver when called via `shot`.
  const shot =
    options.capturePixels && page.screenshot
      ? page.screenshot.bind(page)
      : undefined;

  for (let i = 0; i < keyframes; i++) {
    await page.waitForTimeout(settleMs);
    await page.evaluate('globalThis.__VA.keyframe()');
    if (shot) await capturePixelFrame(page, shot, prevImages, noise, confirmed);
  }

  const dump = await page.evaluate('globalThis.__VA.dump()');
  const recording = annotatePaint(
    annotatePixelNoise(loadRecording(dump), noise),
    confirmed,
  );
  return buildReport(recording);
}
