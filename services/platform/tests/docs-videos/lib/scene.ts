/**
 * The scene choreography contract. Each episode ships a `scenes.ts` whose
 * entries pair 1:1 (by id) with the narration scenes in its `episode.ts`.
 *
 * A scene's `run` is called exactly AT its planned start boundary and must
 * return before its budget ends (the recorder throws on overrun — silently
 * stretching a scene would desync every scene after it). The default lead-in
 * (500 ms of hush before the narration) is the room a run has to settle
 * navigation; slow surfaces get a bigger per-scene `leadInMs` in the spec,
 * never a sleep.
 *
 * Choreography rules (the produce-video skill carries the full doctrine):
 *  - wait on state (locators), never on time — `cue()` is the ONE exception:
 *    it waits until a narration-relative moment, for beats that must land
 *    with the voice ("…watch" → click).
 *  - target elements via role + i18n-resolved names (`t`), so the same scene
 *    records under every locale.
 */

import type { Page } from '@playwright/test';

import type { CleanupRegistry } from './cleanup';
import type { Cursor } from './cursor';
import type { Locale } from './episode';

declare global {
  interface Window {
    /** Installed by lib/cards.ts before the screencast starts. */
    __taleVideoCard?: {
      reveal: () => void;
      fadeOutAndRemove: (ms: number) => void;
      showChapter: (label: string, veil: boolean) => void;
      showOutro: () => void;
    };
  }
}

/**
 * Client-side route change: pushState + popstate, which TanStack Router
 * subscribes to. The take must NEVER full-load a page — a reload re-boots
 * the SPA on camera and no warm-up can hide it (verified: content renders,
 * zero page loads, JS state survives).
 */
export async function spaNavigate(page: Page, path: string): Promise<void> {
  await page.evaluate((to) => {
    window.history.pushState({}, '', to);
    window.dispatchEvent(new PopStateEvent('popstate'));
  }, path);
}

export interface SceneContext {
  /** The demo org id (docs-screenshots bootstrap owns it). */
  readonly orgId: string;
  readonly locale: Locale;
  /** The live chat question for the wow scene, in this locale. */
  readonly heroPrompt: string;
  /** Seeded project ids by project name (docs-screenshots org state). */
  readonly projects: ReadonlyMap<string, string>;
  /**
   * The additive-only contract: register anything the scene creates ON
   * CAMERA the moment it exists (thread, knowledge entry, agent, task) —
   * the recorder sweeps it off camera after the take, even on abort.
   */
  readonly cleanup: CleanupRegistry;
}

export interface SceneRuntime {
  readonly page: Page;
  readonly cursor: Cursor;
  /** Resolve a UI label from this locale's messages catalog (dot path). */
  readonly t: (key: string) => string;
  /**
   * Wait until `seconds` into this scene's NARRATION (i.e. planned narration
   * start + offset). Already-past moments resolve immediately.
   */
  readonly cue: (seconds: number) => Promise<void>;
  /** This scene's narration length — `cue(narrationSeconds + x)` lands in
   * the silent tail, the place for pre-navigating a slow next surface. */
  readonly narrationSeconds: number;
  readonly ctx: SceneContext;
}

export interface SceneChoreography {
  readonly id: string;
  readonly run: (rt: SceneRuntime) => Promise<void>;
}

/** Fail loudly when spec and choreography drift apart. */
export function choreographyFor(
  scenes: readonly SceneChoreography[],
  sceneId: string,
): SceneChoreography {
  const scene = scenes.find((s) => s.id === sceneId);
  if (!scene) {
    throw new Error(
      `No choreography for scene "${sceneId}" — episode.ts and scenes.ts are out of sync`,
    );
  }
  return scene;
}
