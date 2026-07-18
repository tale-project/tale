/**
 * Canonical filesystem anchors for the docs video pipeline. Every module
 * derives its locations from here — the "where are we" math lives in exactly
 * one place instead of per-file `../../../..` chains.
 */

import path from 'node:path';

const LIB_DIR = path.dirname(new URL(import.meta.url).pathname);

/** `services/platform/tests/docs-videos/` — the pipeline root. */
export const PIPELINE_DIR = path.resolve(LIB_DIR, '..');

/** Episode specs + choreography, one directory per episode id. */
export const EPISODES_DIR = path.join(PIPELINE_DIR, 'episodes');

/**
 * Disposable, gitignored working state: TTS cache, audio plans, frames,
 * drafts, review sheets. Only `tts-cache/` is worth keeping (it bills).
 */
export const STATE_DIR = path.join(PIPELINE_DIR, '.state');

export const REPO_ROOT = path.resolve(PIPELINE_DIR, '../../../..');

/** Where produced episodes ship: `services/docs/public/`. */
export const DOCS_PUBLIC_DIR = path.join(REPO_ROOT, 'services/docs/public');

/**
 * The docs-screenshots bootstrap state the recorder reuses (auth.json +
 * org.json) — the video pipeline never mints its own demo org.
 */
export const SCREENSHOTS_STATE_DIR = path.resolve(
  PIPELINE_DIR,
  '..',
  'docs-screenshots',
  '.state',
);
