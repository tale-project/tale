import type { ElementHandle, Page } from '@playwright/test';

import { TIMEOUT } from './env';

/** How many frames in a row the keyboard has to stay on a control to be said to rest there. */
const RESTING_FRAMES = 30;

/**
 * Waits until the keyboard has stayed on a control for a stretch of frames: the
 * page itself (`<body>`) is no place for it to be left. A control hands it on
 * to the next as it goes, and the page has it for a moment in between, so one
 * look says nothing; this fails only when the keyboard never settles.
 */
export async function focusRestsOnAControl(
  page: Page,
  timeout: number = TIMEOUT.VISIBLE,
): Promise<void> {
  const counter = 'sessionsFocusFrames';
  await page.evaluate((key) => Reflect.set(window, key, 0), counter);
  await page.waitForFunction(
    ({ key, needed }) => {
      const element = document.activeElement;
      const onAControl =
        element !== null &&
        element !== document.body &&
        element !== document.documentElement;
      const frames = Number(Reflect.get(window, key) ?? 0);
      Reflect.set(window, key, onAControl ? frames + 1 : 0);
      return onAControl && frames + 1 >= needed;
    },
    { key: counter, needed: RESTING_FRAMES },
    { polling: 'raf', timeout },
  );
}

/** Whether the keyboard is on this very element (not on another one that looks like it). */
export function isFocusedNode(
  page: Page,
  node: ElementHandle<Element>,
): Promise<boolean> {
  return page.evaluate((element) => document.activeElement === element, node);
}

/**
 * What has the keyboard, for a failure message: its tag and the words it is
 * called by.
 */
export function describeFocus(page: Page): Promise<string> {
  return page.evaluate(() => {
    const element = document.activeElement;
    if (element === null) return 'nothing';
    const name = (
      element.getAttribute('aria-label') ??
      element.textContent ??
      ''
    )
      .trim()
      .slice(0, 40);
    return `${element.tagName.toLowerCase()} "${name}"`;
  });
}
