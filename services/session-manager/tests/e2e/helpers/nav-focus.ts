import { expect, type CDPSession, type Page } from '@playwright/test';

declare global {
  interface Window {
    /** Frames the focus has been on a control, counted by `focusRestsOnAControl`. */
    focusFrames?: number;
    /** The controls the keyboard has stood on since a walk began (`walkTabOrder`), in order, as the page itself knows them. */
    tabbed?: Element[];
  }
}

/** What the keyboard is on: the role and the accessible name the browser computes for it. */
export interface Stop {
  role: string;
  name: string;
  tag: string;
  /** Where the element stands among the elements of the page's body, to tell one control from another with the same name. */
  index: number;
  /** Where the control is on the screen (CSS pixels). */
  box: { x: number; y: number; width: number; height: number };
}

/** Text of a stop the way a failure message reads it: `link "Sessions"`. */
export function describeStop(stop: Pick<Stop, 'role' | 'name'>): string {
  return stop.name === '' ? stop.role : `${stop.role} "${stop.name}"`;
}

/**
 * Waits until the focus has rested on a control for a stretch of frames: where
 * a keyboard user is left once everything has moved (a dialog closed, a row
 * gone). The focus is on the page itself for a moment in between, as one
 * control goes and the next takes it over, so a single look at it says
 * nothing; this fails only if the focus never settles on a control.
 */
export async function focusRestsOnAControl(
  page: Page,
  frames = 30,
): Promise<void> {
  await page.evaluate(() => {
    window.focusFrames = 0;
  });
  await page.waitForFunction(
    (needed) => {
      const element = document.activeElement;
      const onAControl =
        element !== null &&
        element !== document.body &&
        element !== document.documentElement;
      window.focusFrames = onAControl ? (window.focusFrames ?? 0) + 1 : 0;
      return window.focusFrames >= needed;
    },
    frames,
    { polling: 'raf' },
  );
}

/**
 * Takes the keyboard off the control that has it. A menu or a popover that
 * closes gives the focus back to its button, and a button with a tooltip opens
 * the tooltip with the focus: left there it stands over the control the next
 * step of a spec clicks. Call it once the focus has arrived on the button.
 */
export async function releaseFocus(page: Page): Promise<void> {
  await page.evaluate(() => {
    const { activeElement } = document;
    if (activeElement instanceof HTMLElement) activeElement.blur();
  });
  await expect(page.getByRole('tooltip')).toHaveCount(0);
}

/**
 * The focused element's accessible name and role, as Chromium's accessibility
 * tree has them (the names a screen reader announces), or null when the focus
 * is on the page itself.
 */
export async function focusedStop(
  page: Page,
  cdp?: CDPSession,
): Promise<Stop | null> {
  const where = await page.evaluate(() => {
    const element = document.activeElement;
    if (
      element === null ||
      element === document.body ||
      element === document.documentElement
    ) {
      return null;
    }
    // The page itself keeps which controls the keyboard stood on: an index
    // would not do, the page shifts it as it goes (a bar that shows while the
    // page a link leads to is being fetched, a tooltip that opens).
    (window.tabbed ??= []).push(element);
    const { x, y, width, height } = element.getBoundingClientRect();
    return {
      tag: element.tagName.toLowerCase(),
      index: Array.from(document.body.querySelectorAll('*')).indexOf(element),
      box: { x, y, width, height },
    };
  });
  if (where === null) return null;

  const session = cdp ?? (await page.context().newCDPSession(page));
  const { result } = await session.send('Runtime.evaluate', {
    expression: 'document.activeElement',
  });
  if (result.objectId === undefined) return { role: '', name: '', ...where };
  try {
    const { nodes } = await session.send('Accessibility.getPartialAXTree', {
      objectId: result.objectId,
      fetchRelatives: false,
    });
    const node = nodes[0];
    const role: unknown = node?.role?.value;
    const name: unknown = node?.name?.value;
    return {
      role: typeof role === 'string' ? role : '',
      name: typeof name === 'string' ? name : '',
      ...where,
    };
  } finally {
    await session.send('Runtime.releaseObject', { objectId: result.objectId });
    if (cdp === undefined) await session.detach();
  }
}

export interface TabWalk {
  /** Every control the Tab key reached, in order, until the focus left the page. */
  stops: Stop[];
  /** The focus left the page's controls (back to the page itself) within the limit: the order has an end, no trap. */
  ended: boolean;
  /** The stop the walk was told to end at, if it got there. */
  stoppedAt: Stop | null;
}

/**
 * Makes the next Tab start at the top of the document. A browser starts it
 * where the last thing the person did was (a click, a scroll to an element);
 * a page that scrolls something into view while it loads moves that point
 * (see the viewer's tab strip), so a walk that is about the order of the
 * controls, not about where the keyboard starts, begins from here.
 */
export function startFromTop(page: Page): Promise<void> {
  return page.evaluate(() => {
    const { body } = document;
    body.tabIndex = -1;
    body.focus();
    body.removeAttribute('tabindex');
  });
}

/**
 * Presses Tab from the top of the page until the focus is back on the page
 * itself (the order has run through), `stopAt` says so (a control that takes
 * the Tab key for itself) or `limit` presses have passed (a trap, or a page
 * with more controls than it should have).
 */
export async function walkTabOrder(
  page: Page,
  options: { limit?: number; stopAt?: (stop: Stop) => boolean } = {},
): Promise<TabWalk> {
  const { limit = 120, stopAt } = options;
  const cdp = await page.context().newCDPSession(page);
  const stops: Stop[] = [];
  try {
    await page.evaluate(() => {
      window.tabbed = [];
    });
    await startFromTop(page);
    for (let press = 0; press < limit; press += 1) {
      await page.keyboard.press('Tab');
      const stop = await focusedStop(page, cdp);
      if (stop === null) return { stops, ended: true, stoppedAt: null };
      stops.push(stop);
      if (stopAt?.(stop)) return { stops, ended: false, stoppedAt: stop };
    }
    return { stops, ended: false, stoppedAt: null };
  } finally {
    await cdp.detach();
  }
}

export interface TabWalkFaults {
  /** Controls the keyboard stood on more than once: a trap. */
  repeated: string[];
  /** Pairs of controls the keyboard went through against the order of the document. */
  outOfOrder: string[];
  /**
   * Controls a keyboard should reach by Tab and the walk did not: visible
   * links, buttons, fields, switches and summaries that are not disabled and not
   * taken out of the order with `tabindex="-1"` (a group that moves inside
   * itself with the arrow keys, like the radios of a theme choice, is one stop
   * and marks its other items that way).
   */
  missed: string[];
}

/**
 * What was wrong with the last `walkTabOrder`, judged by the page from the
 * controls the keyboard stood on, as they are now: by the elements themselves,
 * not by their places in the document, which move while the page loads.
 */
export function tabWalkFaults(page: Page): Promise<TabWalkFaults> {
  return page.evaluate((): TabWalkFaults => {
    const walked = window.tabbed ?? [];
    const label = (element: Element) =>
      `<${element.tagName.toLowerCase()}> ${
        element.getAttribute('aria-label') ??
        element.textContent?.trim().slice(0, 40) ??
        ''
      }`;

    const seen = new Set<Element>();
    const repeated: string[] = [];
    for (const element of walked) {
      if (seen.has(element)) repeated.push(label(element));
      seen.add(element);
    }

    const outOfOrder: string[] = [];
    for (let at = 1; at < walked.length; at += 1) {
      const before = walked[at - 1];
      const after = walked[at];
      if (
        before?.isConnected &&
        after?.isConnected &&
        (before.compareDocumentPosition(after) &
          Node.DOCUMENT_POSITION_FOLLOWING) ===
          0
      ) {
        outOfOrder.push(`${label(before)} before ${label(after)}`);
      }
    }

    const selector = [
      'a[href]',
      'button',
      'input:not([type="hidden"])',
      'select',
      'textarea',
      'summary',
      '[tabindex]',
    ].join(',');
    const shown = (element: Element) => {
      for (
        let node: Element | null = element;
        node;
        node = node.parentElement
      ) {
        const style = getComputedStyle(node);
        if (
          style.display === 'none' ||
          style.visibility === 'hidden' ||
          node.hasAttribute('inert')
        ) {
          return false;
        }
      }
      const box = element.getBoundingClientRect();
      return box.width > 0 && box.height > 0;
    };
    const missed: string[] = [];
    for (const element of document.querySelectorAll(selector)) {
      if (
        element.hasAttribute('disabled') ||
        element.getAttribute('tabindex') === '-1' ||
        // The root of a group that moves its own focus (radios, tabs): the
        // key goes to the item inside it, not to the root.
        ['radiogroup', 'tablist'].includes(
          element.getAttribute('role') ?? '',
        ) ||
        !shown(element) ||
        seen.has(element)
      ) {
        continue;
      }
      missed.push(label(element));
    }
    return { repeated, outOfOrder, missed };
  });
}

/**
 * Presses Tab until the control that satisfies `isTarget` has the focus, the
 * way a person moves to it (so the browser marks the focus as the keyboard's).
 * Starts at the top of the page; fails after `limit` presses.
 */
export async function tabTo(
  page: Page,
  isTarget: (stop: Stop) => boolean,
  limit = 80,
): Promise<Stop> {
  const cdp = await page.context().newCDPSession(page);
  try {
    await startFromTop(page);
    for (let press = 0; press < limit; press += 1) {
      await page.keyboard.press('Tab');
      const stop = await focusedStop(page, cdp);
      if (stop === null) break;
      if (isTarget(stop)) return stop;
    }
    throw new Error(`Tab did not reach the control within ${limit} presses`);
  } finally {
    await cdp.detach();
  }
}
