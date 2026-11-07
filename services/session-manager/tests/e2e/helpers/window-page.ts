import { expect, type Locator, type Page } from '@playwright/test';

import {
  timesShown,
  typedTexts,
  type BrowserState,
  type Control,
} from './control';
import { TIMEOUT } from './env';
import { fill, t } from './i18n';

/*
  What a spec of the page of a running session needs besides `SessionsPage`:
  the window of the session as the fake browser writes it down, and the
  secrets the card types into it. The window itself is the person's own, on
  their screen; the fake opens none, and tells the control server what was
  done to it instead: `['toFront']` each time it was brought to the front,
  `['text', value]` for what was typed into the field that had the focus.
*/

/** The events of the browser of a session, as the control server reads them. */
type Events = BrowserState['events'];

/**
 * The window of the running session called `name`: the browser launched last
 * for it. A start, a restart and a rotation each launch a new one, which has
 * been told nothing yet.
 */
export class SessionWindow {
  constructor(
    private readonly control: Control,
    readonly name: string,
  ) {}

  state(): Promise<BrowserState> {
    return this.control.browser(this.name);
  }

  async events(): Promise<Events> {
    return (await this.state()).events;
  }

  /** The values typed into it, in order. */
  async typed(): Promise<string[]> {
    return typedTexts(await this.state());
  }

  /** How often it was brought to the front. */
  async shown(): Promise<number> {
    return timesShown(await this.state());
  }

  /** Waits until it is open and has been brought to the front `count` times in all. */
  async expectShown(count: number): Promise<void> {
    await expect
      .poll(
        async () => {
          const state = await this.state();
          return state.closed ? null : timesShown(state);
        },
        {
          timeout: TIMEOUT.BACKGROUND,
          message: `the window of ${this.name} is open and came to the front ${count} times`,
        },
      )
      .toBe(count);
  }

  /** Waits until what it was told is `events`, in this order. */
  async expectEvents(events: Events): Promise<void> {
    await expect
      .poll(() => this.events(), {
        timeout: TIMEOUT.BACKGROUND,
        message: `what the window of ${this.name} was told`,
      })
      .toEqual(events);
  }
}

/** The popover of the card's Secrets, named by its heading. */
export function secretsPopover(page: Page): Locator {
  return page.getByRole('dialog', { name: t('viewer.secrets.title') });
}

/** The button of an opened secret that types the value of its field `label` into the window. */
export function typeButton(scope: Locator, label: string): Locator {
  return scope.getByRole('button', {
    name: fill(t('viewer.secrets.typeLabel'), { label }),
    exact: true,
  });
}

/** Everything the page holds as text and markup: what a masked value must never be in. */
export async function everythingShown(page: Page): Promise<string> {
  return `${await page.locator('body').innerText()}\n${await page.content()}`;
}

/** Where an element is on the screen (CSS pixels); it must be on it. */
export async function boxOf(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const box = await locator.boundingBox({ timeout: TIMEOUT.VISIBLE });
  if (box === null) throw new Error('the element is not on the screen');
  return box;
}

/** Presses Tab until `target` has the keyboard, as a person walks to it. */
export async function tabUntil(
  page: Page,
  target: Locator,
  limit = 20,
): Promise<void> {
  for (let presses = 0; presses < limit; presses++) {
    if (
      await target.evaluate((element) => element === document.activeElement)
    ) {
      return;
    }
    await page.keyboard.press('Tab');
  }
  await expect(target).toBeFocused();
}
