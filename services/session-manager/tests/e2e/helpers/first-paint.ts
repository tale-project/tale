import type { Locator, Page } from '@playwright/test';

/** What one painted frame of a page showed. */
export interface Frame {
  /** `#root` is empty (blank), holds the boot shell the server sent, or the app's page. */
  root: 'blank' | 'shell' | 'app';
  /** The boot shell is drawn where it can be seen (it waits out a blink first, `locals.css`). */
  shellShown: boolean;
  /** Milliseconds from the start of the navigation to the frame. */
  t: number;
  /** Masked rows: a status that says a table or a list is loading. */
  masked: boolean;
  /** The search box of a list's toolbar, in the page. */
  search: boolean;
  /** The headings in sight, the title of an empty state among them. */
  headings: string[];
}

declare global {
  interface Window {
    __firstPaintFrames?: Frame[];
  }
}

/**
 * Records what the page shows, frame by frame from the very first: before
 * every paint (`requestAnimationFrame`) the document is read, and a frame that
 * differs from the one before is kept. A state that lives one frame (the flash
 * of a loading layout an answer replaces at once) is among them. Call it
 * before `goto`.
 */
export async function recordFrames(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const frames: Frame[] = [];
    window.__firstPaintFrames = frames;
    const shown = (element: Element) => {
      const box = element.getBoundingClientRect();
      if (box.width === 0 || box.height === 0) return false;
      const style = getComputedStyle(element);
      return style.visibility !== 'hidden' && style.display !== 'none';
    };
    const read = (): Omit<Frame, 't'> | null => {
      const root = document.getElementById('root');
      if (root === null) return null;
      const all = (selector: string) =>
        Array.from(document.querySelectorAll(selector)).filter(shown);
      const tile = root.querySelector('[data-boot-shell] [data-skeleton-mask]');
      return {
        root:
          root.childElementCount === 0
            ? 'blank'
            : root.querySelector('[data-boot-shell]') !== null
              ? 'shell'
              : 'app',
        shellShown:
          tile !== null && getComputedStyle(tile).visibility !== 'hidden',
        masked: all('[role="status"][aria-busy="true"]').some(
          (status) => status.closest('[data-boot-shell]') === null,
        ),
        // The context speaks English (`locale: 'en-US'`): "Search proxies".
        search: all('main input[placeholder^="Search"]').length > 0,
        headings: all('h1, h2, h3').map((heading) =>
          (heading.textContent ?? '').trim(),
        ),
      };
    };
    let last = '';
    const sample = () => {
      const frame = read();
      const key = JSON.stringify(frame);
      if (frame !== null && key !== last) {
        frames.push({ ...frame, t: Math.round(performance.now()) });
        last = key;
      }
      requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  });
}

/** The frames `recordFrames` kept, in order. */
export async function framesOf(page: Page): Promise<Frame[]> {
  return page.evaluate(() => window.__firstPaintFrames ?? []);
}

/** The middle of every box `locator` matches that is drawn, rounded to the pixel. */
export async function centersOf(locator: Locator): Promise<string[]> {
  return locator.evaluateAll((elements) =>
    elements
      .map((element) => element.getBoundingClientRect())
      .filter((box) => box.width > 0 && box.height > 0)
      .map(
        (box) =>
          `${Math.round(box.x + box.width / 2)},${Math.round(box.y + box.height / 2)}`,
      ),
  );
}
