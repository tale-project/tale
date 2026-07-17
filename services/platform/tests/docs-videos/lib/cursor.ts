/**
 * Node-side driver for the injected cursor overlay (`overlay.js`). The
 * overlay LEADS and the real mouse FOLLOWS: for every interaction the visible
 * dot glides to the target's center, then the actual Playwright mouse moves
 * to and clicks the exact same pixel — so the app receives real input on
 * precisely the point the viewer watched the cursor reach.
 */

import type { Locator, Page } from '@playwright/test';

/** Glide speed: ~1.2 px/ms, clamped to a watchable range. */
function glideDuration(distancePx: number): number {
  return Math.round(Math.min(Math.max(distancePx / 1.2, 250), 900));
}

const SETTLE_MS = 160;

interface OverlayHandle {
  show: () => void;
  hide: () => void;
  /** Visibility veil for scene changes — unlike hide(), it survives
   * moveTo()'s display toggling, so a gliding cursor stays invisible. */
  veil: () => void;
  unveil: () => void;
  place: (x: number, y: number) => void;
  moveTo: (x: number, y: number, ms: number) => Promise<void>;
  ripple: () => void;
}

declare global {
  interface Window {
    __taleCursor?: OverlayHandle;
  }
}

export class Cursor {
  private lastPoint = { x: 960, y: 810 };

  constructor(private readonly page: Page) {}

  async show(): Promise<void> {
    await this.page.evaluate(() => window.__taleCursor?.show());
  }

  async hide(): Promise<void> {
    await this.page.evaluate(() => window.__taleCursor?.hide());
  }

  /** Park the dot without animating (scene transitions, after reloads). */
  async place(x: number, y: number): Promise<void> {
    this.lastPoint = { x, y };
    await this.page.evaluate(([px, py]) => window.__taleCursor?.place(px, py), [
      x,
      y,
    ] as const);
    await this.page.mouse.move(x, y);
  }

  private async targetCenter(
    locator: Locator,
  ): Promise<{ x: number; y: number }> {
    await locator.scrollIntoViewIfNeeded();
    const box = await locator.boundingBox();
    if (!box) {
      throw new Error(`Cursor target has no bounding box: ${String(locator)}`);
    }
    return { x: box.x + box.width / 2, y: box.y + box.height / 2 };
  }

  /** Glide to the element (no click) — triggers real :hover on arrival. */
  async hover(locator: Locator): Promise<void> {
    const point = await this.targetCenter(locator);
    const distance = Math.hypot(
      point.x - this.lastPoint.x,
      point.y - this.lastPoint.y,
    );
    await this.page.evaluate(
      ([x, y, ms]) => window.__taleCursor?.moveTo(x, y, ms),
      [point.x, point.y, glideDuration(distance)] as const,
    );
    this.lastPoint = point;
    await this.page.mouse.move(point.x, point.y);
  }

  /** Glide, settle, ripple, and really click the same pixel. */
  async click(locator: Locator): Promise<void> {
    await this.hover(locator);
    await this.page.waitForTimeout(SETTLE_MS);
    await this.page.evaluate(() => window.__taleCursor?.ripple());
    await this.page.mouse.down();
    await this.page.mouse.up();
  }

  /** Click the field, then type at a human pace. */
  async type(locator: Locator, text: string): Promise<void> {
    await this.click(locator);
    await this.page.keyboard.type(text, { delay: 45 });
  }
}
